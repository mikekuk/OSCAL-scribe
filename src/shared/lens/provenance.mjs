/** Compare effective profile content with the original catalogue, without editing either. */
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function originalPart(part, siblings = [], index = 0) {
  if (part.id) return siblings.find(item => item.id === part.id);
  return siblings.find(item => same(item, part)) || siblings.find(item => !item.id && item.name === part.name) || siblings[index];
}
export function parameterChanged(id, current = {}, original = {}, trail = []) {
  if (trail.includes(id)) return false;
  if (!same(current[id], original[id])) return true;
  const parameter = current[id];
  if (!parameter) return false;
  const refs = [...JSON.stringify(parameter).matchAll(/\{\{\s*insert:\s*param\s*,\s*([^{}]+?)\s*\}\}/g)].map(m => m[1].trim());
  for (const prop of parameter.props || []) {
    if (prop.name === 'aggregates' && (!prop.ns || prop.ns === 'http://csrc.nist.gov/ns/rmf')) refs.push(prop.value);
  }
  return refs.some(ref => parameterChanged(ref, current, original, [...trail, id]));
}
export function removedContent(current, original) {
  const removed = [];
  function walk(now, before, path) {
    if (!before || typeof before !== 'object') return;
    for (const [key, value] of Object.entries(before)) {
      if (key === 'controls') continue;
      if (!(key in (now || {}))) { removed.push({ field: [...path, key].join(' / '), original: value }); continue; }
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const match = item?.id ? now[key]?.find(x => x.id === item.id) : now[key]?.[index];
          if (match === undefined) removed.push({ field: [...path, key, item?.id || index + 1].join(' / '), original: item });
          else walk(match, item, [...path, key, item?.id || index + 1]);
        });
      } else if (value && typeof value === 'object') walk(now[key], value, [...path, key]);
    }
  }
  walk(current, original, []);
  return removed;
}
