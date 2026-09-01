export type Snowflake = string;
export type OutputFormat = "html" | "markdown";

export interface DiscordAttachment {
  id: Snowflake;
  filename: string;
  url: string;
  proxy_url?: string;
  content_type?: string | null;
  size?: number;
  width?: number | null;
  height?: number | null;
  description?: string | null;
  ephemeral?: boolean;
}

export interface DiscordAuthor {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface DiscordMessage {
  id: Snowflake;
  channel_id: Snowflake;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  author: DiscordAuthor;
  attachments: DiscordAttachment[];
  embeds?: unknown[];
  reactions?: Array<{ count: number; me?: boolean; emoji: { id?: Snowflake | null; name?: string | null } }>;
  message_reference?: { message_id?: Snowflake; channel_id?: Snowflake; guild_id?: Snowflake };
  referenced_message?: DiscordMessage | null;
  stickers?: unknown[];
  [key: string]: unknown;
}

export interface DiscordChannel {
  id: Snowflake;
  guild_id?: Snowflake;
  type: number;
  name?: string | null;
  parent_id?: Snowflake | null;
  position?: number;
  topic?: string | null;
  thread_metadata?: { archived?: boolean; archive_timestamp?: string };
  [key: string]: unknown;
}

export interface LocalAttachment {
  id: Snowflake;
  filename: string;
  contentType: string | null;
  size: number | null;
  sha256: string | null;
  localPath: string | null;
  sourceUrl: string;
  status: "downloaded" | "failed" | "skipped";
  error?: string;
}

export interface NormalizedMessage {
  id: Snowflake;
  channelId: Snowflake;
  timestamp: string;
  editedTimestamp: string | null;
  content: string;
  author: { id: Snowflake; name: string; username: string; avatarPath: string | null; isBot: boolean };
  attachments: LocalAttachment[];
  replyTo: { messageId: Snowflake; channelId: Snowflake | null } | null;
  reactions: Array<{ name: string; count: number }>;
  embeds: Array<{ title: string | null; description: string | null; url: string | null }>;
}

export interface ConversationRecord {
  id: Snowflake;
  kind: "channel" | "thread";
  parentId: Snowflake | null;
  name: string;
  type: number;
  position: number;
  outputDir: string;
  pageCount: number;
  messageCount: number;
  status: "exported" | "skipped" | "failed";
  error?: string;
}

export interface ArchiveManifest {
  schemaVersion: 1;
  exporterVersion: string;
  exportedAt: string;
  format: OutputFormat;
  guild: Record<string, unknown>;
  conversations: ConversationRecord[];
}
