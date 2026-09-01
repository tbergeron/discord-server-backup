import assert from "node:assert/strict";
import test from "node:test";
import { renderConversationPage, renderMarkdownConversation } from "./render.js";
import type { RenderContext, RenderConversation } from "./render.js";
import type { NormalizedMessage } from "./types.js";

const conversation: RenderConversation = {
  id: "123456789012345678",
  kind: "channel",
  parentId: null,
  name: "general",
  type: 0,
  position: 1,
  outputDir: "channels/0001-general--123456789012345678",
  pageCount: 2,
  messageCount: 2,
  status: "exported",
  pages: ["index.html", "page-0002.html"],
};

const context: RenderContext = { root: "/tmp/archive", guildId: "123", guildName: "Example Guild", conversations: [conversation], messageLinks: new Map([["123456789012345678:444", "channels/0001-general--123456789012345678/page-0002.html"]]) };
const message: NormalizedMessage = {
  id: "999999999999999999",
  channelId: conversation.id,
  timestamp: "2026-08-30T12:00:00.000Z",
  editedTimestamp: null,
  content: "Hello <script>alert(1)</script> https://discord.com/channels/123/123456789012345678/444",
  author: { id: "1", name: "Ada", username: "ada", avatarPath: null, isBot: false },
  attachments: [{ id: "2", filename: "photo.png", contentType: "image/png", size: 10, sha256: "abc", localPath: `${conversation.outputDir}/attachments/999999999999999999/2--photo.png`, sourceUrl: "https://cdn.discordapp.com/example", status: "downloaded" }],
  replyTo: null,
  reactions: [{ name: "👍", count: 2 }],
  embeds: [],
};

test("channel renderer emits safe local attachment links and part navigation", () => {
  const html = renderConversationPage(context, conversation, 0, [message]);
  assert.match(html, /attachments\/999999999999999999\/2--photo\.png/);
  assert.match(html, /page-0002\.html/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /id="message-999999999999999999"/);
  assert.match(html, /data-sidebar-toggle/);
  assert.match(html, /archive-sidebar/);
  assert.match(html, /page-0002\.html#message-444/);
});

test("Markdown renderer emits local media and same-server message anchors", () => {
  const markdownConversation: RenderConversation = { ...conversation, pages: ["index.md", "page-0002.md"] };
  const markdownContext: RenderContext = { ...context, conversations: [markdownConversation], messageLinks: new Map([["123456789012345678:444", "channels/0001-general--123456789012345678/page-0002.md"]]) };
  const markdown = renderMarkdownConversation(markdownContext, markdownConversation, 0, [message]);
  assert.match(markdown, /!\[photo\.png\]\(attachments\/999999999999999999\/2--photo\.png\)/);
  assert.match(markdown, /page-0002\.md#message-444/);
  assert.match(markdown, /<a id="message-999999999999999999"><\/a>/);
});
