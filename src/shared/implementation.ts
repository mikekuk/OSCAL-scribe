import type { Json } from "./types";
import { statementParts, uuid } from "./oscal";

// Status is an OSCAL property on requirements/statements. Component origin is
// separate: "blue" is a presentation of implemented + a component reference,
// not a new OSCAL implementation state.
export const NS = "https://oscal-scribe.example/ns";
export type Status = "not-set" | "partial" | "implemented" | "alternative" | "not-applicable" | "component";
export const statusLabels: Record<Status, string> = {
  "not-set": "Not set", partial: "Partial", implemented: "Implemented",
  alternative: "Alternative", "not-applicable": "N/A", component: "Implemented by component",
};
export function prop(node: Json, name: string): string | undefined {
  return node.props?.find((p: Json) => p.name === name && p.ns === NS)?.value;
}
export function setProp(node: Json, name: string, value?: string) {
  node.props = (node.props || []).filter((p: Json) => !(p.name === name && p.ns === NS));
  if (value) node.props.push({ name, ns: NS, value });
  if (!node.props.length) delete node.props;
}
function declared(node?: Json): Status {
  const state = node?.["implementation-status"]?.state ?? node?.props?.find(
    (p: Json) => p.name === "implementation-status" && (!p.ns || p.ns === NS || p.ns === "http://csrc.nist.gov/ns/oscal"),
  )?.value;
  return ["implemented", "partial", "alternative", "not-applicable"].includes(state) ? state : "not-set";
}
export function requirement(b: Json, controlId: string): Json {
  return b["control-implementation"]["implemented-requirements"].find((r: Json) => r["control-id"] === controlId);
}
export function ensureStatement(req: Json, statementId: string): Json {
  req.statements ??= [];
  let statement = req.statements.find((s: Json) => s["statement-id"] === statementId);
  if (!statement) {
    statement = { uuid: uuid(), "statement-id": statementId };
    req.statements.push(statement);
  }
  return statement;
}
export function contributionList(b: Json, definitions: Json[], controlId: string) {
  const selected = new Set(b["system-implementation"].components.map((c: Json) => c.uuid));
  return definitions.flatMap(d => d["component-definition"]?.components || [])
    .filter((c: Json) => selected.has(c.uuid))
    .flatMap((c: Json) => (c["control-implementations"] || []).flatMap((ci: Json) =>
      (ci["implemented-requirements"] || []).filter((r: Json) => r["control-id"] === controlId)
        .map((r: Json) => ({ component: c, requirement: r }))));
}
export function contributionStatus(contribution: { requirement: Json }, statementId?: string): Status {
  const r = contribution.requirement;
  const section = r.statements?.find((s: Json) => s["statement-id"] === statementId);
  // A control-wide partial contribution does not prove any individual section
  // complete. Publishers may provide explicit per-statement status; otherwise
  // conservatively show partial, including older narrative-only components.
  const status = declared(section || r);
  return status === "not-set" ? "partial" : status;
}
export function sectionStatus(statement?: Json): Status {
  const status = declared(statement);
  return status === "implemented" && prop(statement || {}, "implementation-component") ? "component" : status;
}
export function isComplete(status: Status) {
  return ["implemented", "component", "alternative", "not-applicable"].includes(status);
}
export function progress(req: Json, control: Json) {
  const parts = statementParts(control);
  const states = parts.map(p => sectionStatus(req.statements?.find((s: Json) => s["statement-id"] === p.id)));
  const complete = states.filter(isComplete).length;
  const allComplete = states.length > 0 && complete === states.length;
  let status: Status = "not-set";
  if (allComplete) {
    status = states.every(s => s === "component") ? "component"
      : states.every(s => s === "not-applicable") ? "not-applicable"
      : states.every(s => s === "alternative") ? "alternative" : "implemented";
  } else if (states.some(s => s !== "not-set")) status = "partial";
  // Legacy whole-control decisions remain visible until the user starts section
  // tracking. Reading an existing SSP must never silently rewrite its decisions.
  if (!prop(req, "status-tracking")) status = declared(req);
  if (prop(req, "completion-decision") === "partial") status = "partial";
  if (prop(req, "completion-decision") === "implemented" && allComplete) status = "implemented";
  return { status, complete, total: parts.length, allComplete };
}
export function syncProgress(req: Json, control: Json) {
  setProp(req, "status-tracking", "sections");
  const result = progress(req, control);
  // Reopening a section revokes an earlier completion override.
  if (!result.allComplete && prop(req, "completion-decision") === "implemented")
    setProp(req, "completion-decision");
  setProp(req, "implementation-status", result.status === "component" ? "implemented" : result.status === "not-set" ? "planned" : result.status);
}
export function setSectionStatus(b: Json, req: Json, control: Json, id: string, choice: string, definitions: Json[]) {
  if (!statementParts(control).some(p => p.id === id)) throw Error("Unknown statement");
  const statement = ensureStatement(req, id);
  let status: Status = choice as Status;
  let componentId: string | undefined;
  if (choice.startsWith("component:")) {
    componentId = choice.slice("component:".length);
    const contribution = contributionList(b, definitions, control.id).find(c => c.component.uuid === componentId);
    if (!contribution) throw Error("Select a component contributing to this control first");
    status = contributionStatus(contribution, id);
    // Preserve published text as a component contribution, separate from the
    // consuming system's editable implementation narrative.
    const specific = contribution.requirement.statements?.find((s: Json) => s["statement-id"] === id);
    setDescription(statement, componentId, specific?.description || contribution.requirement.description);
    const by = statement["by-components"].find((c: Json) => c["component-uuid"] === componentId);
    by["implementation-status"] = { state: status === "not-set" ? "planned" : status };
  } else if (!["not-set", "partial", "implemented", "alternative", "not-applicable"].includes(choice)) {
    throw Error("Unknown implementation status");
  }
  setProp(statement, "implementation-status", status === "not-set" ? "planned" : status);
  setProp(statement, "implementation-component", componentId);
  syncProgress(req, control);
}
/** Preview contributions for SSPs created before section tracking existed.
 * Work on a copy while viewing; only an explicit edit/save persists the result. */
