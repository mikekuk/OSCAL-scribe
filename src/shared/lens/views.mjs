import { same, originalPart, parameterChanged, removedContent } from './provenance.mjs';
import { itemLabel, locateItem } from './mappings.mjs';
import {
  substituteParameters, describeParameter, constraintText, parameterStatuses,
  insertionIds, parameterReferences, isResolvedProfile
} from './parameters.mjs';
/** Pure HTML renderers. Application state and event handlers live in app.mjs. */
import {
  model
} from './engine.mjs';
import {
  documentPath
} from './imports.mjs';

// OSCAL prose can contain markup. Always display supplied content as text rather
// than allowing it to become executable HTML in an innerHTML assignment.
export function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function omitFields(object, excluded) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !excluded.includes(key)));
}

// Keep unknown extension fields visible instead of limiting the view to a fixed
// set of metadata properties. Nested OSCAL assemblies become nested field lists.
export function renderFields(value, original, trackChanges = false) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return `<p>${changedText(escapeHtml(value), trackChanges && !same(value, original))}</p>`;
  if (Array.isArray(value)) {
    return value.map((item, index) => `<div class="part">${renderFields(item, item?.id ? original?.find(x => x.id === item.id) : original?.[index], trackChanges)}</div>`).join('');
  }
  const fields = Object.entries(value).map(([key, fieldValue]) => {
    const content = typeof fieldValue === 'object' ? renderFields(fieldValue, original?.[key], trackChanges) : changedText(escapeHtml(fieldValue), trackChanges && !same(fieldValue, original?.[key]));
    return `<div class="kv"><dt>${escapeHtml(key)}</dt><dd>${content}</dd></div>`;
  });
  return `<dl>${fields.join('')}</dl>`;
}

// Visibility is keyed by part name so the same section setting applies across controls.
export function sectionVisible(name, visibility = {}) {
  return visibility[name] ?? !/assessment|objective/i.test(name);
}

export function controlSections(rows) {
  const names = new Set();
  for (const row of rows) {
    for (const part of row.control.parts || []) names.add(part.name || 'other');
  }
  return [...names];
}

export function renderSectionOptions(rows, visibility) {
  const names = controlSections(rows);
  const options = names.map(name => {
    const label = name.replace(/-/g, ' ');
    return `<label class="section-option"><input type="checkbox" data-section="${escapeHtml(name)}" ${sectionVisible(name, visibility) ? 'checked' : ''}> ${escapeHtml(label)}</label>`;
  });
  if (rows.some(row => row.mappings?.length)) options.push(`<label class="section-option"><input type="checkbox" data-section="mappings" ${visibility.mappings !== false ? 'checked' : ''}> Mappings</label>`);
  options.push(
    `<label class="section-option"><input type="checkbox" data-section="parameters" ${visibility.parameters ? 'checked' : ''}> Parameters</label>`
  );
  options.push(
    `<label class="section-option"><input type="checkbox" data-section="metadata" ${visibility.metadata ? 'checked' : ''}> Control metadata</label>`
  );
  return options.join('');
}

// Statement items keep their labels inline, with space between subsections;
// structural OSCAL IDs and property tables stay in the Source view.
function changedText(html, changed, kind = 'content') {
  return changed ? `<span class="profile-change" title="Added or changed by a profile layer (${kind})">${html}</span>` : html;
}
function renderProse(text, parameters, row, changed) {
  const input = String(text ?? '').replace(/\s+/g, ' ').trim();
  const pattern = /\{\{\s*insert:\s*param\s*,\s*([^{}]+?)\s*\}\}/g;
  let result = '', offset = 0;
  for (const match of input.matchAll(pattern)) {
    result += changedText(escapeHtml(input.slice(offset, match.index)), changed);
    const id = match[1].trim();
    const { text: value, state } = describeParameter(id, parameters);
    const constraint = constraintText(parameters[id]);
    const hint = `${parameterStatuses[state]}${constraint ? '. Constraint: ' + constraint : ''}`;
    const modified = row?.baseControl && parameterChanged(match[1].trim(), parameters, row.baseParameters);
    result += `<span class="odp odp-${state}" tabindex="0" title="${escapeHtml(hint)}">${changedText(escapeHtml(value), changed || modified, 'parameter')}</span>`;
    offset = match.index + match[0].length;
  }
  return result + changedText(escapeHtml(input.slice(offset)), changed);
}
function renderPartFlow(part, parameters, visibility, isSectionRoot = false, row, original, depth = 0) {
  const label = part.props?.find(property => property.name === 'label')?.value;
  const oldLabel = original?.props?.find(property => property.name === 'label')?.value;
  const profile = !!row?.baseControl;
  const prose = renderProse(part.prose, parameters, row, profile && part.prose !== original?.prose);
  const heading = Math.min(6, 5 + depth);
  const title = !isSectionRoot && part.title ? `<h${heading} class="subsection-title">${changedText(escapeHtml(part.title), profile && part.title !== original?.title)}</h${heading}>` : '';
  const prefix = label ? `<strong class="item-label">${changedText(escapeHtml(label), profile && label !== oldLabel)}</strong> ` : '';
  const ownText = prose ? `<span class="statement-item">${prefix}${prose}</span>` : prefix;
  const children = (part.parts || []).map((child, index) => renderPartFlow(child, parameters, visibility, false, row, originalPart(child, original?.parts, index), isSectionRoot ? depth : depth + 1)).filter(Boolean);
  const content = [title + ownText, ...children].filter(Boolean).join('');
  return isSectionRoot ? content : `<div class="statement-subsection">${content}</div>`;
}

