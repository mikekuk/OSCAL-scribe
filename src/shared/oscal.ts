import { flatten } from "./lens/engine.mjs";
import type { Json, Release, Ssp } from "./types";
export const roles = [
  ["system-security-officer", "System Security Officer"],
  ["senior-risk-owner", "Senior Risk Owner"],
  ["security-architect", "Security Architect"],
  ["ssp-preparer", "SSP Preparer"],
];
export const uuid = () => crypto.randomUUID();
export function createSsp(
  name: string,
  profile: Release["profiles"][0],
  releaseId: string,
): Json {
  const now = new Date().toISOString(),
    system = uuid();
  return {
    "system-security-plan": {
      uuid: uuid(),
      metadata: {
        title: name + " System Security Plan",
        "last-modified": now,
        version: "1",
        "oscal-version": "1.2.2",
        roles: roles.map(([id, title]) => ({ id, title })),
      },
      "import-profile": { href: `urn:oscal-scribe:${releaseId}:${profile.id}` },
      "system-characteristics": {
        "system-ids": [{ id: system }],
        "system-name": name,
        description: "Describe the system, its purpose and scope.",
        "security-sensitivity-level": "low",
        "system-information": {
          "information-types": [
            {
              uuid: uuid(),
              title: "Business information",
              description:
                "Replace with the information processed by this system.",
              "confidentiality-impact": { base: "low" },
              "integrity-impact": { base: "low" },
              "availability-impact": { base: "low" },
            },
          ],
        },
        "security-impact-level": {
          "security-objective-confidentiality": "low",
          "security-objective-integrity": "low",
          "security-objective-availability": "low",
        },
        status: { state: "under-development" },
        "authorization-boundary": {
          description: "Describe the authorization boundary.",
        },
      },
      "system-implementation": {
        users: [
          {
            uuid: uuid(),
            title: "System operators",
            "role-ids": ["ssp-preparer"],
            "authorized-privileges": [
              {
                title: "Operate the system",
                "functions-performed": ["Operate approved system functions"],
              },
            ],
          },
        ],
        components: [
          {
            uuid: system,
            type: "this-system",
            title: name,
            description: "The system covered by this plan.",
            status: { state: "under-development" },
          },
        ],
      },
      "control-implementation": {
        description:
          "System-specific implementation of the selected approved baseline.",
        "implemented-requirements": flatten(profile.resolved.catalog).map(
          (r: any) => ({
            uuid: uuid(),
            "control-id": r.control.id,
            "by-components": [
              {
                uuid: uuid(),
                "component-uuid": system,
                description: "Implementation not yet documented.",
              },
            ],
            props: [
              {
                name: "implementation-status",
                ns: "https://oscal-scribe.example/ns",
                value: "planned",
              },
            ],
          }),
        ),
      },
    },
  };
}
export function statementParts(control: Json): Json[] {
  const result: Json[] = [];
  function visit(p: Json, inside = false) {
    const include = inside || p.name === "statement";
    if (include && p.id && p.prose) result.push(p);
    for (const child of p.parts || []) visit(child, include);
  }
  for (const p of control.parts || []) visit(p);
  return result;
}
export function integrity(
  doc: Json,
  profile: Release["profiles"][0],
  releaseId: string,
): string[] {
  const b = doc["system-security-plan"];
  if (!b) return ["SSP required"];
  const errors: string[] = [];
  if (
    b["import-profile"]?.href !== `urn:oscal-scribe:${releaseId}:${profile.id}`
  )
    errors.push("Approved profile reference cannot change");
  const rows = flatten(profile.resolved.catalog) as any[],
    requirements =
      b["control-implementation"]?.["implemented-requirements"] || [],
    ids = requirements.map((r: any) => r["control-id"]);
  if (
    new Set(ids).size !== ids.length ||
    rows.length !== ids.length ||
    rows.some((r) => !ids.includes(r.control.id))
  )
    errors.push("Implementation must cover exactly the approved baseline");
  const components = new Set(
      (b["system-implementation"]?.components || []).map((x: any) => x.uuid),
    ),
    roleIds = new Set((b.metadata?.roles || []).map((x: any) => x.id)),
    parties = new Set((b.metadata?.parties || []).map((x: any) => x.uuid));
  function refs(x: any) {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "component-uuid" && !components.has(v))
        errors.push("Unknown component reference");
      if (k === "role-id" && !roleIds.has(v))
        errors.push("Unknown role reference");
      if (k === "role-ids" && (v as any[]).some((id) => !roleIds.has(id)))
        errors.push("Unknown role reference");
      if (k === "party-uuids" && (v as any[]).some((id) => !parties.has(id)))
        errors.push("Unknown party reference");
      if (typeof v === "object") refs(v);
    }
  }
  refs(b);
  for (const req of requirements) {
    const row = rows.find((r) => r.control.id === req["control-id"]);
    if (!row) continue;
    const parts = statementParts(row.control);
    for (const s of req.statements || [])
      if (!parts.some((p) => p.id === s["statement-id"]))
        errors.push("Unknown statement " + s["statement-id"]);
    for (const p of req["set-parameters"] || [])
      if (!row.parameters[p["param-id"]])
        errors.push("Unknown parameter " + p["param-id"]);
  }
  return errors;
}
export function reviewStatus(s: Ssp, now = new Date()): string {
  const a = s.lastAttestation;
  if (!a) return "Never attested";
  if (s.currentRevision !== a.revision) return "Changed since attestation";
  const days = (Date.parse(a.due) - now.getTime()) / 86400000;
  return days < 0 ? "Overdue" : days < 30 ? "Due within 30 days" : "Attested";
}
