import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import reference from "../content/reference.json";

interface PinnedSource {
  path: string;
  url: string;
  sha256: string;
}

export async function downloadPinnedJson(
  root: string,
  source: PinnedSource,
  download: typeof fetch = fetch,
): Promise<void> {
  // Sources are flat files. Reject path escapes before reading the local cache.
  if (!/^[a-zA-Z0-9_.-]+\.json$/.test(source.path)) {
    throw Error("Invalid reference source path");
  }
  const file = join(root, source.path);
  const matches = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex") === source.sha256;
  let cached: Buffer | undefined;
  try { cached = await readFile(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A cache hit is trusted only after checking the committed digest again.
  if (cached && matches(cached)) {
    JSON.parse(cached.toString("utf8"));
    return;
  }
  const response = await download(source.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw Error(`Reference download failed: ${source.path}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!matches(data)) throw Error(`Reference checksum mismatch: ${source.path}`);
  JSON.parse(data.toString("utf8"));
  await mkdir(root, { recursive: true });
  await writeFile(file, data);
}

export async function prepareReferenceSources(root: string) {
  for (const source of reference.files) await downloadPinnedJson(root, source);
  return reference;
}
