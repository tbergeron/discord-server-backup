import assert from "node:assert/strict";
import test from "node:test";
import { isAudio, isImage, isVideo, renderText, safeFilename, slug } from "./utils.js";

test("safe filenames remove unsafe path characters", () => {
  assert.equal(safeFilename('../../sales:<final>.pdf'), 'sales--final-.pdf');
  assert.equal(slug('  General Chat!  '), 'general-chat');
});

test("renderer escapes HTML before adding safe links", () => {
  const output = renderText('<img src=x onerror=1> https://example.com');
  assert.match(output, /&lt;img/);
  assert.match(output, /href="https:\/\/example.com"/);
});

test("attachment classifiers use content type and safe extension fallback", () => {
  assert.equal(isImage(null, 'photo.webp'), true);
  assert.equal(isVideo('video/mp4', 'file.bin'), true);
  assert.equal(isAudio(null, 'voice.ogg'), true);
});
