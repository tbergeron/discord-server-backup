# Discord setup

This exporter must use an official Discord bot account. Do not automate a normal Discord user account.

## Create and invite the bot

1. Create an application in the Discord Developer Portal and add a Bot user.
2. On the **Bot** page, enable **Message Content Intent**. Without it, text, embeds, and attachment arrays can be empty.
3. Generate an OAuth2 URL with the `bot` scope and invite the bot to the server being exported.
4. Grant the smallest useful permissions:
   - `View Channel`
   - `Read Message History`
   - `Connect` when exporting text associated with voice channels
   - `Manage Threads` only when complete private archived-thread discovery is required
5. Apply channel overrides for every private channel intended for export. `Administrator` is not required and should not be used merely for convenience.
6. Copy the numeric server ID using Discord Developer Mode and provide it as `--guild`.

Set the secret only for the process that runs the export:

```bash
DISCORD_BOT_TOKEN='...' node dist/cli.js export --guild <server-id> --output ./archive
```

## What the exporter can and cannot see

- It can retrieve historical messages that remain in accessible channels.
- It records a failure instead of stopping if a channel, thread listing, message history, or attachment download is unavailable.
- It enumerates active guild threads, public archived threads, and private archived threads when permissions permit. Forum and media posts are exported as threads.
- It cannot recover deleted messages/files, private conversations without the bot’s permission, direct messages, or content returned empty because Message Content intent is not enabled or approved.
- Large or verified applications may require Discord approval for Message Content intent. Confirm current Discord requirements in the Developer Portal before running at scale.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN is required` | Secret was not supplied | Set the environment variable in the same shell command. |
| Empty message content or attachments | Message Content intent is disabled/unapproved | Enable the intent and reinvite/restart as required by Discord. |
| Conversation listed as failed | Missing per-channel permission or unavailable history | Check `export-report.json`, then add access and start a fresh export. |
| Private archived threads are absent | Bot lacks `Manage Threads` | Add that permission only if those threads must be included. |
| Resume is rejected | Wrong directory or guild ID | Resume only the original output folder with its checkpoint. |