function renderParts(parts = [], parameters = {}, visibility = {}, row) {
  return parts.map((part, index) => {
    if (!sectionVisible(part.name || 'other', visibility)) return '';
    const original = originalPart(part, row?.baseControl?.parts, index);
    const title = part.title || (part.name || 'other').replace(/-/g, ' ');
    const changed = !!row?.baseControl && (!original || part.title !== original.title || part.name !== original.name);
    return `<section class="control-section"><h4>${changedText(escapeHtml(title), changed)}</h4><div class="statement-flow">${renderPartFlow(part, parameters, visibility, true, row, original)}</div></section>`;
  }).join('');
}

export function allGroups(root) {
  return (root.groups || []).flatMap(group => [group, ...allGroups(group)]);
}

export function renderNotice(message, isError = false) {
  return message ? `<div class="notice ${isError ? 'error' : ''}">${escapeHtml(message)}</div>` : '';
}

function renderProcessingNotes(result, problem) {
  return renderNotice(problem, true) + result.notes.map(note => renderNotice(note)).join('');
}

export function renderDocuments(documents, currentIndex, loading = false, collapsed = new Set()) {
  const labels = {catalog: 'Catalogues', profile: 'Profiles', 'mapping-collection': 'Mapping collections',
    'component-definition': 'Component definitions', 'system-security-plan': 'System security plans',
    'assessment-plan': 'Assessment plans', 'assessment-results': 'Assessment results',
    'plan-of-action-and-milestones': 'Plans of action and milestones'};
  const groups = new Map();
  documents.forEach((entry, index) => {
    const type = model(entry.doc).type;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({entry, index});
  });
  return [...groups].map(([type, entries]) => `<details class="document-group" data-model-group="${escapeHtml(type)}"${collapsed.has(type) ? '' : ' open'}>
    <summary>${escapeHtml(labels[type] || type)} (${entries.length})</summary>
    ${entries.map(({entry, index}) => {
    const {
      type,
      body
    } = model(entry.doc);
    return `<div class="doc-row"><button type="button" class="doc ${index === currentIndex ? 'active' : ''}" data-doc="${index}">
      ${escapeHtml(body.metadata?.title || entry.name)}
      <small>${escapeHtml(type === 'catalog' && isResolvedProfile(body) ? 'resolved profile (catalogue)' : type)} · ${escapeHtml(documentPath(entry))}</small>
    </button><button type="button" class="doc-remove" data-remove-doc="${index}"
      aria-label="${escapeHtml('Remove ' + documentPath(entry) + ' from workspace')}"
      title="${escapeHtml('Remove ' + documentPath(entry) + ' from workspace')}"${loading ? ' disabled' : ''}><span aria-hidden="true">×</span></button></div>`;
  }).join('')}</details>`).join('');
}

