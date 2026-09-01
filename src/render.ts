import path from "node:path";
import type { ConversationRecord, NormalizedMessage } from "./types.js";
import { escapeHtml, isAudio, isImage, isVideo, relativeUrl, renderText } from "./utils.js";

export interface RenderConversation extends ConversationRecord {
  pages: string[];
}

export interface RenderContext {
  root: string;
  guildId: string;
  conversations: RenderConversation[];
  guildName: string;
  /** `${channelId}:${messageId}` -> archive-root-relative HTML file */
  messageLinks: Map<string, string>;
}

function link(fromDir: string, root: string, target: string): string {
  return relativeUrl(fromDir, path.join(root, target));
}

function sidebar(context: RenderContext, currentId: string | null, fromDir: string): string {
  const channelLinks = context.conversations
    .filter((item) => item.status === "exported")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((item) => {
      const href = link(fromDir, context.root, path.posix.join(item.outputDir, item.pages[0]));
      const active = item.id === currentId ? " current" : "";
      const icon = item.kind === "thread" ? "↳" : "#";
      return `<a class="channel${active}" href="${escapeHtml(href)}">${icon} ${escapeHtml(item.name)}</a>`;
    }).join("\n");
  return `<aside class="sidebar" id="archive-sidebar"><a class="brand" href="${escapeHtml(link(fromDir, context.root, "index.html"))}">${escapeHtml(context.guildName)}</a><label class="search"><span>Search</span><input data-global-search placeholder="Search this archive" autocomplete="off"></label><nav>${channelLinks}</nav></aside>`;
}

function attachmentHtml(message: NormalizedMessage, fromDir: string, root: string): string {
  if (!message.attachments.length) return "";
  const items = message.attachments.map((attachment) => {
    if (attachment.status !== "downloaded" || !attachment.localPath) {
      return `<div class="file-card failed"><strong>${escapeHtml(attachment.filename)}</strong><span>Unavailable: ${escapeHtml(attachment.error ?? "download failed")}</span></div>`;
    }
    const href = link(fromDir, root, attachment.localPath);
    const label = escapeHtml(attachment.filename);
    if (isImage(attachment.contentType, attachment.filename)) {
      return `<a class="image-attachment" href="${escapeHtml(href)}" target="_blank"><img loading="lazy" src="${escapeHtml(href)}" alt="${label}"></a>`;
    }
    if (isVideo(attachment.contentType, attachment.filename)) {
      return `<video class="media-attachment" controls preload="metadata" src="${escapeHtml(href)}"></video>`;
    }
    if (isAudio(attachment.contentType, attachment.filename)) {
      return `<audio class="audio-attachment" controls preload="metadata" src="${escapeHtml(href)}"></audio>`;
    }
    const details = [attachment.contentType, attachment.size === null ? null : `${attachment.size.toLocaleString()} bytes`].filter(Boolean).join(" · ");
    return `<a class="file-card" href="${escapeHtml(href)}" target="_blank" download><span class="file-icon">↧</span><span><strong>${label}</strong><small>${escapeHtml(details || "Attachment")}</small></span></a>`;
  }).join("\n");
  return `<div class="attachments">${items}</div>`;
}

