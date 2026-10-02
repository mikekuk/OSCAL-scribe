const {
  test
} = require('node:test'), assert = require('node:assert/strict'), Ajv = require('ajv');
const ready = import('../../src/shared/lens/engine.mjs');
const meta = {
  title: 'Test',
  'last-modified': '2026-09-08T00:00:00Z',
  version: '1',
  'oscal-version': '1.0.4'
};
const catalog = {
  catalog: {
    uuid: '1562cb25-7d8d-4bf4-b391-a7a31e6f1261',
    metadata: meta,
    groups: [{
      id: 'g',
      title: 'Group',
      controls: [{
        id: 'ac-1',
        title: 'One',
        params: [{
          id: 'p',
          values: ['old']
        }]
      }, {
        id: 'ac-2',
        title: 'Two',
        controls: [{
          id: 'ac-2.1',
          title: 'Child'
        }]
      }]
    }]
  }
};

function profile(imp) {
  return {
    profile: {
      uuid: 'a3350bd9-5d93-4c5b-9e5b-304fd5f2b93a',
      metadata: meta,
      imports: [{
        href: 'cat.json',
        ...imp
      }]
    }
  }
}
test('NIST schemas validate catalogue and profile and reject missing metadata', async () => {
  const {
    makeValidator
  } = await ready;
  const validate = makeValidator(Ajv, {
    'catalog@1.0.4': require('./schemas/1.0.4/oscal_catalog_schema.json'),
    'profile@1.0.4': require('./schemas/1.0.4/oscal_profile_schema.json')
  });
  assert.deepEqual(validate(catalog), []);
  assert.deepEqual(validate(profile({
    'include-all': {}
  })), []);
  assert.ok(validate({
    catalog: {
      uuid: 'bad'
    }
  }).some(i => i.severity === 'error'));
  assert.ok(validate({
    catalog: {
      ...catalog.catalog,
      metadata: {
        ...meta,
        'oscal-version': '1.2.3'
      }
    }
  }).some(i => i.severity === 'warning'))
});
test('selection includes children only when requested and excludes matches', async () => {
  const {
    preview
  } = await ready;
  const p = profile({
    'include-controls': [{
      'with-ids': ['ac-2'],
      'with-child-controls': 'yes'
    }],
    'exclude-controls': [{
      'with-ids': ['ac-2.1']
    }]
  });
  assert.deepEqual(preview(p, [{
    name: 'cat.json',
    doc: catalog
  }]).rows.map(r => r.control.id), ['ac-2']);
  const p2 = profile({
    'include-controls': [{
      'with-ids': ['ac-2']
    }]
  });
  assert.equal(preview(p2, [{
    name: 'cat.json',
    doc: catalog
  }]).rows.length, 1)
});
test('wildcards, nested groups and parameter tailoring preserve original', async () => {
  const {
    preview
  } = await ready;
  const p = profile({
    'include-controls': [{
      matching: [{
        pattern: 'ac-*'
      }]
    }]
  });
  p.profile.modify = {
    'set-parameters': [{
      'param-id': 'p',
      values: ['new']
    }]
  };
  const r = preview(p, [{
    name: 'cat.json',
    doc: catalog
  }]);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].groups[0].id, 'g');
  assert.deepEqual(r.rows[0].control.params[0].values, ['new']);
  assert.deepEqual(catalog.catalog.groups[0].controls[0].params[0].values, ['old'])
});
test('missing imports, unknown IDs and cycles fail explicitly', async () => {
  const {
    preview
  } = await ready;
  assert.throws(() => preview(profile({
    'include-all': {}
  }), []), /Missing JSON import/);
  assert.throws(() => preview(profile({
    'include-controls': [{
      'with-ids': ['missing']
    }]
  }), [{
    name: 'cat.json',
    doc: catalog
  }]), /Unknown/);
  const p = profile({
    'include-all': {}
  });
  assert.throws(() => preview(p, [{
    name: 'cat.json',
    doc: p
  }]), /Circular/)
});
test('unsupported merge directives still produce notices after alterations', async () => {
  const {
    preview
  } = await ready;
  const p = profile({
    'include-all': {}
  });
  p.profile.modify = {
    alters: [{
      'control-id': 'ac-1'
    }]
  };
  p.profile.merge = {
    custom: {}
  };
  assert.equal(preview(p, [{
    name: 'cat.json',
    doc: catalog
  }]).notes.length, 1)
});