export function renderHeading(entry, type, body, result, issues) {
  const groupCount = new Set(result.rows.flatMap(row => row.groups.map(group => group.id || group.title)))
    .size;
  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  const status = errorCount ? `${errorCount} validation errors` : issues.some(issue => issue.code === 'schema-unavailable') ? 'Schema not checked' : issues.length ? 'Validation notice' :
    'Schema checks passed';
  return `<div>
    <p class="eyebrow">${type === 'profile' ? 'PROFILE SELECTION PREVIEW' : type === 'mapping-collection' ? 'MAPPING COLLECTION' : isResolvedProfile(body) ? 'RESOLVED PROFILE · CATALOGUE' : 'CATALOGUE'}</p>
    <h2>${escapeHtml(body.metadata?.title || entry.name)}</h2>
    <p>${result.rows.length} controls · ${groupCount} groups · OSCAL ${escapeHtml(body.metadata?.['oscal-version'] || 'unknown')}</p>
  </div><span class="badge ${issues.length ? 'warn' : ''}">${status}</span>`;
}

export function renderGroups(sources, result, selectedGroup) {
  const groups = new Map();
  for (const source of sources) {
    for (const group of allGroups(source)) groups.set(group.id || group.title, group);
  }
  return [...groups].map(([id, group]) => {
    const count = result.rows.filter(row => row.groups.some(parent => (parent.id || parent.title) === id))
      .length;
    return `<button class="group ${selectedGroup === id ? 'active' : ''}" data-group="${escapeHtml(id)}">
      ${escapeHtml(group.title || id)} <small>(${count})</small>
    </button>`;
  }).join('') || '<p class="side-foot">No source groups</p>';
}

export function renderValidation(issues, result, problem, type = 'catalog', version) {
  const schemaStatus = issues.some(issue => issue.code === 'schema-unavailable')
    ? 'No matching bundled schema was available; schema validation was not performed. Identifier checks are reported below.'
    : `Checked against bundled NIST OSCAL ${escapeHtml(version)} ${escapeHtml(type)} JSON Schema, with identifier checks.`;
  const report = issues.length ? issues.map(issue => `<div class="issue">
    <span class="badge warn">${escapeHtml(issue.severity)}</span>
    <code>${escapeHtml(issue.path)}</code>${escapeHtml(issue.message)}
  </div>`).join('') : '<p>Schema and identifier checks passed.</p>';
  return `<div class="matter-block">
    <h3>Validation report</h3>
    <p>${schemaStatus} Profile processing is reported separately.</p>
    ${report}
  </div>${renderProcessingNotes(result, problem)}`;
}

export function renderSource(document) {
  // Keep JSON whitespace inside pre intact when changing surrounding markup.
  return `<pre>${escapeHtml(JSON.stringify(document, null, 2))}</pre>`;
}

export function renderGreyMatter(roots, selectedGroup, problem) {
  function section(title, node) {
    // Controls have their own view; all other group/document fields are context.
    return `<section class="matter-block"><h3>${escapeHtml(title)}</h3>${renderFields(omitFields(node, ['controls', 'groups']))}</section>`;
  }
  const content = roots.map(root => {
    const groups = allGroups(root).filter(group => !selectedGroup || (group.id || group.title) ===
      selectedGroup);
    return section(root.metadata?.title || 'Document', root) + groups.map(group => section(group.title ||
      group.id, group)).join('');
  }).join('');
  return `<div class="count">Grey matter · metadata, guidance, parameters and supporting resources</div>${renderNotice(problem, true)}${content}`;
}

// Report direct and transitive uses (including NIST aggregate ODPs) by statement ID.
function parameterUses(id, row) {
  const uses = new Set();
  function reaches(ref, trail = []) {
    if (ref === id) return true;
    if (trail.includes(ref)) return false;
    return parameterReferences(row.parameters?.[ref]).some(next => reaches(next, [...trail, ref]));
  }
  function walk(parts = []) {
    for (const part of parts) {
      if (insertionIds(part.prose).some(ref => reaches(ref))) uses.add(part.id || part.title || part.name || row.control.id);
      walk(part.parts);
    }
  }
  walk(row.control.parts);
  return [...uses].join('; ') || 'Not referenced in this control’s prose';
}

