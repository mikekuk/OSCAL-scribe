import { flatten, preview } from "../shared/lens/engine.mjs";
import type { PinnedBaseline } from "../shared/types";

// The resolved catalogue is resolvedRows; Lens only enriches its provenance.
export function buildControlRows(baseline: PinnedBaseline) {
  const resolvedRows = flatten(baseline.profile.resolved.catalog) as any[];
  try {
    const sources = baseline.sources.map((source) => ({
        ...source,
        name: source.path.split("/").pop(),
      })),
      profile = sources.find((source) => source.path === baseline.profile.path);
    if (!profile) return resolvedRows;
    const previewResult = preview(profile.doc, sources);
    for (const row of resolvedRows) {
      const origin = previewResult.rows.filter(
        (r: any) => r.control.id === row.control.id,
      );
      if (origin.length === 1) {
        row.baseControl = origin[0].baseControl;
        row.baseParameters = origin[0].baseParameters;
      }
    }
  } catch {
    /* Authoritative resolved content remains usable when Lens cannot preview a merge. */
  }
  return resolvedRows;
}
