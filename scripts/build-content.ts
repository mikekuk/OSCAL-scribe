import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { resolve, join, dirname, isAbsolute, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { validate } from "../src/shared/validation";
import { flatten } from "../src/shared/lens/engine.mjs";
import { resolveImport } from "../src/shared/lens/imports.mjs";
import { hash } from "../src/api/service";
import type { Json, Release } from "../src/shared/types";
export async function buildContent(
  input: string,
  cli: string,
): Promise<Release> {
  const root = resolve(input),
    manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.profiles) ||
    !manifest.profiles.length
  )
    throw Error("Content manifest requires sources and profiles");
  if (
    new Set(manifest.sources).size !== manifest.sources.length ||
    new Set(manifest.profiles.map((p: any) => p.id)).size !==
      manifest.profiles.length
  )
    throw Error("Duplicate manifest entries");
  for (const p of manifest.profiles)
    if (!/^[a-z0-9-]{1,80}$/.test(p.id))
      throw Error("Invalid profile identifier");
  const sources: { path: string; doc: Json; name: string }[] = [];
  for (const path of manifest.sources) {
    if (
      isAbsolute(path) ||
      relative(root, resolve(root, path)).startsWith("..")
    )
      throw Error("Source outside content root");
    if (
      relative(
        await realpath(root),
        await realpath(join(root, path)),
      ).startsWith("..")
    )
      throw Error("Source symlink outside content root");
    const doc = JSON.parse(await readFile(join(root, path), "utf8")),
      errors = validate(doc, 20_000_000);
    if (errors.length) throw Error(path + ": " + errors.join("\n"));
    sources.push({ path, doc, name: path.split("/").pop()! });
  }
  // Resolve the approved import closure before launching the CLI; no external fetch fallback.
  function closure(
    entry: (typeof sources)[number],
    trail: string[] = [],
  ): void {
    if (trail.includes(entry.path))
      throw Error("Circular controlled-content import");
    const b = entry.doc.profile || entry.doc["component-definition"];
    if (!b) return;
    for (const imp of b.imports || b["import-component-definitions"] || [])
      closure(resolveImport(b, imp.href, entry, sources), [
        ...trail,
        entry.path,
      ]);
  }
  for (const source of sources) closure(source);
  const knownControls = new Set(
    sources
      .filter((s) => s.doc.catalog)
      .flatMap((s) => flatten(s.doc.catalog).map((r: any) => r.control.id)),
  );
  const componentIds = new Set<string>();
  for (const source of sources)
    for (const c of source.doc["component-definition"]?.components || []) {
      if (componentIds.has(c.uuid))
        throw Error("Duplicate approved component UUID");
      componentIds.add(c.uuid);
      for (const impl of c["control-implementations"] || []) {
        resolveImport(
          source.doc["component-definition"],
          impl.source,
          source,
          sources,
        );
        for (const r of impl["implemented-requirements"] || [])
          if (!knownControls.has(r["control-id"]))
            throw Error(
              "Component references unknown control " + r["control-id"],
            );
      }
    }
  // Stage only approved local sources. Rewrite all imports to local files before the CLI can follow them.
  const temporary = await mkdtemp(join(tmpdir(), "scribe-content-"));
  try {
    for (const entry of sources) {
      const copy = structuredClone(entry.doc);
      if (copy.profile) {
        for (const imp of copy.profile.imports) {
          const target = resolveImport(
            entry.doc.profile,
            imp.href,
            entry,
            sources,
          );
          imp.href = relative(dirname(entry.path), target.path).replaceAll(
            "\\",
            "/",
          );
        }
      }
      const destination = join(temporary, entry.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, JSON.stringify(copy));
    }
    const profiles = [];
    for (const p of manifest.profiles) {
      const source = sources.find((x) => x.path === p.path);
      if (!source?.doc.profile) throw Error("Profile source missing");
      const out = join(temporary, p.id + "-resolved.json");
      execFileSync(
        cli,
        ["resolve-profile", "--to=json", join(temporary, p.path), out],
        { timeout: 120000, stdio: "pipe", maxBuffer: 10_000_000 },
      );
      const resolved = JSON.parse(await readFile(out, "utf8"));
      const errors = validate(resolved, 20_000_000);
      if (errors.length)
        throw Error("Invalid resolved catalogue: " + errors.join("\n"));
      if (!flatten(resolved.catalog).length) throw Error("Empty profile");
      profiles.push({
        ...p,
        title: source.doc.profile.metadata.title,
        resolved,
      });
    }
    const result: Release = {
      id: "",
      demo: manifest.demo === true,
      sources: sources.map(({ path, doc }) => ({ path, doc })),
      profiles,
      components: sources
        .filter((x) => x.doc["component-definition"])
        .map((x) => x.doc),
      provenance: {
        ...manifest.provenance,
        resolver: "oscal-cli-enhanced 3.2.0",
      },
    };
    // Resolver generates UUID/timestamps. Stabilize resolution metadata from the input set so identical inputs are reproducible.
    for (const p of result.profiles) {
      p.resolved.catalog.uuid = sources.find(
        (x) => x.path === p.path,
      )!.doc.profile.uuid;
      p.resolved.catalog.metadata["last-modified"] = sources.find(
        (x) => x.path === p.path,
      )!.doc.profile.metadata["last-modified"];
      for (const link of p.resolved.catalog.metadata.links || [])
        if (link.rel === "resolution-source") link.href = p.path;
    }
    result.id = hash(result).slice(0, 32);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith("build-content.ts")) {
  const input = process.argv[2] || "work/demo-source",
    cli = process.env.OSCAL_CLI;
  if (!cli) throw Error("Set OSCAL_CLI to pinned 3.2.0 executable");
  const release = await buildContent(input, cli);
  await mkdir("work", { recursive: true });
  await writeFile("work/content-release.json", JSON.stringify(release));
  console.log(
    `Validated release ${release.id}: ${release.profiles.map((p) => p.id + " " + flatten(p.resolved.catalog).length + " controls").join(", ")}`,
  );
}
