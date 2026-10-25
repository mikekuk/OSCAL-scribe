import { escapeHtml as h } from "../shared/lens/views.mjs";
import { applyInformationSelection, belowMaximumWarnings, catalogId, impactAxes, impactDescriptions, impactLevel, impactLevels, isObjectiveOverride, maximumImpacts, selectedInformationTypes, setObjectiveMode, toOscalInformationType, type InformationTypeCatalog } from "../shared/information-types";
import type { Json } from "../shared/types";

const axisLabels = { confidentiality: "Confidentiality (C)", integrity: "Integrity (I)", availability: "Availability (A)" };
const radiusStep = 126 / impactLevels.length;
const colours = ["#226b55", "#4169b1", "#a34280", "#ab6414", "#007b89", "#8053b2"];
const summary = (type: Json) => impactAxes.map(axis => `${axis[0].toUpperCase()}: ${impactLevel(type, axis) || "unspecified"}`).join(" · ");
const tooltip = (type: Json) => `${type.title}\n${type.description}\n${summary(type)}`;
function point(axis: number, level: number): string {
  const angle = -Math.PI / 2 + axis * Math.PI * 2 / 3, radius = level * radiusStep;
  return `${(180 + Math.cos(angle) * radius).toFixed(1)},${(170 + Math.sin(angle) * radius).toFixed(1)}`;
}
export function informationRadar(types: Json[]): string {
  const plotted = types.filter(type => impactAxes.every(axis => impactLevel(type, axis)));
  return `<figure class="information-radar"><svg viewBox="0 0 360 310" role="img" aria-labelledby="cia-chart-title cia-chart-description">
    <title id="cia-chart-title">Information type CIA levels</title><desc id="cia-chart-description">Three axes: Confidentiality, Integrity and Availability. Five rings from centre to edge: Negligible, Low, Moderate, High and Critical. Each selected information type has a plot; the legend lists its exact levels.</desc>
    ${impactLevels.map((_, index) => index + 1).map(level => `<polygon points="${impactAxes.map((_, i) => point(i, level)).join(" ")}" class="radar-grid"/><text x="185" y="${170 - level * radiusStep + 14}" class="radar-scale">${impactLevels[level - 1]}</text>`).join("")}
    ${impactAxes.map((_, i) => `<line x1="180" y1="170" x2="${point(i, impactLevels.length).split(",")[0]}" y2="${point(i, impactLevels.length).split(",")[1]}" class="radar-grid"/>`).join("")}
    <text x="180" y="23" text-anchor="middle">C</text><text x="306" y="255" text-anchor="middle">I</text><text x="54" y="255" text-anchor="middle">A</text>
    ${plotted.map(type => {
      const index = types.indexOf(type), color = colours[index % colours.length];
      return `<g tabindex="0" aria-label="${h(tooltip(type))}" class="radar-plot"><title>${h(tooltip(type))}</title><polygon points="${impactAxes.map((axis, i) => point(i, impactLevels.indexOf(impactLevel(type, axis)!) + 1)).join(" ")}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="2.5" ${index % 2 ? 'stroke-dasharray="6 4"' : ""}/>${impactAxes.map((axis, i) => { const [x, y] = point(i, impactLevels.indexOf(impactLevel(type, axis)!) + 1).split(","); return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`; }).join("")}</g>`;
    }).join("")}</svg><figcaption>C = Confidentiality · I = Integrity · A = Availability<br>Negligible → Low → Moderate → High → Critical from centre to edge. Identical levels overlap.</figcaption>
    <ul class="radar-legend">${types.map((type, i) => `<li tabindex="0" title="${h(tooltip(type))}"><span class="radar-key radar-colour-${i % colours.length}"></span><span><strong>${h(type.title)}</strong><br>${h(summary(type))}</span><span class="information-tooltip">${h(tooltip(type))}</span></li>`).join("")}</ul>${plotted.length < types.length ? '<p>Types with unspecified or unsupported impact levels cannot be plotted. Their saved values are retained.</p>' : ""}</figure>`;
}
export function impactScaleHelp(): string {
  return `<details class="impact-scale"><summary>About the five impact levels</summary><p>Low, Moderate and High use <a href="https://csrc.nist.gov/pubs/fips/199/final" target="_blank" rel="noopener noreferrer">FIPS 199</a>. Negligible and Critical are organisation-defined extensions.</p><dl>${impactLevels.map(level => `<dt>${level[0].toUpperCase() + level.slice(1)}</dt><dd>${h(impactDescriptions[level])}</dd>`).join("")}</dl></details>`;
}
export function informationTypesView(characteristics: Json, catalog: InformationTypeCatalog, editable: boolean, pickerOpen = false): string {
  const selected = selectedInformationTypes(characteristics), maximum = maximumImpacts(selected), disabled = editable ? "" : "disabled";
  const options = [
    ...catalog.entries.filter(entry => entry.active || selected.some(t => catalogId(t) === entry.id)).map(entry => {
      const index = selected.findIndex(t => catalogId(t) === entry.id);
      return { key: entry.id, type: index < 0 ? { title: entry.name, description: entry.description, ...Object.fromEntries(impactAxes.map(axis => [axis + "-impact", { base: entry[axis] }])) } : selected[index], checked: index >= 0, note: entry.active ? "" : "Retired — saved selection" };
    }),
    ...selected.flatMap((type, index) => catalog.entries.some(entry => entry.id === catalogId(type)) ? [] : [{ key: "saved:" + index, type, checked: true, note: "Saved in this plan" }]),
  ];
  return `<section class="information-section"><h3>System information</h3><p>Select every information type your system stores, processes or transmits. Hover or focus a type for its description and CIA levels.</p>
    <div class="information-layout"><details class="information-picker" data-expand-key="information-type-picker" ${pickerOpen ? "open" : ""}><summary>${selected.length} information ${selected.length === 1 ? "type" : "types"} selected<span>Choose information types</span></summary><fieldset class="information-options"><legend>Information types — select all that apply</legend>${options.map(option => `<label class="information-option" title="${h(tooltip(option.type))}"><input type="checkbox" aria-label="${h(option.type.title)}" data-information-type="${h(option.key)}" ${option.checked ? "checked" : ""} ${disabled}><span><strong>${h(option.type.title)}</strong><small>${h(summary(option.type))}${option.note ? " · " + h(option.note) : ""}</small></span><span class="information-tooltip">${h(tooltip(option.type))}</span></label>`).join("") || '<p>No types are available. Ask an administrator to create one.</p>'}</fieldset></details>${informationRadar(selected)}</div>
    <p class="legend">Selections keep the name, description and levels saved with this plan. To adopt an administrator’s updated definition, remove it and select it again.</p></section>
    <section class="information-section"><h3>Security objectives</h3><p>Each objective defaults to the highest level among the selected information types. You can override each objective separately.</p>${impactScaleHelp()}<div class="form-grid">${impactAxes.map(axis => {
      const value = characteristics["security-impact-level"]?.["security-objective-" + axis] || "";
      return `<div><label class="field">${axisLabels[axis]} objective<select aria-label="${axisLabels[axis]} objective" data-objective="${axis}" ${disabled}>${(!impactLevels.includes(value) ? [`<option value="${h(value)}" selected>${h(value || "Unspecified")}</option>`] : []).join("")}${impactLevels.map(level => `<option title="${h(impactDescriptions[level])}" value="${level}" ${value === level ? "selected" : ""}>${level}</option>`).join("")}</select><small>Selected maximum: ${maximum[axis] || "unspecified"} · ${isObjectiveOverride(characteristics, axis) ? "Manual override" : "Automatic"}</small></label><button class="quiet" data-objective-reset="${axis}" ${disabled || (!maximum[axis] ? "disabled" : "")}>Use selected maximum</button></div>`;
    }).join("")}</div>${belowMaximumWarnings(characteristics).map(w => `<p class="objective-warning">${h(w)}</p>`).join("")}</section>`;
}
export function bindInformationTypes(characteristics: Json, catalog: InformationTypeCatalog, editable: boolean, changed: () => void) {
  const commit = (draft: Json) => {
    const warnings = belowMaximumWarnings(draft);
    if (warnings.length && !confirm("Security objectives are below the selected information types’ maximum levels:\n\n" + warnings.join("\n") + "\n\nDo you want to confirm these lower levels?")) return false;
    const scrollTop = document.querySelector(".information-options")?.scrollTop || 0;
    const focusedType = (document.activeElement as HTMLElement | null)?.dataset.informationType;
    Object.assign(characteristics, draft); changed();
    const options = document.querySelector(".information-options");
    if (options) options.scrollTop = scrollTop;
    if (focusedType) Array.from(document.querySelectorAll<HTMLInputElement>("[data-information-type]")).find(input => input.dataset.informationType === focusedType)?.focus({ preventScroll: true });
    return true;
  };
  const picker = document.querySelector<HTMLDetailsElement>(".information-picker");
  if (picker) picker.onkeydown = event => {
    if (event.key === "Escape") { picker.open = false; picker.querySelector("summary")?.focus(); }
  };
  document.querySelectorAll<HTMLInputElement>("[data-information-type]").forEach(input => input.onchange = () => {
    if (!editable) return;
    const key = input.dataset.informationType!, draft = structuredClone(characteristics);
    let types = selectedInformationTypes(draft);
    if (input.checked) {
      const entry = catalog.entries.find(e => e.id === key && e.active);
      if (!entry) { input.checked = false; return; }
      types.push(toOscalInformationType(entry));
    } else types = types.filter((type, index) => key.startsWith("saved:") ? index !== Number(key.slice(6)) : catalogId(type) !== key);
    if (!types.length) { alert("Select at least one information type before removing the last selection."); input.checked = true; return; }
    applyInformationSelection(draft, types);
    if (!commit(draft)) input.checked = !input.checked;
  });
  document.querySelectorAll<HTMLSelectElement>("[data-objective]").forEach(input => input.onchange = () => {
    if (!editable) return;
    const axis = impactAxes.find(a => a === input.dataset.objective)!;
    const draft = structuredClone(characteristics);
    draft["security-impact-level"] ??= {};
    draft["security-impact-level"]["security-objective-" + axis] = input.value;
    setObjectiveMode(draft, axis, true);
    if (!commit(draft)) input.value = characteristics["security-impact-level"]?.["security-objective-" + axis] || "";
  });
  document.querySelectorAll<HTMLButtonElement>("[data-objective-reset]").forEach(button => button.onclick = () => {
    if (!editable) return;
    const axis = impactAxes.find(a => a === button.dataset.objectiveReset)!;
    const maximum = maximumImpacts(selectedInformationTypes(characteristics))[axis];
    if (!maximum) return;
    characteristics["security-impact-level"] ??= {};
    characteristics["security-impact-level"]["security-objective-" + axis] = maximum;
    setObjectiveMode(characteristics, axis, false); changed();
  });
}
