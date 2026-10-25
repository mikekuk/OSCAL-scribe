import type { Json } from "./types";

export const impactAxes = ["confidentiality", "integrity", "availability"] as const;
export const impactLevels = ["negligible", "low", "moderate", "high", "critical"] as const;
export type ImpactAxis = typeof impactAxes[number];
export type ImpactLevel = typeof impactLevels[number];
export const impactDescriptions: Record<ImpactLevel, string> = {
  negligible: "Custom extension: impact below Low, as defined by your organisation.",
  low: "FIPS 199: limited adverse effects on operations, assets or individuals.",
  moderate: "FIPS 199: serious adverse effects on operations, assets or individuals.",
  high: "FIPS 199: severe or catastrophic adverse effects on operations, assets or individuals.",
  critical: "Custom extension: impact above High, as defined by your organisation.",
};
export type ImpactLevels = Record<ImpactAxis, ImpactLevel>;
export interface InformationType extends ImpactLevels { id: string; name: string; description: string; active: boolean }
export interface InformationTypeCatalog { entries: InformationType[]; version: number; _etag?: string }
const ns = "https://oscal-scribe.dev/ns";
export const defaultInformationType: InformationType = {
  id: "6e93751d-71c9-4b49-b233-c3c6f63b52a1", name: "Business information",
  description: "General business information processed by the system. Review its suitability and impact levels for your organisation.",
  confidentiality: "low", integrity: "low", availability: "low", active: true,
};
export const emptyInformationTypeCatalog = (): InformationTypeCatalog => ({ entries: [{ ...defaultInformationType }], version: 0 });
export const selectedInformationTypes = (characteristics: Json): Json[] => characteristics["system-information"]?.["information-types"] || [];
export const catalogId = (type: Json): string | undefined => type.props?.find((p: Json) => p.ns === ns && p.name === "information-type-id")?.value;
export function toOscalInformationType(type: InformationType): Json {
  return { uuid: crypto.randomUUID(), title: type.name, description: type.description,
    props: [{ ns, name: "information-type-id", value: type.id }],
    ...Object.fromEntries(impactAxes.map(axis => [axis + "-impact", { base: type[axis] }])) };
}
export function impactLevel(type: Json, axis: ImpactAxis): ImpactLevel | undefined {
  const value = type[axis + "-impact"]?.selected ?? type[axis + "-impact"]?.base;
  return impactLevels.includes(value) ? value : undefined;
}
export function maximumImpacts(types: Json[]): Partial<ImpactLevels> {
  return Object.fromEntries(impactAxes.map(axis => {
    // An absent or unsupported imported impact is unknown, never silently Low.
    const values = types.map(type => impactLevel(type, axis));
    return [axis, values.length && values.every(Boolean) ? impactLevels[Math.max(...values.map(v => impactLevels.indexOf(v!)))] : undefined];
  }));
}
export function isObjectiveOverride(characteristics: Json, axis: ImpactAxis): boolean {
  const mode = characteristics.props?.find((p: Json) => p.ns === ns && p.name === "objective-mode-" + axis)?.value;
  if (mode) return mode === "manual";
  const maximum = maximumImpacts(selectedInformationTypes(characteristics))[axis];
  const objective = characteristics["security-impact-level"]?.["security-objective-" + axis];
  return !!objective && objective !== maximum;
}
export function setObjectiveMode(characteristics: Json, axis: ImpactAxis, manual: boolean) {
  characteristics.props = (characteristics.props || []).filter((p: Json) => !(p.ns === ns && p.name === "objective-mode-" + axis));
  characteristics.props.push({ ns, name: "objective-mode-" + axis, value: manual ? "manual" : "automatic" });
}
export function applyInformationSelection(characteristics: Json, types: Json[]) {
  if (!types.length) throw Error("Select at least one information type before removing the last selection.");
  const overrides = impactAxes.map(axis => isObjectiveOverride(characteristics, axis));
  const maximum = maximumImpacts(types);
  characteristics["system-information"] ??= {};
  characteristics["system-information"]["information-types"] = types;
  characteristics["security-impact-level"] ??= {};
  impactAxes.forEach((axis, i) => {
    setObjectiveMode(characteristics, axis, overrides[i]);
    if (!overrides[i] && maximum[axis]) characteristics["security-impact-level"]["security-objective-" + axis] = maximum[axis];
  });
}
export function belowMaximumWarnings(characteristics: Json): string[] {
  const maximum = maximumImpacts(selectedInformationTypes(characteristics));
  return impactAxes.flatMap(axis => {
    const value = characteristics["security-impact-level"]?.["security-objective-" + axis];
    if (!maximum[axis] || !impactLevels.includes(value) || impactLevels.indexOf(value) >= impactLevels.indexOf(maximum[axis]!)) return [];
    const names = selectedInformationTypes(characteristics).filter(t => impactLevel(t, axis) === maximum[axis]).map(t => t.title).join(", ");
    return [`${axis[0].toUpperCase() + axis.slice(1)}: ${value} is below the selected maximum of ${maximum[axis]} (${names}).`];
  });
}
