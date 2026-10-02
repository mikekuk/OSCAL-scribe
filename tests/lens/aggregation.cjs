const { test } = require('node:test');
const assert = require('node:assert/strict');
const ready = Promise.all([
  import('../../src/shared/lens/engine.mjs'), import('../../src/shared/lens/parameters.mjs'), import('../../src/shared/lens/views.mjs')
]);
const aggregate = (...ids) => ({ props: ids.map(value => ({
  name: 'aggregates', ns: 'http://csrc.nist.gov/ns/rmf', value
})) });

test('real NIST AC-1 aggregate renders profile ODP values inline', async () => {
  const [{ preview }, { substituteParameters }, { renderControls }] = await ready;
  const control = require('./fixtures/nist-ac-1-aggregate.json');
  const catalog = { catalog: { controls: [control] } };
  const profile = { profile: {
    imports: [{ href: 'catalog.json', 'include-all': {} }],
    modify: { 'set-parameters': [
      { 'param-id': 'ac-01_odp.01', values: ['Policy owners'] },
      { 'param-id': 'ac-01_odp.02', values: ['System administrators'] }
    ] }
  } };
  const result = preview(profile, [{ name: 'catalog.json', doc: catalog }]);
  const row = result.rows[0];
  assert.equal(substituteParameters('{{ insert: param, ac-1_prm_1 }}', row.parameters),
    'Policy owners; System administrators');
  const html = renderControls('profile', result, null, 0, '', '');
  assert.ok(html.includes('Policy owners; System administrators'));
  assert.equal(control.params.find(parameter => parameter.id === 'ac-01_odp.01').values, undefined);
});

test('nested aggregates resolve multiple values and preserve explicit overrides', async () => {
  const [, { substituteParameters }] = await ready;
  const scope = {
    outer: aggregate('inner', 'third'), inner: aggregate('first', 'second'),
    first: { values: ['A', 'B'] }, second: { values: ['C'] }, third: { values: ['D'] }
  };
  assert.equal(substituteParameters('{{ insert: param, outer }}', scope), 'A; B; C; D');
  scope.inner.values = ['Explicit override'];
  assert.equal(substituteParameters('{{ insert: param, outer }}', scope), 'Explicit override; D');
});

test('partial aggregates retain prompts, missing references and cycle notices', async () => {
  const [, { substituteParameters }] = await ready;
  const scope = { all: aggregate('defined', 'unset', 'missing'),
    defined: { values: ['Owner'] }, unset: { label: 'frequency' },
    a: aggregate('b'), b: { values: ['{{ insert: param, a }}'] } };
  assert.equal(substituteParameters('{{ insert: param, all }}', scope),
    'Owner; [ODP: frequency]; [Undefined parameter: missing]');
  assert.equal(substituteParameters('{{ insert: param, a }}', scope), '[Circular parameter: a]');
});

test('aggregate output remains escaped and non-RMF properties are not interpreted', async () => {
  const [{ preview }, { substituteParameters }, { renderControls }] = await ready;
  const catalog = { catalog: { controls: [{ id: 'c', title: 'C',
    params: [{ id: 'all', ...aggregate('odp') }, { id: 'odp', values: ['<script>alert(1)</script>'] }],
    parts: [{ name: 'statement', prose: '{{ insert: param, all }}' }] }] } };
  const html = renderControls('catalog', preview(catalog, []), null, 0, '', '');
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.equal(substituteParameters('{{ insert: param, p }}', {
    p: { label: 'role', props: [{ name: 'aggregates', ns: 'urn:unrelated', value: 'other' }] }
  }), '[ODP: role]');
});
