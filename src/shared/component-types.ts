/** Suggested OSCAL component types. OSCAL also permits locally defined values;
 * this list is a UI vocabulary, not a closed schema enumeration. */
export const componentTypes = [
  ["this-system", "The system as a whole"],
  ["system", "An external or leveraged system"],
  ["interconnection", "A connection outside this system"],
  ["software", "Software, operating system, or firmware"],
  ["hardware", "A physical device"],
  ["service", "A service that may provide APIs"],
  ["policy", "An enforceable policy"],
  ["physical", "An asset providing physical protection"],
  ["process-procedure", "Steps or actions to achieve an outcome"],
  ["plan", "An applicable plan"],
  ["guidance", "A guideline or recommendation"],
  ["standard", "An organizational or industry standard"],
  ["validation", "An external assessment validated by a third party"],
  ["region", "An isolated geographic area of cloud data centers"],
  ["zone", "A fault-isolated data center group within a region"],
  ["resource-container", "An administrative or resource-scoping boundary"],
  ["network", "Connectivity, segmentation, routing, or network boundary control"],
] as const;

/** The editor reserves this-system for its one whole-system component. Other
 * types, including locally defined types, must remain available without remapping. */
export function localComponentType(value: string): string {
  const type = value.trim();
  if (!type || /[\r\n]/.test(type)) throw Error("Enter a component type on one line");
  if (type === "this-system") throw Error("Use the existing This system component for the system as a whole");
  return type;
}
