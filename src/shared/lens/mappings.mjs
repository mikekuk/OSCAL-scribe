import { model, preview } from './engine.mjs';
import { resolveImport, documentPath } from './imports.mjs';

const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
export const itemLabel = item => `${({control: 'Control', statement: 'Section / statement'})[item.type] || item.type || 'Unknown type'} · ${item['id-ref'] || 'missing ID'}`;
export function reverseRelationship(relationship, ns) {
  if (ns && ns !== 'http://csrc.nist.gov/ns/oscal') return `${relationship} (original source → target)`;
  if (['equal-to', 'equivalent-to', 'intersects-with', 'no-relationship'].includes(relationship)) return relationship;
  return ({'subset-of': 'superset-of', 'superset-of': 'subset-of'})[relationship] || `${relationship} (original source → target)`;
}
function parts(items) { return list(items).flatMap(part => [part, ...parts(part.parts)]); }
export function locateItem(item, rows) {
  const id = item['id-ref'];
  const matches = [];
  for (const row of rows) {
    if (item.type === 'control' && row.control.id === id) matches.push({row, node: row.control});
    if (item.type === 'statement') {
      for (const node of parts(row.control.parts).filter(part => part.id === id)) matches.push({row, node});
    }
  }
  return matches;
}

/** Build once per workspace load. Keep sets intact, and index both browsing directions. */
export function buildMappingIndex(documents, getPreview = entry => preview(entry.doc, documents), validate, {includeResource = () => true, includeMap = () => true} = {}) {
  const index = new Map(), notices = new Map();
  const previews = new Map();
  const readPreview = entry => {
    if (!previews.has(entry.doc)) previews.set(entry.doc, getPreview(entry));
    return previews.get(entry.doc);
  };
  const addNotice = (doc, message) => notices.set(doc, [...(notices.get(doc) || []), message]);
  for (const collection of documents.filter(entry => entry.doc['mapping-collection'])) {
    const body = collection.doc['mapping-collection'];
    const issues = validate ? validate(collection.doc) : [];
    const errors = issues.filter(issue => issue.severity === 'error');
    const invalid = errors.length ? `${documentPath(collection)}: ${errors.length} schema errors; mappings are not displayed. Select the mapping file’s Validation tab for details.` : issues.some(issue => issue.code === 'schema-unavailable')
      ? `${documentPath(collection)}: no matching schema; mappings are not displayed. Select the mapping file’s Validation tab for details.` : '';
    if (invalid) addNotice(collection.doc, invalid);
    for (const mapping of list(body.mappings)) {
      const resources = ['source', 'target'].map(side => {
        try {
          const ref = mapping[side + '-resource'];
          const entry = resolveImport(body, ref?.href, collection, documents);
          if (!['catalog', 'profile'].includes(model(entry.doc).type)) throw Error('Mapping resource must be a catalogue or profile.');
          if (ref.type !== model(entry.doc).type && !(ref.type === 'profile' && model(entry.doc).type === 'catalog')) throw Error('Mapping resource type does not match the loaded document.');
          if (!includeResource(entry)) return {excluded: true};
          const result = readPreview(entry);
          return {entry, rows: result.rows, notes: result.notes, issues: validate ? validate(entry.doc) : []};
        } catch (error) { return {error: error.message, href: mapping[side + '-resource']?.href}; }
      });
      if (resources.some(resource => resource.excluded)) continue;
      for (const resource of resources) if (resource.error) addNotice(collection.doc, resource.error);
      for (let side = 0; side < 2; side++) {
        const local = resources[side], other = resources[1 - side];
        if (!local.entry || !local.rows) continue;
        if (invalid) { addNotice(local.entry.doc, invalid); continue; }
        if (other.error) addNotice(local.entry.doc, `${documentPath(collection)}: ${other.error}`);
        if (!index.has(local.entry.doc)) index.set(local.entry.doc, new Map());
        const byControl = index.get(local.entry.doc);
        for (const map of list(mapping.maps).filter(includeMap)) {
          const ownItems = list(map[side ? 'targets' : 'sources']);
          const targets = list(map[side ? 'sources' : 'targets']);
          const matchedRows = new Set();
          for (const item of ownItems) {
            const matches = locateItem(item, local.rows);
            if (!matches.length) addNotice(local.entry.doc, `${documentPath(collection)}: cannot locate ${itemLabel(item)}.`);
            if (matches.length > 1) { addNotice(local.entry.doc, `${documentPath(collection)}: ambiguous ${itemLabel(item)}; mapping not attached.`); continue; }
            for (const match of matches) matchedRows.add(match.row.control);
          }
          for (const control of matchedRows) {
            const record = {
              collection, mapping, map, ownItems, targets, other, local: local.entry, reverse: !!side,
              relationship: side ? reverseRelationship(map.relationship, map.ns) : map.relationship,
              rationale: map['matching-rationale'] || mapping['matching-rationale'] || body.provenance?.['matching-rationale'],
              status: mapping.status || body.provenance?.status,
              description: mapping['mapping-description'] || body.provenance?.['mapping-description']
            };
            byControl.set(control, [...(byControl.get(control) || []), record]);
          }
        }
      }
    }
  }
  // Read only direct attachments so inheritance is independent of upload order
  // and never leaks sideways into sibling profiles or unrelated catalogues.
  const direct = new Map(index);
  for (const entry of documents.filter(entry => entry.doc.profile && includeResource(entry))) {
    let result;
    try { result = readPreview(entry); } catch { continue; } // The profile view reports import failures.
    const byControl = new Map(direct.get(entry.doc) || []);
    for (const row of result.rows) {
      const records = [...(byControl.get(row.control) || [])];
      const seen = new Set(records);
      for (const origin of row.lineage || []) {
        for (const notice of notices.get(origin.doc) || []) addNotice(entry.doc, notice);
        const sourceEntry = documents.find(candidate => candidate.doc === origin.doc);
        const attachments = direct.get(origin.doc);
        if (!sourceEntry || !attachments) continue;
        const matches = readPreview(sourceEntry).rows.filter(source => source.control.id === origin.controlId);
        if (matches.length !== 1) continue;
        for (const record of attachments.get(matches[0].control) || []) {
          if (seen.has(record)) continue;
          seen.add(record);
          records.push({...record, inheritedFrom: record.local});
        }
      }
      if (records.length) byControl.set(row.control, records);
    }
    if (byControl.size) index.set(entry.doc, byControl);
  }
  for (const [doc, messages] of notices) notices.set(doc, [...new Set(messages)]);
  return {index, notices};
}