function localDiscordMessageHref(url: string, currentDirectory: string, context: RenderContext): string | null {
  const match = url.match(/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:[?#].*)?$/);
  if (!match || match[1] !== context.guildId) return null;
  const target = context.messageLinks.get(`${match[2]}:${match[3]}`);
  return target ? `${link(currentDirectory, context.root, target)}#message-${match[3]}` : null;
}

function rewriteMarkdownMessageLinks(value: string, currentDirectory: string, context: RenderContext): string {
  return value.replace(/https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:[?#][^\s]*)?/g, (url, guildId: string, channelId: string, messageId: string) => {
    if (guildId !== context.guildId) return url;
    const target = context.messageLinks.get(`${channelId}:${messageId}`);
    return target ? `[Discord message](${link(currentDirectory, context.root, target)}#message-${messageId})` : url;
  });
}

function embedHtml(message: NormalizedMessage): string {
  return message.embeds.map((embed) => {
    const title = embed.title ? `<strong>${escapeHtml(embed.title)}</strong>` : "";
    const description = embed.description ? `<p>${renderText(embed.description)}</p>` : "";
    const titleLink = embed.url && title ? `<a href="${escapeHtml(embed.url)}" target="_blank" rel="noreferrer noopener">${title}</a>` : title;
    return `<blockquote class="embed">${titleLink}${description}${embed.url && !title ? `<a href="${escapeHtml(embed.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(embed.url)}</a>` : ""}</blockquote>`;
  }).join("");
}

function messageHtml(message: NormalizedMessage, fromDir: string, context: RenderContext): string {
  const reply = message.replyTo
    ? `<a class="reply" href="#message-${escapeHtml(message.replyTo.messageId)}">↩ Reply to ${escapeHtml(message.replyTo.messageId)}</a>`
    : "";
  const edited = message.editedTimestamp ? " <span class=\"edited\">(edited)</span>" : "";
  const reactions = message.reactions.length ? `<div class="reactions">${message.reactions.map((reaction) => `<span>${escapeHtml(reaction.name)} ${reaction.count}</span>`).join("")}</div>` : "";
  const avatar = message.author.avatarPath ? `<span class="avatar" style="background-image:url('${escapeHtml(link(fromDir, context.root, message.author.avatarPath))}')"></span>` : `<span class="avatar initial">${escapeHtml(message.author.name.slice(0, 1).toUpperCase())}</span>`;
  return `<article class="message" id="message-${escapeHtml(message.id)}">${avatar}<div class="message-body">${reply}<header><strong>${escapeHtml(message.author.name)}</strong>${message.author.isBot ? " <span class=\"bot-tag\">BOT</span>" : ""}<time datetime="${escapeHtml(message.timestamp)}">${escapeHtml(new Date(message.timestamp).toLocaleString())}</time>${edited}</header><div class="content">${renderText(message.content, (url) => localDiscordMessageHref(url, fromDir, context))}</div>${embedHtml(message)}${attachmentHtml(message, fromDir, context.root)}${reactions}</div></article>`;
}

export function renderConversationPage(context: RenderContext, conversation: RenderConversation, pageIndex: number, messages: NormalizedMessage[]): string {
  const filename = conversation.pages[pageIndex];
  const directory = path.join(context.root, conversation.outputDir);
  const pageLinks = conversation.pages.map((page, index) => index === pageIndex ? `<span class="page-current">${index + 1}</span>` : `<a href="${escapeHtml(page)}">${index + 1}</a>`).join("");
  const body = messages.length ? messages.map((message) => messageHtml(message, directory, context)).join("\n") : `<p class="empty">No messages were visible to the bot in this conversation.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(conversation.name)} — ${escapeHtml(context.guildName)}</title><link rel="stylesheet" href="${escapeHtml(link(directory, context.root, "assets/style.css"))}"><script src="${escapeHtml(link(directory, context.root, "assets/search-index.js"))}" defer></script><script src="${escapeHtml(link(directory, context.root, "assets/viewer.js"))}" defer></script></head><body><div class="app">${sidebar(context, conversation.id, directory)}<main><header class="conversation-header"><button class="mobile-menu" data-sidebar-toggle type="button" aria-controls="archive-sidebar">Channels</button><span>#</span><h1>${escapeHtml(conversation.name)}</h1><button data-theme-toggle type="button">Theme</button></header><section class="timeline">${body}</section>${conversation.pages.length > 1 ? `<nav class="pagination">Pages ${pageLinks}</nav>` : ""}</main></div><button class="sidebar-scrim" data-sidebar-toggle type="button" aria-label="Close channel navigation"></button><div class="search-results" hidden data-search-results></div></body></html>`;
}

export function renderIndex(context: RenderContext): string {
  const exported = context.conversations.filter((item) => item.status === "exported");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(context.guildName)} archive</title><link rel="stylesheet" href="assets/style.css"><script src="assets/search-index.js" defer></script><script src="assets/viewer.js" defer></script></head><body><div class="app">${sidebar(context, null, context.root)}<main class="welcome"><button class="mobile-menu" data-sidebar-toggle type="button" aria-controls="archive-sidebar">Channels</button><button data-theme-toggle type="button">Theme</button><h1>${escapeHtml(context.guildName)}</h1><p>Offline Discord archive with ${exported.length} exported conversations.</p><p>Select a channel or search the archive.</p></main></div><button class="sidebar-scrim" data-sidebar-toggle type="button" aria-label="Close channel navigation"></button><div class="search-results" hidden data-search-results></div></body></html>`;
}

function markdownAttachments(message: NormalizedMessage, fromDir: string, context: RenderContext): string {
  return message.attachments.map((attachment) => {
    if (attachment.status !== "downloaded" || !attachment.localPath) return `- **${attachment.filename}** — unavailable: ${attachment.error ?? "download failed"}`;
    const href = link(fromDir, context.root, attachment.localPath);
    return isImage(attachment.contentType, attachment.filename)
      ? `![${attachment.filename}](${href})`
      : `- [${attachment.filename}](${href})`;
  }).join("\n");
}

export function renderMarkdownConversation(context: RenderContext, conversation: RenderConversation, pageIndex: number, messages: NormalizedMessage[]): string {
  const directory = path.join(context.root, conversation.outputDir);
  const pageNavigation = conversation.pages.length > 1
    ? `\n\nPages: ${conversation.pages.map((page, index) => index === pageIndex ? `**${index + 1}**` : `[${index + 1}](${page})`).join(" · ")}`
    : "";
  const content = messages.length ? messages.map((message) => {
    const edited = message.editedTimestamp ? " (edited)" : "";
    const reply = message.replyTo ? `\n\n> Reply to [${message.replyTo.messageId}](#message-${message.replyTo.messageId})` : "";
    const reactions = message.reactions.length ? `\n\nReactions: ${message.reactions.map((reaction) => `${reaction.name} ${reaction.count}`).join(" · ")}` : "";
    const attachments = markdownAttachments(message, directory, context);
    const embed = message.embeds.map((item) => [item.title, item.description, item.url].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
    return `<a id="message-${message.id}"></a>\n\n## ${message.author.name} — ${new Date(message.timestamp).toLocaleString()}${edited}${reply}\n\n${rewriteMarkdownMessageLinks(message.content, directory, context)}${embed ? `\n\n${embed}` : ""}${attachments ? `\n\n${attachments}` : ""}${reactions}\n`;
  }).join("\n---\n") : "_No messages were visible to the bot in this conversation._\n";
  return `# #${conversation.name}\n\n${conversation.kind === "thread" ? "Thread" : "Channel"} archive for **${context.guildName}**.${pageNavigation}\n\n${content}`;
}

export function renderMarkdownIndex(context: RenderContext): string {
  const conversations = context.conversations.filter((item) => item.status === "exported").sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return `# ${context.guildName} archive\n\nPortable Markdown export. Open a channel below:\n\n${conversations.map((conversation) => `- [${conversation.kind === "thread" ? "↳" : "#"} ${conversation.name}](${path.posix.join(conversation.outputDir, conversation.pages[0])})`).join("\n")}\n`;
}

export const STYLE_CSS = `:root{color-scheme:dark;--bg:#313338;--panel:#2b2d31;--sidebar:#1e1f22;--text:#dbdee1;--muted:#949ba4;--link:#00a8fc;--line:#3f4147;--card:#383a40}html[data-theme=light]{color-scheme:light;--bg:#fff;--panel:#f2f3f5;--sidebar:#e3e5e8;--text:#313338;--muted:#5c6068;--link:#006ce7;--line:#d7d9de;--card:#f2f3f5}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.app{display:flex;min-height:100vh}.sidebar{position:sticky;top:0;width:270px;height:100vh;overflow:auto;background:var(--sidebar);padding:14px 10px}.brand{display:block;color:var(--text);font-weight:700;text-decoration:none;padding:6px 8px 14px}.search{display:block;color:var(--muted);font-size:12px;padding:0 6px 12px}.search input{width:100%;margin-top:5px;border:0;border-radius:4px;padding:8px;background:#111214;color:#eee}.channel{display:block;color:var(--muted);text-decoration:none;padding:6px 8px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.channel:hover,.channel.current{color:var(--text);background:rgba(255,255,255,.08)}main{flex:1;min-width:0}.conversation-header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:9px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel)}.conversation-header h1{font-size:16px;margin:0}.conversation-header button,.welcome button{margin-left:auto}.mobile-menu,.sidebar-scrim{display:none}.timeline{padding:10px 0}.message{display:flex;gap:14px;padding:8px 20px}.message:hover{background:rgba(255,255,255,.025)}.avatar{display:block;width:40px;height:40px;flex:0 0 40px;border-radius:50%;background:#5865f2 center/cover}.avatar.initial{display:grid;place-items:center;color:white;font-weight:700}.message-body{min-width:0;max-width:900px}.message header{margin-bottom:3px}.message time,.edited{font-size:12px;color:var(--muted);margin-left:8px}.bot-tag{font-size:10px;background:#5865f2;color:#fff;border-radius:3px;padding:1px 3px}.content{line-height:1.45;overflow-wrap:anywhere}.content a,.embed a{color:var(--link)}.content code{background:rgba(0,0,0,.2);padding:1px 3px;border-radius:3px}.attachments{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.image-attachment img{display:block;max-width:min(550px,100%);max-height:420px;border-radius:5px}.media-attachment{max-width:min(600px,100%);max-height:420px;border-radius:5px}.audio-attachment{width:min(420px,100%)}.file-card{display:flex;align-items:center;gap:10px;min-width:250px;max-width:420px;padding:10px;background:var(--card);border:1px solid var(--line);border-radius:5px;color:var(--text);text-decoration:none}.file-card small,.file-card span{display:block;color:var(--muted)}.file-icon{font-size:24px}.failed{display:block}.embed{margin:8px 0 0;border-left:4px solid #4e5058;background:rgba(0,0,0,.08);padding:8px 12px}.embed p{margin:5px 0}.reply{display:block;font-size:12px;color:var(--muted);text-decoration:none;margin-bottom:4px}.reactions{display:flex;gap:5px;margin-top:5px}.reactions span{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:2px 6px;font-size:13px}.pagination{padding:20px;display:flex;gap:8px}.pagination a,.page-current{padding:5px 9px;border-radius:4px;background:var(--card);color:var(--link)}.page-current{color:var(--text)}.welcome{padding:50px;max-width:680px}.empty{padding:28px;color:var(--muted)}.search-results{position:fixed;z-index:4;left:280px;top:60px;right:20px;max-width:760px;max-height:70vh;overflow:auto;background:var(--panel);border:1px solid var(--line);box-shadow:0 10px 30px #0008;border-radius:8px;padding:8px}.search-results a{display:block;color:var(--text);text-decoration:none;padding:10px;border-radius:4px}.search-results a:hover{background:var(--card)}.search-results small{color:var(--muted);display:block}@media(max-width:720px){.sidebar{position:fixed;z-index:10;width:min(82vw,320px);transform:translateX(-105%);transition:transform .18s ease;box-shadow:6px 0 24px #0008}.mobile-menu{display:inline-block;margin-left:0!important}.sidebar-scrim{display:block;position:fixed;z-index:9;inset:0;border:0;background:#0008;opacity:0;pointer-events:none;transition:opacity .18s ease}html[data-sidebar-open] .sidebar{transform:translateX(0)}html[data-sidebar-open] .sidebar-scrim{opacity:1;pointer-events:auto}.message{padding:8px 12px}.search-results{left:10px;right:10px}.avatar{width:32px;height:32px;flex-basis:32px}.conversation-header{padding:12px}.welcome{padding:24px}.welcome .mobile-menu{margin-right:8px}}`;

export const VIEWER_JS = `(()=>{const root=document.documentElement;const key='discord-archive-theme';if(localStorage.getItem(key)==='light')root.dataset.theme='light';document.addEventListener('click',e=>{const sidebarButton=e.target.closest('[data-sidebar-toggle]');if(sidebarButton){root.toggleAttribute('data-sidebar-open');return}if(e.target.closest('.channel'))root.removeAttribute('data-sidebar-open');const button=e.target.closest('[data-theme-toggle]');if(button){root.dataset.theme=root.dataset.theme==='light'?'':'light';localStorage.setItem(key,root.dataset.theme||'dark')}});const input=document.querySelector('[data-global-search]'),box=document.querySelector('[data-search-results]');if(!input||!box)return;const script=document.currentScript;const archiveRoot=script&&script.src?new URL('../',new URL(script.src)):null;input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();if(!query){box.hidden=true;box.innerHTML='';return}const rows=(window.DISCORD_ARCHIVE_SEARCH||[]).filter(x=>x.text.includes(query)||x.author.includes(query)||x.channel.includes(query)).slice(0,50);box.innerHTML=rows.length?rows.map(x=>{const href=archiveRoot?new URL(x.path,archiveRoot).href:x.path;return '<a href="'+href+'#message-'+x.id+'"><strong>#'+x.channel+'</strong> · '+x.author+'<small>'+x.excerpt+'</small></a>'}).join(''):'<div class="empty">No matching messages.</div>';box.hidden=false});document.addEventListener('keydown',e=>{if(e.key==='Escape'){box.hidden=true;input.blur();root.removeAttribute('data-sidebar-open')}})})();`;
