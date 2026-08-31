import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscordChannel, DiscordMessage } from "./types.js";

const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class DiscordClient {
  constructor(private readonly token: string, private readonly log: (message: string) => void = () => {}) {}

  private async request<T>(route: string, retries = 4): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      this.log(`API GET ${route}`);
      const response = await fetch(`${API}${route}`, {
        headers: {
          Authorization: `Bot ${this.token}`,
          "User-Agent": "DiscordBot (https://github.com/tbergeron/discord-server-backup, 0.1.0)",
        },
      });
      if (response.ok) {
        this.log(`API ${response.status} ${route}`);
        return (await response.json()) as T;
      }
      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        let delayMs = 500 * 2 ** attempt;
        try { delayMs = Math.max(delayMs, Number((JSON.parse(body) as { retry_after?: number }).retry_after ?? 0) * 1000); } catch { /* fall back */ }
        this.log(`API ${response.status} ${route}; retrying in ${Math.ceil(delayMs)}ms (${attempt + 1}/${retries})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw new DiscordApiError(response.status, `${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
    }
  }

  getGuild(guildId: string): Promise<Record<string, unknown>> { return this.request(`/guilds/${guildId}`); }
  getGuildChannels(guildId: string): Promise<DiscordChannel[]> { return this.request(`/guilds/${guildId}/channels`); }
  getGuildRoles(guildId: string): Promise<Array<Record<string, unknown>>> { return this.request(`/guilds/${guildId}/roles`); }
  getActiveThreads(guildId: string): Promise<{ threads: DiscordChannel[] }> { return this.request(`/guilds/${guildId}/threads/active`); }
  getMessages(channelId: string, before?: string): Promise<DiscordMessage[]> {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    return this.request(`/channels/${channelId}/messages?${query}`);
  }
  getArchivedThreads(channelId: string, kind: "public" | "private", before?: string): Promise<{ threads: DiscordChannel[]; has_more: boolean }> {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    return this.request(`/channels/${channelId}/threads/archived/${kind}?${query}`);
  }

  async download(url: string, destination: string): Promise<{ sha256: string; size: number; contentType: string | null }> {
    this.log(`Downloading ${destination}`);
    const response = await fetch(url, { headers: { "User-Agent": "discord-server-backup/0.1.0" } });
    if (!response.ok) throw new Error(`Attachment download failed: ${response.status} ${response.statusText}`);
    const data = new Uint8Array(await response.arrayBuffer());
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, destination);
    this.log(`Downloaded ${destination} (${data.byteLength.toLocaleString()} bytes)`);
    return { sha256: createHash("sha256").update(data).digest("hex"), size: data.byteLength, contentType: response.headers.get("content-type") };
  }
}
