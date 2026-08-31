# Discord Server Backup

`discord-server-backup` creates a one-time, self-contained archive of a Discord server that an authorized bot can read. It stores the original API payloads, downloads attachments locally, and generates a portable Discord-inspired HTML viewer.

The archive is designed to be opened by double-clicking `index.html`. It does not run a server, send data to another service, or keep watching the server after the command exits.

## Install and build

Node.js 22 or newer is required.

```bash
npm install
npm run build
```

Run the built CLI from this checkout:

```bash
DISCORD_BOT_TOKEN='your-bot-token' node dist/cli.js export \
  --guild 123456789012345678 \
  --output ./my-server-archive
```

The token is read only from `DISCORD_BOT_TOKEN`. Do not put it in a shell script committed to Git, an archive directory, or a CLI flag.

## Commands

```text
discord-server-backup export --guild <id> --output <directory>
  [--messages-per-file 2000] [--resume]
```

- `--guild` is the numeric Discord server ID.
- `--output` must be a new or empty directory. Existing completed archives are never overwritten.
- `--messages-per-file` defaults to 2,000. Larger conversations are split into chronological `index.html`, `page-0002.html`, and matching JSON pages.
- `--resume` continues an archive that contains its checkpoint file. It may re-render the static viewer but does not repeat completed conversations.

When successful, open `<output>/index.html` directly in a modern browser. The viewer has a channel sidebar, light/dark toggle, per-channel pagination, inline local media, file cards, and full-text search.

The CLI writes detailed progress to both the terminal and `<output>/export.log`: API discovery, message-history pages, every attachment/avatar download, generated archive parts, checkpoints, and the final issue count. It deliberately never prints the bot token or complete signed attachment URLs. On phones, the archive’s channel list becomes a slide-out drawer opened with **Channels**.

## Setup and limits

See [Discord setup](docs/SETUP.md) before creating a token. The bot needs the privileged Message Content intent and `VIEW_CHANNEL` plus `READ_MESSAGE_HISTORY` in every conversation to be archived. It cannot export content that Discord has already deleted or that the bot cannot access.

See [archive format](docs/ARCHIVE_FORMAT.md) for the exact JSON and directory contract, and [privacy guidance](docs/PRIVACY.md) before sharing an archive.

## Development

```bash
npm run check
npm test
node dist/cli.js --help
```

The test suite uses fixtures and does not contact Discord. A real export is an authorized acceptance test: use a test server first, then inspect `export-report.json` for inaccessible channels and failed attachment downloads.
