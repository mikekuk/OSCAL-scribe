const { test } = require('node:test');
const assert = require('node:assert/strict');
const ready = Promise.all([import('../../src/shared/lens/parameters.mjs'), import('../../src/shared/lens/engine.mjs'), import('../../src/shared/lens/views.mjs')]);
const insert = id => `{{ insert: param, ${id} }}`;

test('parameter states preserve assignments, constraints, selections and guidelines', async () => {
  const [{ describeParameter, substituteParameters }] = await ready;
  const scope = {
    value: { values: ['15 minutes'] },
    constraint: { label: 'frequency', constraints: [{ description: 'at least every 3 years' }] },
    selection: { select: { 'how-many': 'one-or-more', choice: ['organisation-level', 'system-level'] } },
    open: { label: 'frequency', guidelines: [{ prose: 'Consider annually' }] },
    both: { values: ['12 months'], constraints: [{ description: 'no more than 3 years' }] },
    tests: { constraints: [{ tests: [{ expression: 'value < 3', remarks: 'years' }] }] }
  };
  assert.deepEqual(describeParameter('value', scope), { state: 'filled', text: '15 minutes' });
  assert.deepEqual(describeParameter('constraint', scope), { state: 'constrained', text: '[CONSTRAINT: at least every 3 years]' });
  assert.equal(substituteParameters(insert('selection'), scope), '[SELECT (one or more): organisation-level / system-level]');
  assert.deepEqual(describeParameter('open', scope), { state: 'open', text: '[ODP: frequency]' });
  assert.equal(substituteParameters(insert('both'), scope), '12 months');
  assert.equal(substituteParameters(insert('tests'), scope), '[CONSTRAINT: Test: value < 3; years]');
});

test('constraints take precedence over selection and aggregates; nesting and cycles stay safe', async () => {
  const [{ describeParameter, substituteParameters }] = await ready;
  const scope = {
    p: { constraints: [{ description: 'At least ' + insert('v') }, { description: 'Approved' }], select: { choice: ['other'] } },
    v: { values: ['3 years'] },
    aggregate: { props: [{ name: 'aggregates', value: 'p' }] },
    cycle: { constraints: [{ description: insert('cycle') }] }
  };
  assert.equal(substituteParameters(insert('aggregate'), scope), '[CONSTRAINT: At least 3 years; Approved]');
  assert.equal(describeParameter('aggregate', scope).state, 'constrained');
  assert.match(substituteParameters(insert('cycle'), scope), /Circular parameter/);
  scope.aggregate.constraints = [{ description: 'Own restriction' }];
  assert.equal(substituteParameters(insert('aggregate'), scope), '[CONSTRAINT: Own restriction]');
});

function catalogue() {
  return { catalog: {
    metadata: { title: 'Resolved baseline', links: [{ rel: 'resolution-source', href: 'missing-profile.json' }] },
    params: [{ id: 'p', label: 'frequency', constraints: [{ description: 'at least every 3 years' }] }],
    groups: [{ id: 'ac', title: 'Access control', params: [{ id: 'role', select: { choice: ['Owner', 'Manager'] } }], controls: [{
      id: 'ac-1', title: 'Policy', params: [{ id: 'aggregate', props: [{ name: 'aggregates', value: 'p' }] }],
      parts: [{ id: 'ac-1_smt', name: 'statement', parts: [{ id: 'ac-1_smt.c.1', name: 'item', prose: 'Review ' + insert('aggregate') + ' by ' + insert('role') }] }]
    }] }]
  } };
}

test('standalone resolved catalogue uses inherited constraints and reports transitive statement uses', async () => {
  const [, { preview }, { renderControls, renderDocuments, renderHeading }] = await ready;
  const doc = catalogue(), before = JSON.stringify(doc), result = preview(doc, []);
  const html = renderControls('catalog', result, null, 0, '', '', { parameters: true });
  assert.match(html, /\[CONSTRAINT: at least every 3 years\]/);
  assert.match(html, /Constrained, not assigned/);
  assert.match(html, /Used in<\/dt><dd>ac-1_smt.c.1/);
  assert.match(html, /Definition in supplied document/);
  assert.doesNotMatch(html, /Catalogue definition|Selection preview/);
  assert.match(renderDocuments([{ name: 'resolved.json', doc }], 0), /resolved profile \(catalogue\)/);
  assert.match(renderHeading({ name: 'resolved.json' }, 'catalog', doc.catalog, result, []), /RESOLVED PROFILE/);
  assert.equal(JSON.stringify(doc), before);
  assert.doesNotMatch(renderControls('catalog', result, null, 0, '', ''), /<h4>Parameters<\/h4>/);
});

test('profile overlay keeps value and constraint details, escapes input and retains provenance', async () => {
  const [, { preview }, { renderControls }] = await ready;
  const doc = catalogue();
  const profile = { profile: { imports: [{ href: 'c.json', 'include-all': {} }], modify: {
    'set-parameters': [{ 'param-id': 'p', values: ['12 months'], constraints: [{ description: '<script>limit</script> "quoted"' }], guidelines: [{ prose: 'Annual review suggested' }] }],
    alters: [{ 'control-id': 'ac-1', adds: [{ parts: [{ name: 'local', prose: 'Direct ' + insert('p') }] }] }]
  } } };
  const before = JSON.stringify(doc), result = preview(profile, [{ name: 'c.json', doc }]);
  const html = renderControls('profile', result, null, 0, '', '', { parameters: true });
  assert.match(html, /title="Filled — explicit value. Constraint: &lt;script&gt;limit/);
  assert.match(html, /class="odp odp-filled"/);
  assert.match(html, /class="profile-change"[^>]*>12 months/);
  assert.match(html, /Catalogue definition<\/dt><dd>frequency/);
  assert.match(html, /Annual review suggested/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(doc.catalog.params[0].values, undefined);
});

test('constraint-only set-parameter remains unassigned through nested profile imports', async () => {
  const [{ describeParameter }, { preview }, { renderControls }] = await ready;
  const catalogue = { catalog: { controls: [{ id: 'ac-1', title: 'Policy', params: [{ id: 'p', label: 'frequency' }], parts: [{ id: 's', name: 'statement', prose: insert('p') }] }] } };
  const inner = { profile: { imports: [{ href: 'c.json', 'include-all': {} }], modify: {
    'set-parameters': [{ 'param-id': 'p', constraints: [{ description: 'at least every 3 years' }] }]
  } } };
  const outer = { profile: { imports: [{ href: 'inner.json', 'include-all': {} }] } };
  const result = preview(outer, [{ name: 'c.json', doc: catalogue }, { name: 'inner.json', doc: inner }]);
  assert.equal(describeParameter('p', result.rows[0].parameters).state, 'constrained');
  assert.equal(result.rows[0].parameters.p.values, undefined);
  assert.match(renderControls('profile', result, null, 0, '', ''), /class="odp odp-constrained"[^>]*><span class="profile-change"/);
  assert.equal(catalogue.catalog.controls[0].params[0].constraints, undefined);
});
