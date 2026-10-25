import { impactScaleHelp } from "./information-types-view";
import { escapeHtml as h } from "../shared/lens/views.mjs";
import { impactAxes, impactDescriptions, impactLevels, type InformationType, type InformationTypeCatalog } from "../shared/information-types";

export function informationTypesAdminView(catalog: InformationTypeCatalog, editing?: InformationType): string {
  return `<h2>Information types</h2><p>Create and edit the choices available in System Characteristics. Changes apply to future selections; saved plans retain their existing definitions.</p>${impactScaleHelp()}
    <form id="information-type-form" class="information-admin-form"><h3>${editing ? "Edit information type" : "Create information type"}</h3>
    <label class="field">Name<input id="information-name" required maxlength="120" value="${h(editing?.name || "")}"></label>
    <label class="field">Description<textarea id="information-description" required maxlength="2000">${h(editing?.description || "")}</textarea></label>
    <div class="form-grid">${impactAxes.map(axis => `<label class="field">${axis[0].toUpperCase() + axis.slice(1)} (${axis[0].toUpperCase()})<select aria-label="${axis[0].toUpperCase() + axis.slice(1)} (${axis[0].toUpperCase()})" id="information-${axis}">${impactLevels.map(level => `<option title="${h(impactDescriptions[level])}" value="${level}" ${(editing?.[axis] || "low") === level ? "selected" : ""}>${level}</option>`).join("")}</select></label>`).join("")}</div>
    <label class="information-option"><input id="information-active" type="checkbox" ${editing?.active !== false ? "checked" : ""}>Available for new selections</label><p>Disable this to retire a type while preserving selections in existing plans.</p>
    <button type="submit">${editing ? "Save information type" : "Create information type"}</button> ${editing ? '<button id="information-cancel" type="button" class="quiet">Cancel edit</button>' : ""}
    <button id="information-reload" type="button" class="quiet">Reload catalogue</button></form>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name / description</th><th>C / I / A</th><th>Availability</th><th>Actions</th></tr></thead><tbody>${catalog.entries.map(entry => `<tr><td><strong>${h(entry.name)}</strong><small>${h(entry.description)}</small></td><td>${impactAxes.map(axis => h(entry[axis])).join(" / ")}</td><td>${entry.active ? "Available" : "Retired"}</td><td><button class="quiet" data-edit-information-type="${h(entry.id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>`;
}
