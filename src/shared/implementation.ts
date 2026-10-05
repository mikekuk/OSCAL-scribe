import type { Json } from "./types";
import { statementParts, uuid } from "./oscal";

// Standard OSCAL states are independent of component origin and UI colour.
export const NS = "https://oscal-scribe.example/ns";
const emptyDescription = "Implementation not yet documented.";
export type Status = "planned" | "partial" | "implemented" | "alternative" | "not-applicable";
export const statusLabels: Record<Status, string> = {
  "planned": "Planned", partial: "Partial", implemented: "Implemented",
  alternative: "Alternative", "not-applicable": "Not applicable",
};
// Read legacy properties for migration only. New SSP status writes use no props.
function legacyProp(node: Json, name: string): string | undefined {
  return node.props?.find((p: Json) => p.name === name && (!p.ns || p.ns === NS || p.ns === "http://csrc.nist.gov/ns/oscal"))?.value;
}
function declaredState(node?: Json): string | undefined {
  return node?.["implementation-status"]?.state ?? legacyProp(node || {}, "implementation-status");
}
function declared(node?: Json): Status {
  const state = declaredState(node);
  return ["implemented", "partial", "alternative", "not-applicable"].includes(state || "") ? state as Status : "planned";
}
function clearLegacyStatus(node: Json) {
  if (!node.props) return;
  node.props = node.props.filter((p: Json) => !(["implementation-status", "implementation-component", "status-tracking", "completion-decision"].includes(p.name)
    && (!p.ns || p.ns === NS || p.ns === "http://csrc.nist.gov/ns/oscal")));
  if (!node.props.length) delete node.props;
}
export function systemComponent(b: Json): Json {
  const components = b["system-implementation"].components;
  let system = components.find((c: Json) => c.type === "this-system");
  if (!system) {
    system = { uuid: uuid(), type: "this-system", title: "System", description: "The system covered by this plan.", status: { state: "under-development" } };
    components.unshift(system);
  }
  system.title = "System";
  return system;
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
function ensureBy(node: Json, componentId: string): Json {
  node["by-components"] ??= [];
  let by = node["by-components"].find((c: Json) => c["component-uuid"] === componentId);
  if (!by) {
    by = { uuid: uuid(), "component-uuid": componentId, description: emptyDescription };
    node["by-components"].push(by);
  }
  return by;
}
function writeStatus(by: Json, status: Status) {
  by["implementation-status"] = { ...by["implementation-status"], state: status };
}
function migrateStatus(node: Json, systemId: string) {
  const status = legacyProp(node, "implementation-status");
  if (status) {
    const by = ensureBy(node, legacyProp(node, "implementation-component") || systemId);
    if (!by["implementation-status"]) writeStatus(by, declared(node));
  }
  clearLegacyStatus(node);
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
  if (statementId && !section) return "planned";
  const node = statementId ? section : r;
  // Component-definition statements are implementation declarations. Explicit
  // partial/planned publisher properties are read, never copied into SSP props.
  return declaredState(node) ? declared(node) : section ? "implemented" : "partial";
}
export function sectionStatus(statement: Json | undefined, _systemId?: string): Status {
  return rollup((statement?.["by-components"] || []).map(declared));
}
export function importedComponentIds(definitions: Json[]): Set<string> {
  return new Set(definitions.flatMap(d => d["component-definition"]?.components || []).map((c: Json) => c.uuid));
}
export function assignedComponentIds(req: Json): Set<string> {
  return new Set([...(req["by-components"] || []), ...(req.statements || []).flatMap((s: Json) => s["by-components"] || [])].map(c => c["component-uuid"]));
}
export function componentProgress(req: Json, control: Json, componentId: string) {
  const entries = statementParts(control).map(p => req.statements?.find((s: Json) => s["statement-id"] === p.id)?.["by-components"]?.find((c: Json) => c["component-uuid"] === componentId)).filter(Boolean);
  const states = entries.map(declared), complete = states.filter(isComplete).length;
  return { status: rollup(states), complete, total: states.length, allComplete: states.length > 0 && complete === states.length };
}
export function isComplete(status: Status) {
  return ["implemented", "alternative", "not-applicable"].includes(status);
}
// Completion is an application summary, not a new OSCAL state. Every assigned
// implementation must be complete: Windows cannot mask unfinished Linux work.
function rollup(states: Status[]): Status {
  if (states.length && states.every(isComplete)) {
    return states.every(s => s === "not-applicable") ? "not-applicable"
      : states.every(s => s === "alternative") ? "alternative" : "implemented";
  }
  return states.some(s => s !== "planned") ? "partial" : "planned";
}
export function progress(req: Json, control: Json, systemId?: string) {
  const states = statementParts(control).map(p => sectionStatus(req.statements?.find((s: Json) => s["statement-id"] === p.id), systemId));
  const complete = states.filter(isComplete).length;
  return { status: rollup(states), complete, total: states.length, allComplete: states.length > 0 && complete === states.length };
}
/** Each component's control contribution is rolled up from its own statements.
 * The UI combines these to show overall control completion. */
export function syncProgress(b: Json, req: Json, control: Json) {
  const systemId = systemComponent(b).uuid;
  migrateStatus(req, systemId);
  const parts = statementParts(control);
  if (!parts.length) return; // Preserve valid control-level-only implementations.
  const statements: Json[] = parts.map(p => ensureStatement(req, p.id));
  for (const statement of statements) {
    migrateStatus(statement, systemId);
    // System is a fallback only for unassigned sections. Do not silently add it
    // back after a move to Windows/Linux, or create a second obligation on import.
    if (!statement["by-components"]?.length) {
      const own = ensureBy(statement, systemId);
      if (!own["implementation-status"]) writeStatus(own, "planned");
    }
  }
  for (const component of b["system-implementation"].components) {
    const entries = statements.map(s => s["by-components"]?.find((c: Json) => c["component-uuid"] === component.uuid));
    if (!entries.some(Boolean)) {
      const existing = req["by-components"]?.find((c: Json) => c["component-uuid"] === component.uuid);
      if (existing?.description === emptyDescription)
        req["by-components"] = req["by-components"].filter((c: Json) => c !== existing);
      else if (existing) delete existing["implementation-status"];
      continue;
    }
    const by = ensureBy(req, component.uuid);
    if (by.description === emptyDescription && component.uuid !== systemId)
      by.description = "Control implementation for " + component.title + ".";
    writeStatus(by, rollup(entries.filter(Boolean).map(declared)));
  }
}
export function setSectionStatus(b: Json, req: Json, control: Json, id: string, choice: string, definitions: Json[], componentId = systemComponent(b).uuid) {
  if (!statementParts(control).some(p => p.id === id)) throw Error("Unknown statement");
  if (!["planned", "partial", "implemented", "alternative", "not-applicable"].includes(choice)) throw Error("Unknown implementation status");
  if (!b["system-implementation"].components.some((c: Json) => c.uuid === componentId)) throw Error("Unknown component");
  const statement = ensureStatement(req, id);
  const by = statement["by-components"]?.find((c: Json) => c["component-uuid"] === componentId);
  if (!by) throw Error("Assign this section to the component before editing its status");
  writeStatus(by, choice as Status);
  clearLegacyStatus(statement);
  syncProgress(b, req, control);
}
/** Import runs on selection, not on view/save. Otherwise saving would restore
 * moved assignments or overwrite an SSP author's adaptations of published text.
 * Only exact statement IDs receive a source component's implementation. */
export function applyComponentStatements(b: Json, req: Json, control: Json, definitions: Json[], importPublished = true) {
  const systemId = systemComponent(b).uuid;
  migrateStatus(req, systemId);
  const contributions = contributionList(b, definitions, control.id);
  let importedAny = false;
  for (const part of statementParts(control)) {
    const statement = ensureStatement(req, part.id);
    migrateStatus(statement, systemId);
    let importedImplementation = false;
    for (const c of importPublished ? contributions : []) {
      const source = c.requirement.statements?.find((s: Json) => s["statement-id"] === part.id);
      if (!source) continue;
      if (statement["by-components"]?.some((x: Json) => x["component-uuid"] === c.component.uuid)) continue;
      const by = ensureBy(statement, c.component.uuid);
      const definition = definitions.find(d => d["component-definition"]?.components?.some((x: Json) => x.uuid === c.component.uuid));
      if (definition) {
        const sourceHref = "urn:uuid:" + definition["component-definition"].uuid + "#" + (source.uuid || c.component.uuid);
        by.links = [{ rel: "imported-from", href: sourceHref }];
      }
      by.description = source.description || c.requirement.description || "Published component implementation.";
      const state = contributionStatus(c, part.id);
      writeStatus(by, state);
      importedImplementation = true;
    }
    if (importedImplementation) {
      importedAny = true;
      // Selection assigns published sections to their source, including partial
      // and planned contributions. System must not retain a duplicate obligation.
      statement["by-components"] = statement["by-components"].filter((c: Json) =>
        c["component-uuid"] !== systemId);
    }
  }
  if (importedAny && !req.statements.some((s: Json) => s["by-components"]?.some((c: Json) => c["component-uuid"] === systemId)))
    removeBy(req, systemId);
  syncProgress(b, req, control);
}
/** Viewing never changes the saved SSP. Save/select/edit persists the same result. */
export function effectiveRequirement(b: Json, req: Json, control: Json, definitions: Json[]): Json {
  const copy = structuredClone(req), context = { ...b, "system-implementation": structuredClone(b["system-implementation"]) };
  applyComponentStatements(context, copy, control, definitions, false);
  return copy;
}
export function setDescription(node: Json, componentId: string, text: string) {
  const by = ensureBy(node, componentId);
  // OSCAL requires description; clearing narrative must not erase status.
  by.description = text.trim() ? text : emptyDescription;
}
export function setComponentRemarks(node: Json, componentId: string, text: string) {
  const by = ensureBy(node, componentId);
  if (text.trim()) by.remarks = text;
  else delete by.remarks;
}
export function removeComponent(b: Json, id: string, rows: any[], definitions: Json[] = []) {
  if (id === systemComponent(b).uuid) throw Error("The SSP System component cannot be removed");
  b["system-implementation"].components = b["system-implementation"].components.filter((c: Json) => c.uuid !== id);
  for (const row of rows) {
    const req = requirement(b, row.control.id);
    for (const node of [req, ...(req.statements || [])]) {
      if (legacyProp(node, "implementation-component") === id) clearLegacyStatus(node);
      if (node["by-components"]) {
        node["by-components"] = node["by-components"].filter((c: Json) => c["component-uuid"] !== id);
        if (!node["by-components"].length) delete node["by-components"];
      }
    }
    applyComponentStatements(b, req, row.control, definitions, false);
  }
}

/** Omit empty optional arrays to keep the serialized SSP schema-valid. */
function removeBy(node: Json, componentId: string) {
  if (!node["by-components"]) return;
  node["by-components"] = node["by-components"].filter((c: Json) => c["component-uuid"] !== componentId);
  if (!node["by-components"].length) delete node["by-components"];
}
/** Removing a redundant local control must leave every assigned section covered
 * by an assignment elsewhere, even if still planned. Validate first; never partially delete. */
export function deleteControlAssignment(b: Json, req: Json, control: Json, componentId: string, definitions: Json[]) {
  if (importedComponentIds(definitions).has(componentId)) throw Error("Imported originals cannot be deleted individually");
  if (!assignedComponentIds(req).has(componentId)) throw Error("Control is not assigned to this component");
  const assigned = (req.statements || []).filter((s: Json) => s["by-components"]?.some((c: Json) => c["component-uuid"] === componentId));
  for (const node of assigned.length ? assigned : [req]) {
    if (!node["by-components"]?.some((c: Json) => c["component-uuid"] !== componentId))
      throw Error("Keep this assignment: " + (node["statement-id"] || control.id) + " is not assigned to another component. Move it instead.");
  }
  for (const node of [req, ...(req.statements || [])]) removeBy(node, componentId);
  syncProgress(b, req, control);
}
/** Local component deletion preserves unique implementation work by moving it
 * back to System. Existing implementations in other components are not overwritten. */
export function deleteLocalComponent(b: Json, id: string, rows: any[], definitions: Json[]) {
  const systemId = systemComponent(b).uuid;
  if (id === systemId || importedComponentIds(definitions).has(id)) throw Error("Only additional local components can be deleted");
  if (!b["system-implementation"].components.some((c: Json) => c.uuid === id)) throw Error("Unknown component");
  for (const row of rows) {
    const req = requirement(b, row.control.id);
    let returned = false;
    for (const statement of req.statements || []) {
      const entries: Json[] = statement["by-components"] || [];
      const source = entries.find(c => c["component-uuid"] === id);
      if (!source) continue;
      if (entries.length === 1) { source["component-uuid"] = systemId; returned = true; }
      else removeBy(statement, id);
    }
    const source = req["by-components"]?.find((c: Json) => c["component-uuid"] === id);
    const own = req["by-components"]?.find((c: Json) => c["component-uuid"] === systemId);
    if (source && (returned || !req.statements?.length) && !own) source["component-uuid"] = systemId;
    else removeBy(req, id);
  }
  removeComponent(b, id, rows, definitions);
}

export function addLocalComponent(b: Json, title: string, type: string, description: string) {
  const name = title.trim();
  if (!name || name.length > 120) throw Error("Enter a component name of 1–120 characters");
  if (b["system-implementation"].components.some((c: Json) => c.title.toLowerCase() === name.toLowerCase())) throw Error("That component name already exists");
  if (!["software", "hardware", "service", "policy", "process", "procedure"].includes(type)) throw Error("Choose a component type");
  const component = { uuid: uuid(), title: name, type, description: description.trim() || "System-local component: " + name + ".", status: { state: "under-development" } };
  b["system-implementation"].components.push(component);
  return component;
}
/** Copy/move only component implementations, never duplicate baseline controls.
 * Validate the entire batch before changing anything; existing target work wins. */
export function transferControls(b: Json, rows: any[], ids: string[], sourceId: string, targetId: string, mode: "copy" | "move", definitions: Json[]) {
  const components: Json[] = b["system-implementation"].components;
  if (!components.some(c => c.uuid === sourceId) || !components.some(c => c.uuid === targetId)) throw Error("Choose source and destination components");
  if (sourceId === targetId) throw Error("Choose a different destination component");
  if (!ids.length) throw Error("Select at least one control");
  const imported = importedComponentIds(definitions);
  if (imported.has(targetId)) throw Error("Choose a local destination component");
  if (mode === "move" && imported.has(sourceId)) throw Error("Imported originals must stay assigned to their source; use Copy");
  const selected = [...new Set(ids)].map(id => {
    const row = rows.find(r => r.control.id === id), req = requirement(b, id);
    if (!row || !req || !assignedComponentIds(req).has(sourceId)) throw Error("Source component has no implementation for " + id);
    if (assignedComponentIds(req).has(targetId)) throw Error("Destination already has " + id + "; existing work has been kept");
    return { row, req };
  });
  // Allocate IDs across the complete copy batch, so links between a control's
  // requirement and statement implementations continue to point within the copy.
  // Moves retain IDs: references elsewhere in the SSP must keep resolving.
  const operations = selected.flatMap(({ req }) => [req, ...(req.statements || [])].flatMap(node => {
    const source = node["by-components"]?.find((c: Json) => c["component-uuid"] === sourceId);
    return source ? [{ node, source, copy: structuredClone(source) }] : [];
  }));
  const replacements = new Map<string, string>();
  function identify(value: any) {
    if (!value || typeof value !== "object") return;
    if (value.uuid) replacements.set(value.uuid, uuid());
    for (const child of Object.values(value)) identify(child);
  }
  function remap(value: any) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && replacements.has(child)) value[key] = replacements.get(child);
      else remap(child);
    }
  }
  if (mode === "copy") for (const operation of operations) identify(operation.copy);
  for (const { node, source, copy } of operations) {
    if (mode === "copy") remap(copy);
    copy["component-uuid"] = targetId;
    // Local adaptations keep lineage without claiming to be the imported original.
    for (const link of copy.links || []) if (link.rel === "imported-from") link.rel = "derived-from";
    node["by-components"].push(copy);
    if (mode === "move") node["by-components"] = node["by-components"].filter((c: Json) => c !== source);
  }
  for (const { row, req } of selected) syncProgress(b, req, row.control);
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
