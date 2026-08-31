import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function safeFilename(value: string, fallback = "unnamed"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/\.{2,}/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function slug(value: string): string {
  const result = safeFilename(value, "channel")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return result || "channel";
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
}

export async function writeAtomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeJson(temporary, value);
  await rename(temporary, file);
}

export function relativeUrl(fromDirectory: string, toFile: string): string {
  const result = path.relative(fromDirectory, toFile).split(path.sep).join("/");
  return result || ".";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A deliberately small, safe renderer for Discord text; raw HTML is never trusted. */
export function renderText(value: string, rewriteUrl?: (url: string) => string | null): string {
  const escaped = escapeHtml(value);
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const localHref = rewriteUrl?.(url);
    return localHref
      ? `<a href="${localHref}">${url}</a>`
      : `<a href="${url}" rel="noreferrer noopener" target="_blank">${url}</a>`;
  });
  return linked
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

export function isImage(contentType: string | null, filename: string): boolean {
  return Boolean(contentType?.startsWith("image/")) || /\.(avif|gif|jpe?g|png|webp)$/i.test(filename);
}

export function isVideo(contentType: string | null, filename: string): boolean {
  return Boolean(contentType?.startsWith("video/")) || /\.(m4v|mov|mp4|webm)$/i.test(filename);
}

export function isAudio(contentType: string | null, filename: string): boolean {
  return Boolean(contentType?.startsWith("audio/")) || /\.(aac|flac|m4a|mp3|ogg|opus|wav)$/i.test(filename);
}
