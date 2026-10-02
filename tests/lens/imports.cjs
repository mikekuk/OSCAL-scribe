const {
  test
} = require('node:test'), assert = require('node:assert/strict');
const ready = Promise.all([import('../../src/shared/lens/imports.mjs'), import('../../src/shared/lens/engine.mjs')]);
const cat = id => ({
  catalog: {
    controls: [{
      id,
      title: id
    }]
  }
});
const prof = href => ({
  profile: {
    imports: [{
      href,
      'include-all': {}
    }]
  }
});
const entry = (path, doc) => ({
  name: path.split('/').pop(),
  path,
  doc
});
test('NIST unresolved LOW profile selects its exact baseline through JSON resource link',
  async () => {
    const [, {
      preview
    }] = await ready;
    const profile = require('./fixtures/nist-low-profile.json'),
      catalog = require('./fixtures/nist-catalog-structure.json');
    const prefix = 'oscal-content/nist.gov/SP800-53/rev5/json/';
    const r = preview(profile, [entry(prefix + 'NIST_SP-800-53_rev5_LOW-baseline_profile.json',
      profile), entry(prefix + 'NIST_SP-800-53_rev5_catalog.json', catalog)]);
    assert.deepEqual(r.rows.map(r => r.control.id).sort(), profile.profile.imports[0][
      'include-controls'
    ][0]['with-ids'].slice().sort());
    assert.equal(r.rows.length, 149);
    assert.deepEqual(r.notes, []);
  });
test('relative imports distinguish identical filenames in different folders', async () => {
  const [, {
    preview
  }] = await ready, p = prof('../catalogs/catalog.json'), right = cat('right'), wrong = cat(
    'wrong');
  const docs = [entry('repo/profiles/profile.json', p), entry('repo/catalogs/catalog.json',
    right), entry('repo/archive/catalog.json', wrong)];
  assert.equal(preview(p, docs).rows[0].control.id, 'right');
  assert.throws(() => preview(p, [docs[0], docs[2]]), /Missing JSON import/);
});
test('chained profile imports resolve relative to each containing profile', async () => {
  const [, {
    preview
  }] = await ready, top = prof('../base/profile.json'), base = prof(
    '../catalog/catalog.json');
  const r = preview(top, [entry('repo/overlays/top.json', top), entry(
    'repo/base/profile.json', base), entry('repo/catalog/catalog.json', cat('ac-1'))]);
  assert.equal(r.rows[0].control.id, 'ac-1');
});
test('loose-file uploads allow unique basenames and reject ambiguity', async () => {
  const [, {
    preview
  }] = await ready, p = prof('../../catalogs/catalog.json'), c = cat('one');
  assert.equal(preview(p, [entry('profile.json', p), entry('catalog.json', c)]).rows.length,
    1);
  assert.throws(() => preview(p, [entry('profile.json', p), entry('a/catalog.json', c), entry(
    'b/catalog.json', cat('two'))]), /Ambiguous/);
});
test('resource alternatives choose available JSON, never the first XML link', async () => {
  const [{
    resolveImport
  }] = await ready;
  const body = {
    'back-matter': {
      resources: [{
        uuid: 'r',
        rlinks: [{
          href: 'catalog.xml',
          'media-type': 'application/oscal.catalog+xml'
        }, {
          href: 'missing.json'
        }, {
          href: 'catalog.json',
          'media-type': 'application/oscal.catalog+json'
        }]
      }]
    }
  };
  const target = entry('repo/catalog.json', cat('ok'));
  assert.equal(resolveImport(body, '#r', entry('repo/profile.json', {}), [target]), target);
  assert.throws(() => resolveImport({
    'back-matter': {
      resources: [{
        uuid: 'r',
        rlinks: [{
          href: 'catalog.xml'
        }]
      }]
    }
  }, '#r', entry('profile.json', {}), []), /no JSON link/);
  assert.throws(() => resolveImport({}, '#missing', entry('profile.json', {}), []),
    /Missing back-matter/);
});
test('encoded filenames and URL queries match the local file path', async () => {
  const [{
    resolveImport
  }] = await ready, target = entry('repo/catalog/my catalog.json', cat('ok'));
  assert.equal(resolveImport({}, '../catalog/my%20catalog.json?version=1', entry(
    'repo/profile/p.json', {}), [target]), target);
});
test('folder uploads keep same-named documents separate and skip non-OSCAL files', async () => {
  const [{
    readDocuments
  }] = await ready;
  const file = (path, content) => ({
    name: path.split('/').pop(),
    webkitRelativePath: path,
    size: content.length,
    text: async () => content
  });
  const result = await readDocuments([file('repo/a/catalog.json', JSON.stringify(cat('a'))),
    file('repo/b/catalog.json', JSON.stringify(cat('b'))), file('repo/package.json',
      '{}'), file('repo/catalog.xml', '<catalog/>'), file('repo/broken.json', '{')
  ], [], {
    folder: true
  });
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.documents.length, 2);
  const next = await readDocuments([file('repo/a/catalog.json', JSON.stringify(cat('new')))],
    result.documents, {
      folder: true
    });
  assert.equal(next.documents.length, 2);
  assert.equal(next.documents[0].doc.catalog.controls[0].id, 'new');
});
test('circular folder imports fail rather than recursing indefinitely', async () => {
  const [, {
    preview
  }] = await ready, a = prof('../b/b.json'), b = prof('../a/a.json');
  assert.throws(() => preview(a, [entry('repo/a/a.json', a), entry('repo/b/b.json', b)]),
    /Circular/);
});
