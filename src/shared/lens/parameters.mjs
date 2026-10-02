/** Parameter presentation is separate from OSCAL assignment/resolution. */
const INSERT = /\{\{\s*insert:\s*param\s*,\s*([^{}]+?)\s*\}\}/g;

export function parameterScope(inherited, parameters = []) {
  const scope = { ...inherited };
  for (const parameter of parameters) scope[parameter.id] = parameter;
  return scope;
}

export function insertionIds(text) {
  return [...String(text ?? '').matchAll(INSERT)].map(match => match[1].trim());
}

export function aggregateIds(parameter = {}) {
  return (parameter.props || []).filter(property => property.name === 'aggregates' &&
    (!property.ns || property.ns === 'http://csrc.nist.gov/ns/rmf') &&
    typeof property.value === 'string' && property.value.trim()).map(property => property.value.trim());
}

// Also follow definitions for usage reporting, even when an explicit value wins.
export function parameterReferences(parameter = {}) {
  return [...new Set([...insertionIds(JSON.stringify(parameter)), ...aggregateIds(parameter)])];
}

export function constraintText(parameter = {}, expand = String) {
  return (parameter.constraints || []).map(constraint => {
    const details = [constraint.description, ...(constraint.tests || []).flatMap(test =>
      [test.expression && `Test: ${test.expression}`, test.remarks])].filter(Boolean);
    return details.length ? details.map(expand).join('; ') : 'Restriction specified; see parameter details';
  }).join('; ');
}

export const parameterStatuses = {
  filled: 'Filled — explicit value', constrained: 'Constrained, not assigned',
  open: 'Open — organisation-defined', derived: 'Derived from referenced parameters'
};

export function describeParameter(id, parameters = {}, trail = []) {
  if (trail.includes(id)) return { state: 'open', text: `[Circular parameter: ${id}]` };
  const parameter = parameters[id];
  if (!parameter) return { state: 'open', text: `[Undefined parameter: ${id}]` };
  const expand = text => substituteParameters(text, parameters, [...trail, id]);
  if (parameter.values?.length) return { state: 'filled', text: parameter.values.map(expand).join('; ') };
  if (parameter.constraints?.length) return { state: 'constrained', text: `[CONSTRAINT: ${constraintText(parameter, expand)}]` };
  const aggregates = aggregateIds(parameter);
  if (aggregates.length) {
    const children = aggregates.map(ref => describeParameter(ref, parameters, [...trail, id]));
    // An aggregate must not look filled when any of its ODPs is still open.
    const state = children.some(child => child.state === 'open') ? 'open' :
      children.some(child => child.state === 'constrained') ? 'constrained' : 'derived';
    return { state, text: children.map(child => child.text).join('; ') };
  }
  if (parameter.select) {
    const quantity = parameter.select['how-many'] === 'one-or-more' ? 'one or more' : 'one';
    return { state: 'constrained', text: `[SELECT (${quantity}): ${(parameter.select.choice || []).map(expand).join(' / ') || 'choices not supplied'}]` };
  }
  return { state: 'open', text: `[ODP: ${expand(parameter.label || parameter.usage || id)}]` };
}

export function substituteParameters(prose, parameters = {}, trail = []) {
  return String(prose ?? '').replace(INSERT, (_, id) => describeParameter(id.trim(), parameters, trail).text);
}

/** Catalogue output from a resolver retains the catalog root and may identify its source. */
export function isResolvedProfile(body) {
  return (body.metadata?.links || []).some(link => link.rel === 'resolution-source');
}
