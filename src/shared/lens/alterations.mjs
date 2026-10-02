/** Apply profile alterations to a private tree of selected controls. */
import {
  parameterScope
} from './parameters.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const collectionNames = {
  params: 'param',
  props: 'prop',
  links: 'link',
  parts: 'part',
  controls: 'control',
  constraints: 'constraint',
  guidelines: 'guideline',
  values: 'value',
  choice: 'choice'
};
const criteria = {
  'by-id': 'id',
  'by-name': 'name',
  'by-class': 'class',
  'by-ns': 'ns'
};

// Visit assemblies and text fields, but never treat identifiers as removable
// contents. Nested controls are traversed through the same selected tree.
function contents(node) {
  const entries = [];
  for (const [key, value] of Object.entries(node)) {
    if (collectionNames[key] && Array.isArray(value)) {
      for (const item of value) entries.push({
        parent: node,
        key,
        item,
        name: collectionNames[key]
      });
    } else if (['title', 'prose', 'remarks', 'label', 'usage', 'select'].includes(key)) {
      entries.push({
        parent: node,
        key,
        item: value,
        name: key
      });
    }
  }
  return entries;
}

function removeContents(node, selector) {
  let count = 0;
  for (const entry of contents(node)) {
    const matches = Object.entries(selector).every(([key, value]) =>
      key === 'by-item-name' ? entry.name === value : entry.item?.[criteria[key]] === value);
    if (matches) {
      if (Array.isArray(entry.parent[entry.key])) {
        entry.parent[entry.key] = entry.parent[entry.key].filter(item => item !== entry.item);
        if (!entry.parent[entry.key].length) delete entry.parent[entry.key];
      } else delete entry.parent[entry.key];
      count++;
    } else if (entry.item && typeof entry.item === 'object') {
      count += removeContents(entry.item, selector);
    }
  }
  return count;
}

function findTargets(node, id) {
  const matches = [];
  for (const entry of contents(node)) {
    if (!entry.item || typeof entry.item !== 'object') continue;
    if (entry.item.id === id) matches.push(entry);
    matches.push(...findTargets(entry.item, id));
  }
  return matches;
}

function addContents(control, addition, notes) {
  const targets = addition['by-id'] ? findTargets(control, addition['by-id']) : [];
  if (addition['by-id'] && targets.length !== 1) {
    notes.push(
      `Addition to ${control.id}: ${targets.length ? 'ambiguous' : 'missing'} target ${addition['by-id']}; skipped.`
      );
    return;
  }
  const target = targets[0];
  const position = addition.position || 'ending';
  if (!['starting', 'ending', 'before', 'after'].includes(position)) throw Error(
    'Unsupported addition position: ' + position);
  const beside = target && ['before', 'after'].includes(position);
  const container = beside ? target.parent : target ? target.item : control;
  if (!container || typeof container !== 'object') throw Error('Addition target must be an assembly.');

  for (const [key, value] of Object.entries(addition)) {
    if (['by-id', 'position'].includes(key)) continue;
    if (!['title', 'params', 'props', 'links', 'parts'].includes(key)) throw Error(
      'Unsupported addition content: ' + key);
    if (key === 'title') {
      container.title = value;
      continue;
    }
    const existing = container[key] || [];
    let offset = ['starting', 'before'].includes(position) ? 0 : existing.length;
    if (beside && key === target.key) {
      offset = existing.indexOf(target.item) + (position === 'after' ? 1 : 0);
    }
    container[key] = [...existing.slice(0, offset), ...copy(value), ...existing.slice(offset)];
  }
}

/**
 * Rows are flat for display, but parent-targeted alterations must affect the
 * same child objects displayed as separate rows. Link selected children first,
 * apply removes then adds per alter, and discard rows removed through a parent.
 */
export function applyAlterations(rows, alters = [], notes = []) {
  if (!alters.length) return;
  const originalParameters = new Map(rows.map(row => [row, (row.control.params || []).map(parameter =>
    parameter.id)]));
  const parentRows = new Map();
  for (const row of rows) {
    const candidates = rows.filter(parent => parent !== row && parent.source === row.source &&
      row.parents.includes(parent.control.id));
    candidates.sort((a, b) => row.parents.indexOf(b.control.id) - row.parents.indexOf(a.control.id));
    parentRows.set(row, candidates[0]);
    delete row.control.controls;
  }
  for (const row of rows) {
    const parent = parentRows.get(row);
    if (parent)(parent.control.controls ||= []).push(row.control);
  }
  const roots = rows.filter(row => !parentRows.get(row));

  function reachable() {
    const controls = new Set();

    function visit(control) {
      controls.add(control);
      for (const child of control.controls || []) visit(child);
    }
    roots.forEach(row => visit(row.control));
    return controls;
  }

  for (const alter of alters) {
    const live = reachable();
    const targets = rows.filter(row => live.has(row.control) && row.control.id === alter['control-id']);
    if (!targets.length) {
      notes.push('Alteration target not selected: ' + alter['control-id']);
      continue;
    }
    if (targets.length > 1) throw Error('Ambiguous alteration control: ' + alter['control-id']);
    const control = targets[0].control;
    for (const removal of alter.removes || []) {
      const unknown = Object.keys(removal).filter(key => key !== 'by-item-name' && !criteria[key]);
      if (unknown.length) throw Error('Unsupported removal selector: ' + unknown.join(', '));
      if (!removeContents(control, removal)) notes.push('Removal matched no contents in ' + control.id + '.');
    }
    for (const addition of alter.adds || []) addContents(control, addition, notes);
  }

  const live = reachable();
  const scopes = new Map();

  function effectiveScope(row) {
    if (scopes.has(row)) return scopes.get(row);
    const parent = parentRows.get(row);
    const base = {
      ...row.parameters
    };
    // Clear old local/ancestor definitions so removed parameters cannot linger.
    for (let ancestor = row; ancestor; ancestor = parentRows.get(ancestor)) {
      for (const id of originalParameters.get(ancestor)) delete base[id];
    }
    const scope = parameterScope(parent ? {
      ...base,
      ...effectiveScope(parent)
    } : base, row.control.params);
    scopes.set(row, scope);
    return scope;
  }
  rows.splice(0, rows.length, ...rows.filter(row => live.has(row.control)));
  for (const row of rows) row.parameters = effectiveScope(row);
}