function renderParameter(parameter, row) {
  const scope = row.parameters || Object.fromEntries((row.control.params || []).map(p => [p.id, p]));
  const { text, state } = describeParameter(parameter.id, scope);
  const original = row.baseParameters?.[parameter.id];
  const label = parameter.label || parameter.usage;
  const definition = original ? (original.label || original.usage) : label;
  const fields = {
    Status: parameterStatuses[state],
    [parameter.values?.length ? 'Value' : 'Inline display']: text,
    ...(parameter.constraints?.length ? { Constraint: constraintText(parameter) } : {}),
    ...(parameter.select ? { Selection: parameter.select } : {}),
    ...(parameter.guidelines?.length ? { Guidelines: parameter.guidelines } : {}),
    [original ? 'Catalogue definition' : 'Definition in supplied document']: definition || 'Not supplied',
    'Used in': parameterUses(parameter.id, row)
  };
  return `<div class="parameter-detail"><h5>${escapeHtml(parameter.id)}${label ? ' — ' + escapeHtml(label) : ''}</h5>${renderFields(fields)}<details><summary>Full parameter definition</summary>${renderFields(parameter, original, !!row.baseControl)}</details></div>`;
}

function renderControl(row, index, visibility, includeMappings = true) {
  const control = row.control;
  const breadcrumb = [...row.groups.map(group => group.title), ...row.parents].join(' / ') || 'Ungrouped';
  const source = row.source ? ' · ' + escapeHtml(row.source) : '';
  // Show the effective scope so inherited and profile-tailored values agree with inline ODPs.
  const effectiveParameters = Object.values(row.parameters || {}).length
    ? Object.values(row.parameters) : (control.params || []);
  const parameters = visibility.parameters && effectiveParameters.length
    ? `<section class="control-section"><h4>Parameters</h4>${effectiveParameters.map(parameter => renderParameter(parameter, row)).join('')}</section>` : '';
  const metadata = visibility.metadata ? renderFields(omitFields(control, ['id', 'title', 'parts', 'params',
    'controls'
  ]), row.baseControl, !!row.baseControl) : '';
  return `<details class="control" ${index === 0 ? 'open' : ''}>
    <summary><span class="id">${escapeHtml(control.id)}</span><strong>${changedText(escapeHtml(control.title), !!row.baseControl && control.title !== row.baseControl.title)}</strong>
      <span class="crumb">${escapeHtml(breadcrumb)}${source}</span>
    </summary>
    <div class="detail">${renderParts(control.parts, row.parameters, visibility, row)}${parameters}${metadata}${renderProfileChanges(row)}${includeMappings && visibility.mappings !== false ? renderMappings(row.mappings, visibility) : ''}</div>
  </details>`;
}

export function renderControls(type, result, problem, errorCount, selectedGroup, query, visibility = {}) {
  const rows = result.rows.filter(row => {
    const inGroup = !selectedGroup || row.groups.some(group => (group.id || group.title) ===
      selectedGroup);
    return inGroup && substituteParameters(JSON.stringify(row.control), row.parameters).toLowerCase()
      .includes(query);
  });
  const previewNotice = type === 'profile' ? renderNotice(
    'Selection preview: selected controls and effective parameter definitions are shown within source groups. This is not a fully resolved OSCAL catalogue.'
  ) : '';
  const invalidNotice = errorCount ? renderNotice(
    'This document has validation errors. Displayed content is for inspection only.', true) : '';
  const emptyMessage = problem ? 'Load the missing source files to see the profile’s controls.' :
    'No controls match this view.';
  const controls = rows.length ? rows.map((row, index) => renderControl(row, index, visibility)).join('') :
    `<div class="empty">${emptyMessage}</div>`;
  return `${previewNotice}${type === 'profile' ? '<p class="profile-legend"><span class="profile-change">Dotted underline</span> = added or changed by a profile layer. Other text comes from the catalogue.</p>' : ''}${invalidNotice}<p class="odp-legend"><span class="odp odp-filled">Filled</span> explicit value · <span class="odp odp-constrained">Constrained</span> restriction or selection, not assigned · <span class="odp odp-open">Open</span> organisation-defined. Parameter details are available using the Parameters toggle.</p>${renderProcessingNotes(result, problem)}
    <div class="count"><span>${rows.length} ${rows.length === 1 ? 'control' : 'controls'} shown</span>
      <span>${selectedGroup ? 'Filtered by group' : 'All groups'}</span>
    </div>${controls}`;
}

