#!/usr/bin/env node
import path from "node:path";
import { exportGuild } from "./exporter.js";

function usage(): string {
  return `discord-server-backup export --guild <id> --output <directory> [--format html|markdown] [--messages-per-file 2000] [--resume]\n\nExports one authorized Discord server to a portable HTML or Markdown archive.\n\nRequired environment:\n  DISCORD_BOT_TOKEN  Bot token with Message Content intent and channel access.\n`;
}

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) { process.stdout.write(usage()); return; }
  if (args[0] !== "export") throw new Error(`Unknown command: ${args[0]}\n\n${usage()}`);
  const guildId = option(args, "--guild");
  const output = option(args, "--output");
  if (!guildId || !output) throw new Error(`--guild and --output are required.\n\n${usage()}`);
  const size = option(args, "--messages-per-file") ?? "2000";
  const messagesPerFile = Number.parseInt(size, 10);
  const format = option(args, "--format") ?? "html";
  if (format !== "html" && format !== "markdown") throw new Error("--format must be either html or markdown.");
  const manifest = await exportGuild({ guildId, output: path.resolve(output), format, messagesPerFile, resume: args.includes("--resume"), token: process.env.DISCORD_BOT_TOKEN ?? "" });
  process.stdout.write(`Archive written to ${path.resolve(output)} (${manifest.conversations.filter((item) => item.status === "exported").length} conversations).\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
