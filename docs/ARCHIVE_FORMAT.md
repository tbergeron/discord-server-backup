# Archive format, version 1

An archive is a portable directory. All paths below are relative to the archive root. IDs are strings even when they contain only digits; this prevents loss of precision for Discord snowflakes.

```text
index.html
manifest.json
export-report.json
export.log
assets/
  style.css
  viewer.js
  search-index.js
  avatars/<user-id>.png
channels/<position>-<slug>--<channel-id>/
  index.html
  page-0002.html
  messages-000001.json
  messages-000002.json
  attachments/<message-id>/<attachment-id>--<safe-filename>
threads/<parent-channel-id>/<slug>--<thread-id>/
  index.html
  messages-000001.json
  attachments/<message-id>/<attachment-id>--<safe-filename>
```

## `manifest.json`

The manifest is written when an export finishes. It has `schemaVersion` (currently `1`), `exporterVersion`, `exportedAt`, the raw Discord `guild` object, and `conversations`. A conversation has its Discord `id`, `kind`, `parentId`, name/type/position, `outputDir`, page/message counts, status, and error when applicable.

Consumers must ignore unknown fields so later schema revisions can add metadata safely.

## Message pages

`messages-000001.json` is the first chronological page. Each file has this shape:

```json
{
  "schemaVersion": 1,
  "conversation": { "id": "...", "name": "general", "type": 0, "page": 1, "pageCount": 1 },
  "messages": [
    {
      "raw": { "id": "...", "content": "Original Discord API message object" },
      "normalized": {
        "id": "...",
        "channelId": "...",
        "timestamp": "2026-08-30T12:00:00.000Z",
        "editedTimestamp": null,
        "content": "Message text",
        "author": { "id": "...", "name": "Name", "username": "name", "avatarPath": "assets/avatars/...png", "isBot": false },
        "attachments": [],
        "replyTo": null,
        "reactions": [],
        "embeds": []
      }
    }
  ]
}
```

`raw` preserves the API response unchanged. `normalized` is the stable renderer-oriented representation. It adds local attachment state and uses archive-relative paths. It does not replace or reinterpret the raw data.

## Attachments and integrity

Each normalized attachment includes `id`, original `filename`, MIME `contentType`, byte `size`, `sourceUrl`, archive-relative `localPath`, `sha256`, and `status` (`downloaded`, `failed`, or `skipped`). A failed file has `localPath: null` and an `error`. Filenames are sanitized while retaining the attachment ID to avoid collisions.

## `export-report.json`

The report is written for both successful and partially successful exports. It contains total conversation/message counts and structured failures for inaccessible channels, thread-listing permissions, avatar downloads, and attachment downloads. Treat it as the source of truth for completeness.

`export.log` is a timestamped, human-readable copy of the live CLI progress and operational errors. It never contains the bot token or complete signed attachment URLs.

## Compatibility

Version 1 readers should require only fields documented above, preserve ID strings, and ignore unknown fields. Archives are static and self-contained; no network request is required to read stored messages or downloaded attachments.

When rendering HTML, Discord message URLs that point to this archive's guild and to an exported message are rewritten to the matching local HTML page and `#message-<id>` anchor. Links to another server or to an unavailable message remain external Discord URLs.