function renderProfileChanges(row) {
  if (!row.baseControl) return '';
  const removed = removedContent(row.control, row.baseControl);
  return removed.length ? `<details class="profile-removals"><summary>Profile removals (${removed.length})</summary><p>Catalogue content removed by the profile layers:</p>${renderFields(removed)}</details>` : '';
}
function renderMappings(records = [], visibility) {
  if (!records.length) return '';
  return `<section class="control-section mappings"><h4>Mappings (${records.length})</h4>${records.map(record => {
    const {map, mapping, other} = record;
    const otherBody = other.entry && model(other.entry.doc).body;
    const title = otherBody?.metadata?.title || other.entry?.name || other.href || 'Missing resource';
    const targets = record.targets.map(item => itemLabel(item)).join('; ');
    const collective = record.ownItems.length > 1 || record.targets.length > 1;
    return `<details class="mapping"><summary><span class="badge">${escapeHtml(record.relationship || 'Relationship unspecified')}</span><strong>${escapeHtml(title)}</strong><span class="mapping-targets">${escapeHtml(targets)}</span></summary>
      <div class="mapping-detail"><p><strong>This side:</strong> ${escapeHtml(record.ownItems.map(itemLabel).join('; '))}</p>
      ${record.inheritedFrom ? renderNotice('Inherited from ' + documentPath(record.inheritedFrom) + '. This mapping describes the source content; profile tailoring does not reassess the relationship.') : ''}
      <p><strong>Relationship:</strong> ${escapeHtml(record.relationship)}${map.ns ? ' · namespace: ' + escapeHtml(map.ns) : ''}</p>
      ${collective ? '<p class="notice">This relationship applies to the complete sets listed on each side, collectively.</p>' : ''}
      ${map.remarks ? '<p>' + escapeHtml(map.remarks) + '</p>' : ''}
      ${mapping.remarks ? '<p>' + escapeHtml(mapping.remarks) + '</p>' : ''}
      ${map.qualifiers ? renderFields({qualifiers: map.qualifiers}) : ''}
      ${(other.notes || []).map(note => renderNotice(note)).join('')}
      ${other.issues?.some(issue => issue.severity === 'error') ? renderNotice('The referenced document has validation errors. Its content is shown for inspection.', true) : ''}
      ${other.entry?.doc.profile ? renderNotice('Referenced profile: selection preview with effective tailoring; not a fully resolved catalogue.') : ''}
      ${other.error ? renderNotice(other.error, true) : record.targets.map(item => {
        const matches = locateItem(item, other.rows || []);
        if (!matches.length) return renderNotice('Cannot locate ' + itemLabel(item) + ' in the loaded resource.', true);
        if (matches.length > 1) return renderNotice('Ambiguous ' + itemLabel(item) + ': multiple matches; no control selected.', true);
        return matches.map(({row: targetRow, node}) => `<div class="mapped-item"><h5>${escapeHtml(itemLabel(item))}</h5>
          ${item.type === 'control' ? '' : '<div class="statement-flow">' + renderPartFlow(node, targetRow.parameters, {}, false, targetRow, findOriginalPart(targetRow.baseControl?.parts, node.id)) + '</div>'}
          <p>Full control · ${escapeHtml(targetRow.control.id)}</p>${renderControl(targetRow, 0, visibility, false)}</div>`).join('');
      }).join('')}
      </div></details>`;
  }).join('')}</section>`;
}

function findOriginalPart(parts = [], id) {
  for (const part of parts) {
    if (id && part.id === id) return part;
    const nested = findOriginalPart(part.parts, id);
    if (nested) return nested;
  }
}

/** Keep file membership explicit, including identical control IDs in different files. */
export function renderGraphControlLists(groups) {
  return groups.map((group, groupIndex) => `<details class="graph-file-controls" open>
    <summary>${escapeHtml(group.title)} · ${group.related.length} related · ${group.isolated.length} isolated</summary>
    <p class="graph-file-path">${escapeHtml(group.id)}</p>
    ${['isolated', 'related'].map(kind => `<details class="graph-control-category" open>
      <summary>${kind === 'isolated' ? 'Isolated controls' : 'Related controls'} (${group[kind].length})</summary>
      <div class="graph-control-buttons">${group[kind].map((node, index) => `<button type="button" data-list-group="${groupIndex}" data-list-kind="${kind}" data-list-node="${index}">${escapeHtml(node.label)} · ${escapeHtml(node.title)} · ${node.degree} neighbours</button>`).join('') || `<p>No ${kind} controls.</p>`}</div>
    </details>`).join('')}
  </details>`).join('');
}
