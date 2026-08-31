import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { DiscordApiError, DiscordClient } from "./discord.js";
import { renderConversationPage, renderIndex, STYLE_CSS, VIEWER_JS, type RenderContext, type RenderConversation } from "./render.js";
import type { ArchiveManifest, ConversationRecord, DiscordChannel, DiscordMessage, LocalAttachment, NormalizedMessage } from "./types.js";
import { relativeUrl, safeFilename, slug, writeAtomicJson, writeJson, writeText } from "./utils.js";

const VERSION = "0.1.0";
const CHECKPOINT_FILE = ".discord-server-backup-checkpoint.json";

interface Checkpoint { schemaVersion: 1; guildId: string; completedConversationIds: string[]; conversations: RenderConversation[]; }
export interface ExportOptions { guildId: string; output: string; messagesPerFile: number; resume: boolean; token: string; }
interface MentionResolver { roles: Map<string, string>; channels: Map<string, string>; }
type Log = (message: string) => void;

function isConversation(channel: DiscordChannel): boolean {
  return ![4].includes(channel.type); // category channels are navigation only
}

function isArchiveParent(channel: DiscordChannel): boolean { return channel.type === 0 || channel.type === 5; }
function isThread(channel: DiscordChannel): boolean { return [10, 11, 12].includes(channel.type); }

async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }

async function outputIsEmpty(directory: string): Promise<boolean> {
  try { return (await readdir(directory)).length === 0; } catch { return true; }
}

async function prepareOutput(options: ExportOptions): Promise<Checkpoint> {
  const checkpointPath = path.join(options.output, CHECKPOINT_FILE);
  if (options.resume) {
    if (!(await exists(checkpointPath))) throw new Error(`Cannot resume: ${checkpointPath} does not exist.`);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
    if (checkpoint.guildId !== options.guildId) throw new Error("The checkpoint belongs to a different guild.");
    return checkpoint;
  }
  if (!(await outputIsEmpty(options.output))) throw new Error(`Output directory is not empty. Choose a new directory or use --resume: ${options.output}`);
  await mkdir(options.output, { recursive: true });
  const checkpoint: Checkpoint = { schemaVersion: 1, guildId: options.guildId, completedConversationIds: [], conversations: [] };
  await writeAtomicJson(checkpointPath, checkpoint);
  return checkpoint;
}

function outputDirectory(channel: DiscordChannel): string {
  const name = `${slug(channel.name ?? "unnamed")}--${channel.id}`;
  if (isThread(channel)) return path.posix.join("threads", channel.parent_id ?? "unknown-parent", name);
  return path.posix.join("channels", `${String(channel.position ?? 0).padStart(4, "0")}-${name}`);
}

