import { escapeHtml as h, renderControls } from "../shared/lens/views.mjs";
import { substituteParameters } from "../shared/lens/parameters.mjs";
import { statementParts } from "../shared/oscal";
import { effectiveRequirement, progress, requirement, statusLabels, importedComponentIds, assignedComponentIds, componentProgress } from "../shared/implementation";
import type { Json } from "../shared/types";

/** Filtering controls the cards themselves, not browser-dependent hidden options. */
export function filterControls(rows: any[], group: string, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (group && !row.groups.some((g: Json) => (g.id || g.title) === group)) return false;
    const text = substituteParameters([row.control.id, row.control.title, ...statementParts(row.control).map(p => p.prose)].join(" "), row.parameters)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]*>/g, " ").toLowerCase();
    const normalizeId = (id: string) => id.toLowerCase().replace(/-0+(?=\d)/, "-").replace(/\((\d+)\)/g, ".$1");
    return terms.every(term => /^[a-z]{2,3}-\d+(?:\.\d+|\(\d+\))?$/.test(term)
      ? normalizeId(row.control.id) === normalizeId(term) : text.includes(term));
  });
}
/** Controls remain single baseline requirements. Each panel edits only the
 * by-components entry identified by both its control and component UUID. */
export function renderControlCards(b: Json, rows: any[], definitions: Json[], editable: boolean, opened: Set<string>, selected = new Set<string>(), componentFilter = "") {
  const disabled = editable ? "" : "disabled";
  const imported = importedComponentIds(definitions);
  const badge = (state: keyof typeof statusLabels) => `<span class="status-badge status-${state}">${h(statusLabels[state])}</span>`;
  const origin = `<span class="status-badge origin-imported">Imported</span>`;
  const text = (label: string, value: string, attrs: string) => `<label class="field">${h(label)}<textarea ${attrs} ${disabled}>${h(value || "")}</textarea></label>`;
  return rows.map(row => {
    const control = row.control, id = control.id, req = effectiveRequirement(b, requirement(b, id), control, definitions);
    const p = progress(req, control), assigned = assignedComponentIds(req);
    const attrs = `data-control="${h(id)}"`, roles = b.metadata.roles || [];
    const components: Json[] = b["system-implementation"].components.filter((c: Json) => assigned.has(c.uuid) && (!componentFilter || componentFilter === c.uuid));
    const importedOnly = components.length > 0 && components.every(c => imported.has(c.uuid));
    const implementations = components.map(component => {
      const importedSource = imported.has(component.uuid), key = id + ":component:" + component.uuid;
      const cp = componentProgress(req, control, component.uuid);
      const componentAttrs = `${attrs} data-implementation-component="${h(component.uuid)}"`;
      const overall = req["by-components"]?.find((c: Json) => c["component-uuid"] === component.uuid);
      const sections = statementParts(control).flatMap(part => {
        const statement = req.statements?.find((s: Json) => s["statement-id"] === part.id);
        const by = statement?.["by-components"]?.find((c: Json) => c["component-uuid"] === component.uuid);
        if (!by) return [];
        const state = by["implementation-status"]?.state || "planned", sectionKey = key + ":" + part.id;
        return [`<details class="statement-card status-${h(state)} ${importedSource ? "origin-imported" : ""}" data-expand-key="${h(sectionKey)}" ${opened.has(sectionKey) ? "open" : ""}>
          <summary><strong>${h(part.title || part.props?.find((x: Json) => x.name === "label")?.value || part.id)}</strong>${badge(state)}${importedSource ? origin : ""}</summary>
          <div class="statement-body"><div class="statement-text">${substituteParameters(part.prose, row.parameters)}</div>
          <label class="field">Section status<select data-section-status="${h(part.id)}" ${componentAttrs} ${disabled}>${Object.entries(statusLabels).map(([value, label]) => `<option value="${h(value)}" ${state === value ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label>
          ${text(`How ${component.title} meets this section`, by.description, `data-statement="${h(part.id)}" data-bycomponent="${h(component.uuid)}" ${attrs}`)}
          ${text("Justification / remarks", by.remarks, `data-component-remarks="${h(component.uuid)}" data-statement="${h(part.id)}" ${attrs}`)}
          </div></details>`];
      }).join("");
      return `<details class="component-implementation status-${cp.status} ${importedSource ? "origin-imported" : ""}" data-expand-key="${h(key)}" ${opened.has(key) ? "open" : ""}>
        <summary><strong>${h(component.title)}</strong>${badge(cp.status)}${importedSource ? origin : ""}<small>${cp.complete}/${cp.total} assigned sections complete</small></summary>
        <div class="component-implementation-body">${!importedSource ? `<button class="quiet" data-delete-assignment="${h(component.uuid)}" ${attrs} ${disabled}>Delete control from this component</button><p class="legend">Available when every section is also assigned to another component, including planned work.</p>` : ""}${importedSource ? '<p class="section-source">Imported from a published component definition. Edits describe this system’s implementation; the published definition is unchanged.</p>' : ""}
        ${text(`Overall implementation for ${component.title}`, overall?.description, `data-bycomponent="${h(component.uuid)}" ${attrs}`)}
        ${sections || '<p>No statement sections are assigned to this component.</p>'}</div></details>`;
    }).join("");
    return `<details class="control-card status-${p.status} ${importedOnly ? "origin-imported" : ""}" data-control-card="${h(id)}" data-expand-key="${h(id)}" ${opened.has(id) ? "open" : ""}>
      <summary><input type="checkbox" data-select-control="${h(id)}" aria-label="Select ${h(id.toUpperCase())}" ${selected.has(id) ? "checked" : ""} ${disabled}><span class="control-id">${h(id.toUpperCase())}</span><span class="control-heading"><strong>${h(control.title)}</strong><small>${h(row.groups.map((g: Json) => g.title).join(" / "))}</small></span>${badge(p.status)}${importedOnly ? origin : ""}<span class="completion-count">${p.complete}/${p.total} sections complete</span></summary>
      <div class="control-body"><details class="requirement" data-expand-key="${h(id + ':requirement')}" ${opened.has(id + ':requirement') ? "open" : ""}><summary>Control requirements and profile context</summary><p class="legend">Profile additions are highlighted. Assigned ODPs are shown in the requirement text.</p>${renderControls("catalog", { rows: [row], sources: [], notes: [] }, null, 0, "", "", { parameters: false })}</details>
      <p class="completion-summary">Every assigned component must complete its sections for this control to be complete.</p>
      <label class="field">Responsible system role<select data-req-role ${attrs} ${disabled}><option value="">Unassigned</option>${roles.map((r: Json) => `<option value="${h(r.id)}" ${req["responsible-roles"]?.[0]?.["role-id"] === r.id ? "selected" : ""}>${h(r.title)}</option>`).join("")}</select></label>
      ${text("Control remarks", req.remarks, `data-control-remarks ${attrs}`)}
      <h3>Component implementations</h3>${implementations || '<p>No implementation is assigned to this component.</p>'}</div></details>`;
  }).join("");
}
