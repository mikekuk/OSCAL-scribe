import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadPinnedJson } from "../scripts/reference-content";

const data = '{"catalog":{"uuid":"example"}}';
const source = {path:"catalog.json", url:"https://example.com/catalog.json", sha256:createHash("sha256").update(data).digest("hex")};

test("pinned downloads verify cached content and repair a changed cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "scribe-reference-"));
  let calls = 0;
  const download: typeof fetch = async () => { calls++; return new Response(data); };
  try {
    await downloadPinnedJson(root, source, download);
    await downloadPinnedJson(root, source, download);
    assert.equal(calls, 1);
    await writeFile(join(root, source.path), "corrupted");
    await downloadPinnedJson(root, source, download);
    assert.equal(calls, 2);
    assert.equal(await readFile(join(root, source.path), "utf8"), data);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test("invalid downloads and path escapes never enter the reference cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "scribe-reference-"));
  try {
    await assert.rejects(downloadPinnedJson(root, source, async () => new Response("changed")), /checksum mismatch/);
    await assert.rejects(readFile(join(root, source.path)), {code:"ENOENT"});
    await assert.rejects(downloadPinnedJson(root, source, async () => new Response("", {status:503})), /download failed/);
    await assert.rejects(downloadPinnedJson(root, {...source, path:"../outside.json"}), /source path/);
    const invalid = "invalid-json";
    await assert.rejects(downloadPinnedJson(root, {...source, sha256:createHash("sha256").update(invalid).digest("hex")}, async () => new Response(invalid)), SyntaxError);
    await assert.rejects(readFile(join(root, source.path)), {code:"ENOENT"});
  } finally { await rm(root, {recursive:true, force:true}); }
});