async function listArchived(client: DiscordClient, channel: DiscordChannel, failures: Array<Record<string, unknown>>, log: Log): Promise<DiscordChannel[]> {
  const threads: DiscordChannel[] = [];
  for (const kind of ["public", "private"] as const) {
    let before: string | undefined;
    try {
      do {
        log(`Listing ${kind} archived threads in #${channel.name ?? channel.id}${before ? " (next page)" : ""}`);
        const response = await client.getArchivedThreads(channel.id, kind, before);
        threads.push(...response.threads);
        log(`Found ${response.threads.length} ${kind} archived thread(s) in #${channel.name ?? channel.id}`);
        const finalThread = response.threads.at(-1);
        before = response.has_more && finalThread?.thread_metadata?.archive_timestamp ? finalThread.thread_metadata.archive_timestamp : undefined;
        if (!response.has_more) break;
      } while (before);
    } catch (error) {
      const status = error instanceof DiscordApiError ? error.status : undefined;
      failures.push({ scope: "archived-threads", channelId: channel.id, type: kind, status, error: error instanceof Error ? error.message : String(error) });
      log(`Could not list ${kind} archived threads in #${channel.name ?? channel.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return threads;
}

async function fetchMessages(client: DiscordClient, channelId: string, label: string, log: Log): Promise<DiscordMessage[]> {
  const messages: DiscordMessage[] = [];
  let before: string | undefined;
  let pageNumber = 0;
  do {
    const page = await client.getMessages(channelId, before);
    pageNumber += 1;
    messages.push(...page);
    log(`Fetched ${page.length} message(s) from #${label}, history page ${pageNumber} (${messages.length} total)`);
    before = page.at(-1)?.id;
    if (page.length < 100) break;
  } while (before);
  return messages.reverse();
}

async function downloadAttachment(client: DiscordClient, archiveRoot: string, conversationDir: string, messageId: string, attachment: DiscordMessage["attachments"][number], failures: Array<Record<string, unknown>>): Promise<LocalAttachment> {
  const filename = safeFilename(attachment.filename, `attachment-${attachment.id}`);
  const localPath = path.posix.join(conversationDir, "attachments", messageId, `${attachment.id}--${filename}`);
  const destination = path.join(archiveRoot, localPath);
  try {
    const data = await client.download(attachment.url, destination);
    return { id: attachment.id, filename, contentType: attachment.content_type ?? data.contentType, size: attachment.size ?? data.size, sha256: data.sha256, localPath, sourceUrl: attachment.url, status: "downloaded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ scope: "attachment", messageId, attachmentId: attachment.id, filename, error: message });
    return { id: attachment.id, filename, contentType: attachment.content_type ?? null, size: attachment.size ?? null, sha256: null, localPath: null, sourceUrl: attachment.url, status: "failed", error: message };
  }
}

function displayContent(content: string, users: Map<string, string>, resolver: MentionResolver): string {
  return content
    .replace(/<@!?(\d+)>/g, (_match, id: string) => `@${users.get(id) ?? id}`)
    .replace(/<@&(\d+)>/g, (_match, id: string) => `@${resolver.roles.get(id) ?? id}`)
    .replace(/<#(\d+)>/g, (_match, id: string) => `#${resolver.channels.get(id) ?? id}`);
}

async function normalizeMessage(client: DiscordClient, archiveRoot: string, conversationDir: string, message: DiscordMessage, users: Map<string, string>, resolver: MentionResolver, failures: Array<Record<string, unknown>>): Promise<NormalizedMessage> {
  const attachments = await Promise.all(message.attachments.map((attachment) => downloadAttachment(client, archiveRoot, conversationDir, message.id, attachment, failures)));
  let avatarPath: string | null = null;
  if (message.author.avatar) {
    const assetPath = path.posix.join("assets", "avatars", `${message.author.id}.png`);
    const destination = path.join(archiveRoot, assetPath);
    if (!(await exists(destination))) {
      try { await client.download(`https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=64`, destination); }
      catch (error) { failures.push({ scope: "avatar", userId: message.author.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    if (await exists(destination)) avatarPath = assetPath;
  }
  const embeds = (message.embeds ?? []).map((item) => {
    const embed = item as Record<string, unknown>;
    return { title: typeof embed.title === "string" ? embed.title : null, description: typeof embed.description === "string" ? embed.description : null, url: typeof embed.url === "string" ? embed.url : null };
  });
  return {
    id: message.id,
    channelId: message.channel_id,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp ?? null,
    content: displayContent(message.content ?? "", users, resolver),
    author: { id: message.author.id, name: message.author.global_name || message.author.username, username: message.author.username, avatarPath, isBot: Boolean(message.author.bot) },
    attachments,
    replyTo: message.message_reference?.message_id ? { messageId: message.message_reference.message_id, channelId: message.message_reference.channel_id ?? null } : null,
    reactions: (message.reactions ?? []).map((reaction) => ({ name: reaction.emoji.name ?? "emoji", count: reaction.count })),
    embeds,
  };
}

async function writeConversation(client: DiscordClient, root: string, channel: DiscordChannel, messagesPerFile: number, resolver: MentionResolver, context: RenderContext, failures: Array<Record<string, unknown>>, log: Log): Promise<RenderConversation> {
  const outputDir = outputDirectory(channel);
  const name = channel.name ?? channel.id;
  log(`Starting ${isThread(channel) ? "thread" : "channel"} #${name} → ${outputDir}`);
  const messages = await fetchMessages(client, channel.id, name, log);
  const users = new Map(messages.map((message) => [message.author.id, message.author.global_name || message.author.username]));
  const normalized: NormalizedMessage[] = [];
  for (const message of messages) normalized.push(await normalizeMessage(client, root, outputDir, message, users, resolver, failures));
  const pageCount = Math.max(1, Math.ceil(messages.length / messagesPerFile));
  const pages = Array.from({ length: pageCount }, (_, index) => index === 0 ? "index.html" : `page-${String(index + 1).padStart(4, "0")}.html`);
  const record: RenderConversation = { id: channel.id, kind: isThread(channel) ? "thread" : "channel", parentId: channel.parent_id ?? null, name: channel.name ?? `unnamed-${channel.id}`, type: channel.type, position: channel.position ?? 0, outputDir, pageCount, messageCount: messages.length, status: "exported", pages };
  context.conversations.push(record);
  const conversationDir = path.join(root, outputDir);
  for (let index = 0; index < pageCount; index += 1) {
    const start = index * messagesPerFile;
    const rawPage = messages.slice(start, start + messagesPerFile);
    const normalizedPage = normalized.slice(start, start + messagesPerFile);
    await writeJson(path.join(conversationDir, `messages-${String(index + 1).padStart(6, "0")}.json`), { schemaVersion: 1, conversation: { id: channel.id, name: record.name, type: channel.type, page: index + 1, pageCount }, messages: rawPage.map((raw, rawIndex) => ({ raw, normalized: normalizedPage[rawIndex] })) });
    await writeText(path.join(conversationDir, pages[index]), renderConversationPage(context, record, index, normalizedPage));
    log(`Wrote #${name} archive part ${index + 1}/${pageCount} (${rawPage.length} message(s))`);
  }
  return record;
}

export async function exportGuild(options: ExportOptions): Promise<ArchiveManifest> {
  if (!options.token) throw new Error("DISCORD_BOT_TOKEN is required.");
  if (!/^\d+$/.test(options.guildId)) throw new Error("--guild must be a Discord snowflake ID.");
  if (!Number.isInteger(options.messagesPerFile) || options.messagesPerFile < 1) throw new Error("--messages-per-file must be a positive integer.");
  const checkpoint = await prepareOutput(options);
  const logFile = path.join(options.output, "export.log");
  const log: Log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    process.stderr.write(`[discord-server-backup] ${line}`);
    appendFileSync(logFile, line, "utf8");
  };
  log(`Starting one-time export for guild ${options.guildId}`);
  log(`Output directory: ${options.output}`);
  log(options.resume ? "Resume mode enabled." : "Creating a new archive.");
  const client = new DiscordClient(options.token, log);
  const failures: Array<Record<string, unknown>> = [];
  log("Fetching guild metadata.");
  const guild = await client.getGuild(options.guildId);
  const guildName = typeof guild.name === "string" ? guild.name : options.guildId;
  const context: RenderContext = { root: options.output, guildId: options.guildId, guildName, conversations: checkpoint.conversations ?? [], messageLinks: new Map() };
  await writeText(path.join(options.output, "assets", "style.css"), STYLE_CSS);
  await writeText(path.join(options.output, "assets", "viewer.js"), VIEWER_JS);
  log("Wrote static viewer assets.");
  const channels = await client.getGuildChannels(options.guildId);
  log(`Found ${channels.length} guild channel(s).`);
  const roles = await client.getGuildRoles(options.guildId).catch((error) => { failures.push({ scope: "roles", error: error instanceof Error ? error.message : String(error) }); return [] as Array<Record<string, unknown>>; });
  log(`Loaded ${roles.length} role(s) for mention labels.`);
  const active = await client.getActiveThreads(options.guildId).catch((error) => { failures.push({ scope: "active-threads", error: error instanceof Error ? error.message : String(error) }); return { threads: [] as DiscordChannel[] }; });
  log(`Found ${active.threads.length} active thread(s).`);
  const archived = (await Promise.all(channels.filter(isArchiveParent).map((channel) => listArchived(client, channel, failures, log)))).flat();
  log(`Found ${archived.length} archived thread(s).`);
  const byId = new Map<string, DiscordChannel>();
  for (const channel of [...channels.filter(isConversation), ...active.threads, ...archived]) byId.set(channel.id, channel);
  const ordered = [...byId.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""));
  const resolver: MentionResolver = {
    roles: new Map(roles.flatMap((role) => typeof role.id === "string" && typeof role.name === "string" ? [[role.id, role.name] as const] : [])),
    channels: new Map(ordered.map((channel) => [channel.id, channel.name ?? channel.id])),
  };
  for (const channel of ordered) {
    if (checkpoint.completedConversationIds.includes(channel.id)) { log(`Skipping already-completed #${channel.name ?? channel.id}.`); continue; }
    try {
      await writeConversation(client, options.output, channel, options.messagesPerFile, resolver, context, failures, log);
      checkpoint.completedConversationIds.push(channel.id);
      checkpoint.conversations = context.conversations;
      await writeAtomicJson(path.join(options.output, CHECKPOINT_FILE), checkpoint);
      log(`Checkpointed completed #${channel.name ?? channel.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ scope: "conversation", channelId: channel.id, channelName: channel.name, error: message });
      log(`Failed #${channel.name ?? channel.id}: ${message}`);
      context.conversations.push({ id: channel.id, kind: isThread(channel) ? "thread" : "channel", parentId: channel.parent_id ?? null, name: channel.name ?? channel.id, type: channel.type, position: channel.position ?? 0, outputDir: outputDirectory(channel), pageCount: 0, messageCount: 0, status: "failed", error: message, pages: [] });
    }
  }
  const search: Array<{ id: string; channel: string; author: string; text: string; excerpt: string; path: string }> = [];
  for (const conversation of context.conversations.filter((item) => item.status === "exported")) {
    for (let page = 0; page < conversation.pageCount; page += 1) {
      const raw = JSON.parse(await readFile(path.join(options.output, conversation.outputDir, `messages-${String(page + 1).padStart(6, "0")}.json`), "utf8")) as { messages: Array<{ normalized: NormalizedMessage }> };
      for (const item of raw.messages) {
        const text = item.normalized.content;
        context.messageLinks.set(`${item.normalized.channelId}:${item.normalized.id}`, path.posix.join(conversation.outputDir, conversation.pages[page]));
        search.push({ id: item.normalized.id, channel: conversation.name, author: item.normalized.author.name, text: text.toLowerCase(), excerpt: text.slice(0, 180), path: path.posix.join(conversation.outputDir, conversation.pages[page]) });
      }
    }
  }
  // Re-render after discovery so every page has the complete sidebar, including resumed conversations.
  for (const conversation of context.conversations.filter((item) => item.status === "exported")) {
    for (let page = 0; page < conversation.pageCount; page += 1) {
      const raw = JSON.parse(await readFile(path.join(options.output, conversation.outputDir, `messages-${String(page + 1).padStart(6, "0")}.json`), "utf8")) as { messages: Array<{ normalized: NormalizedMessage }> };
      await writeText(path.join(options.output, conversation.outputDir, conversation.pages[page]), renderConversationPage(context, conversation, page, raw.messages.map((item) => item.normalized)));
    }
  }
  await writeText(path.join(options.output, "assets", "search-index.js"), `window.DISCORD_ARCHIVE_SEARCH=${JSON.stringify(search)};\n`);
  log(`Wrote search index with ${search.length} message record(s).`);
  await writeText(path.join(options.output, "index.html"), renderIndex(context));
  const manifest: ArchiveManifest = { schemaVersion: 1, exporterVersion: VERSION, exportedAt: new Date().toISOString(), guild, conversations: context.conversations.map(({ pages: _pages, ...record }) => record) };
  await writeJson(path.join(options.output, "manifest.json"), manifest);
  await writeJson(path.join(options.output, "export-report.json"), { schemaVersion: 1, exportedAt: manifest.exportedAt, guildId: options.guildId, messageCount: context.conversations.reduce((sum, item) => sum + item.messageCount, 0), conversationCount: context.conversations.length, failures });
  log(`Finished: ${manifest.conversations.filter((item) => item.status === "exported").length} exported conversation(s), ${failures.length} recorded issue(s).`);
  return manifest;
}
