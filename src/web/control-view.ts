import { escapeHtml as h, renderControls } from "../shared/lens/views.mjs";
import { substituteParameters } from "../shared/lens/parameters.mjs";
import { statementParts } from "../shared/oscal";
import { contributionList, contributionStatus, effectiveRequirement, progress, prop, requirement, sectionStatus, statusLabels } from "../shared/implementation";
import type { Json } from "../shared/types";

/** Filtering controls the cards themselves, not browser-dependent hidden options. */
export function filterControls(rows: any[], group: string, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (group && !row.groups.some((g: Json) => (g.id || g.title) === group)) return false;
    const text = substituteParameters(JSON.stringify(row.control), row.parameters).toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
export function renderControlCards(b: Json, rows: any[], definitions: Json[], editable: boolean, opened: Set<string>) {
  const disabled = editable ? "" : "disabled";
  const systemId = b["system-implementation"].components[0].uuid;
  const badge = (state: keyof typeof statusLabels) => `<span class="status-badge status-${state}">${h(statusLabels[state])}</span>`;
  const text = (label: string, value: string, attrs: string) => `<label class="field">${h(label)}<textarea ${attrs} ${disabled}>${h(value || "")}</textarea></label>`;
  return rows.map(row => {
    const control = row.control, id = control.id, req = effectiveRequirement(b, requirement(b, id), control, definitions);
    const p = progress(req, control), contributions = contributionList(b, definitions, id);
    const attrs = `data-control="${h(id)}"`;
    const roles = b.metadata.roles || [];
    const componentText = contributions.map(c => `<div class="published-contribution"><strong>${h(c.component.title)}</strong> ${badge(contributionStatus(c) === "implemented" ? "component" : contributionStatus(c))}<p>${h(c.requirement.description)}</p></div>`).join("");
    const sections = statementParts(control).map(part => {
      const s = req.statements?.find((x: Json) => x["statement-id"] === part.id);
      const state = sectionStatus(s), component = prop(s || {}, "implementation-component");
      const value = component ? "component:" + component : state;
      const key = id + ":" + part.id;
      const choices = [["not-set", "Not set"], ["implemented", "Implemented"], ["partial", "Partial"], ["alternative", "Alternative"], ["not-applicable", "N/A"], ...contributions.map(c => ["component:" + c.component.uuid, `${c.component.title} — ${statusLabels[contributionStatus(c, part.id)]}`])];
      return `<details class="statement-card status-${state}" data-expand-key="${h(key)}" ${opened.has(key) ? "open" : ""}>
        <summary><strong>${h(part.title || part.props?.find((x: Json) => x.name === "label")?.value || part.id)}</strong>${badge(state)}</summary>
        <div class="statement-body"><div class="statement-text">${substituteParameters(part.prose, row.parameters)}</div>
        <label class="field">Section status<select data-section-status="${h(part.id)}" ${attrs} ${disabled}>${choices.map(([v, label]) => `<option value="${h(v)}" ${value === v ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label>
        ${component ? `<p class="section-source">Contribution from ${h(contributions.find(c => c.component.uuid === component)?.component.title || "selected component")}. Complete the remaining system work, then select Implemented.</p>` : ""}
        ${text("How this system meets this section", s?.["by-components"]?.find((c: Json) => c["component-uuid"] === systemId)?.description, `data-statement="${h(part.id)}" ${attrs}`)}
        ${text("Justification / remarks (explain Alternative or N/A)", s?.remarks, `data-statement-remarks="${h(part.id)}" ${attrs}`)}</div></details>`;
    }).join("");
    const decision = prop(req, "completion-decision") || "auto";
    return `<details class="control-card status-${p.status}" data-control-card="${h(id)}" data-expand-key="${h(id)}" ${opened.has(id) ? "open" : ""}>
      <summary><span class="control-id">${h(id.toUpperCase())}</span><span class="control-heading"><strong>${h(control.title)}</strong><small>${h(row.groups.map((g: Json) => g.title).join(" / "))}</small></span>${badge(p.status)}<span class="completion-count">${p.complete}/${p.total} sections complete</span></summary>
      <div class="control-body"><details class="requirement" data-expand-key="${h(id + ':requirement')}" ${opened.has(id + ':requirement') ? "open" : ""}><summary>Control requirements and profile context</summary><p class="legend">Profile additions are highlighted. Assigned ODPs are shown in the requirement text.</p>${renderControls("catalog", { rows: [row], sources: [], notes: [] }, null, 0, "", "", { parameters: false })}</details>
      <div class="form-grid"><label class="field">Control completion<select data-completion ${attrs} ${disabled}><option value="auto" ${decision === "auto" ? "selected" : ""}>Automatic from sections</option><option value="partial" ${decision === "partial" ? "selected" : ""}>Partial — further work remains</option><option value="implemented" ${decision === "implemented" ? "selected" : ""} ${p.allComplete ? "" : "disabled"}>Implemented — completion confirmed</option></select><small>Complete every section to confirm completion, including the remaining work for partial components.</small></label>
      <label class="field">Responsible system role<select data-req-role ${attrs} ${disabled}><option value="">Unassigned</option>${roles.map((r: Json) => `<option value="${h(r.id)}" ${req["responsible-roles"]?.[0]?.["role-id"] === r.id ? "selected" : ""}>${h(r.title)}</option>`).join("")}</select></label></div>
      ${!prop(req, "status-tracking") && p.status !== "not-set" ? '<p class="legacy-status">Saved whole-control status. Section tracking starts when you select a section status.</p>' : ""}
      ${text("Overall system implementation", req["by-components"]?.find((c: Json) => c["component-uuid"] === systemId)?.description, `data-system-description ${attrs}`)}
      ${text("Control remarks", req.remarks, `data-control-remarks ${attrs}`)}
      ${componentText ? `<details class="component-contributions" data-expand-key="${h(id + ':components')}" ${opened.has(id + ':components') ? "open" : ""}><summary>Published component contributions</summary>${componentText}</details>` : ""}
      ${b["system-implementation"].components.slice(1).map((c: Json) => text(`How this system uses ${c.title} for this control`, req["by-components"]?.find((x: Json) => x["component-uuid"] === c.uuid)?.description, `data-bycomponent="${h(c.uuid)}" ${attrs}`)).join("")}
      <h3>Sections</h3>${sections || "<p>This control has no statement sections.</p>"}</div></details>`;
  }).join("");
}