export function effectiveRequirement(b: Json, req: Json, control: Json, definitions: Json[]): Json {
  const copy = structuredClone(req);
  const contributions = contributionList(b, definitions, control.id);
  if (!contributions.length) return copy;
  for (const part of statementParts(control)) {
    const existing = copy.statements?.find((s: Json) => s["statement-id"] === part.id);
    if (prop(existing || {}, "implementation-status")) continue;
    const contribution = contributions.find(c => contributionStatus(c, part.id) === "implemented") || contributions[0];
    setSectionStatus(b, copy, control, part.id, "component:" + contribution.component.uuid, definitions);
  }
  return copy;
}
export function setDescription(node: Json, componentId: string, text: string) {
  node["by-components"] ??= [];
  let by = node["by-components"].find((c: Json) => c["component-uuid"] === componentId);
  if (!by && text.trim()) {
    by = { uuid: uuid(), "component-uuid": componentId, description: text };
    node["by-components"].push(by);
  } else if (by) {
    // A status-only contribution still needs a description in OSCAL. Clearing
    // ordinary narrative removes only that component entry, not the statement.
    if (text.trim()) by.description = text;
    else node["by-components"] = node["by-components"].filter((c: Json) => c !== by);
  }
  if (!node["by-components"].length) delete node["by-components"];
}
export function removeComponent(b: Json, id: string, rows: any[]) {
  b["system-implementation"].components = b["system-implementation"].components.filter((c: Json) => c.uuid !== id);
  for (const row of rows) {
    const req = requirement(b, row.control.id);
    for (const node of [req, ...(req.statements || [])]) {
      if (node["by-components"]) {
        node["by-components"] = node["by-components"].filter((c: Json) => c["component-uuid"] !== id);
        if (!node["by-components"].length) delete node["by-components"];
      }
      if (prop(node, "implementation-component") === id) {
        setProp(node, "implementation-component");
        setProp(node, "implementation-status", "planned");
      }
    }
    if (prop(req, "status-tracking")) syncProgress(req, row.control);
  }
}

/** Remove references throughout the current SSP, never from historical revisions.
 * Parties are retained because the same person can serve several roles or be
 * referenced elsewhere. Empty optional arrays are omitted for OSCAL validity. */
export function removeRole(b: Json, id: string) {
  b.metadata.roles = (b.metadata.roles || []).filter((r: Json) => r.id !== id);
  if (!b.metadata.roles.length) delete b.metadata.roles;
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    for (const key of ["responsible-parties", "responsible-roles", "role-ids"]) {
      if (!Array.isArray(node[key])) continue;
      node[key] = node[key].filter((r: any) => (typeof r === "string" ? r : r["role-id"]) !== id);
      if (!node[key].length) delete node[key];
    }
    for (const value of Object.values(node)) if (typeof value === "object") visit(value);
  }
  visit(b);
}
export function addRole(b: Json, title: string) {
  const name = title.trim();
  if (!name || name.length > 120) throw Error("Enter a role name of 1–120 characters");
  b.metadata.roles ??= [];
  if (b.metadata.roles.some((r: Json) => r.title.toLowerCase() === name.toLowerCase())) throw Error("That role already exists");
  // IDs remain stable when a displayed name changes; free text never becomes an
  // object path or HTML identifier.
  const role = { id: "role-" + uuid(), title: name };
  b.metadata.roles.push(role);
  return role;
}
