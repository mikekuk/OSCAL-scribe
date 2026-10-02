const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const ready = Promise.all([import('../../src/shared/lens/engine.mjs'), import('../../src/shared/lens/views.mjs'), import(
  '../../src/shared/lens/parameters.mjs')]);

function fixture(alters, settings = []) {
  const catalog = {
    catalog: {
      controls: [{
        id: 'c',
        title: 'Control',
        params: [{
          id: 'p',
          values: ['old']
        }],
        parts: [{
          id: 's',
          name: 'statement',
          parts: [{
              id: 'a',
              name: 'item',
              prose: 'First',
              props: [{
                name: 'label',
                value: 'a.'
              }]
            },
            {
              id: 'b',
              name: 'item',
              prose: 'Second'
            }
          ]
        }, {
          id: 'g',
          name: 'guidance',
          prose: 'Existing guidance',
          props: [{
            name: 'keep',
            class: 'x',
            ns: 'urn:one',
            value: 'yes'
          }]
        }],
        controls: [{
          id: 'child',
          title: 'Child',
          parts: [{
            id: 'cs',
            name: 'statement',
            prose: 'Child statement'
          }]
        }]
      }]
    }
  };
  const profile = {
    profile: {
      imports: [{
        href: 'catalog.json',
        'include-all': {}
      }],
      modify: {
        alters,
        'set-parameters': settings
      }
    }
  };
  return {
    catalog,
    profile,
    documents: [{
      name: 'catalog.json',
      doc: catalog
    }]
  };
}

test('profile adds create visible custom sections with inline ODP values', async () => {
  const [{
    preview
  }, {
    renderControls,
    renderSectionOptions
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    adds: [{
      parts: [{
        name: 'implementation-guidance',
        title: 'Local instructions',
        prose: 'Review {{ insert: param, new-p }}.'
      }],
      params: [{
        id: 'new-p',
        label: 'frequency'
      }]
    }]
  }], [{
    'param-id': 'new-p',
    values: ['weekly']
  }]);
  const result = preview(input.profile, input.documents);
  const html = renderControls('profile', result, null, 0, '', '');
  assert.ok(html.includes('Local instructions'));
  assert.ok(html.replace(/<[^>]*>/g, '').includes('Review weekly.'));
  assert.ok(renderSectionOptions(result.rows, {}).includes(
    'data-section="implementation-guidance" checked'));
  assert.equal(input.catalog.catalog.controls[0].parts.length, 2);
});

test('removes combine all selectors and preserve non-matching contents', async () => {
  const [{
    preview
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    removes: [{
        'by-item-name': 'prop',
        'by-name': 'keep',
        'by-class': 'x',
        'by-ns': 'urn:wrong'
      },
      {
        'by-item-name': 'part',
        'by-id': 'a',
        'by-name': 'item'
      }
    ]
  }]);
  const control = preview(input.profile, input.documents).rows[0].control;
  assert.equal(control.parts[1].props[0].name, 'keep');
  assert.deepEqual(control.parts[0].parts.map(p => p.id), ['b']);
  input.profile.profile.modify.alters[0].removes[0]['by-ns'] = 'urn:one';
  assert.equal(preview(input.profile, input.documents).rows[0].control.parts[1].props, undefined);
});

test('before/after and starting/ending preserve part order and replace removed sections', async () => {
  const [{
    preview
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    removes: [{
      'by-id': 'g'
    }],
    adds: [{
        'by-id': 'b',
        position: 'before',
        parts: [{
          id: 'before',
          name: 'item',
          prose: 'Before'
        }]
      },
      {
        'by-id': 'b',
        position: 'after',
        parts: [{
          id: 'after',
          name: 'item',
          prose: 'After'
        }]
      },
      {
        'by-id': 's',
        position: 'starting',
        parts: [{
          id: 'start',
          name: 'item',
          prose: 'Start'
        }]
      },
      {
        'by-id': 's',
        position: 'ending',
        parts: [{
          id: 'end',
          name: 'item',
          prose: 'End'
        }]
      },
      {
        position: 'ending',
        parts: [{
          id: 'g',
          name: 'guidance',
          prose: 'Replacement'
        }]
      }
    ]
  }]);
  const control = preview(input.profile, input.documents).rows[0].control;
  assert.deepEqual(control.parts[0].parts.map(p => p.id), ['start', 'a', 'before', 'b', 'after',
  'end']);
  assert.equal(control.parts[1].prose, 'Replacement');
});

test('parent alterations affect selected child rows and can remove children', async () => {
  const [{
    preview
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    adds: [{
      'by-id': 'child',
      parts: [{
        name: 'local-note',
        prose: 'Added through parent'
      }]
    }]
  }]);
  assert.equal(preview(input.profile, input.documents).rows[1].control.parts[1].prose,
    'Added through parent');
  input.profile.profile.modify.alters.push({
    'control-id': 'c',
    removes: [{
      'by-item-name': 'control',
      'by-id': 'child'
    }]
  });
  assert.deepEqual(preview(input.profile, input.documents).rows.map(r => r.control.id), ['c']);
});

test('removed parameters leave no stale ODP values in descendants', async () => {
  const [{
    preview
  }, , {
    substituteParameters
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    removes: [{
      'by-item-name': 'param',
      'by-id': 'p'
    }]
  }]);
  const result = preview(input.profile, input.documents);
  for (const row of result.rows) assert.equal(substituteParameters('{{ insert: param, p }}', row
    .parameters), '[Undefined parameter: p]');
});

test('outer profiles can alter sections added by inner profiles', async () => {
  const [{
    preview
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    adds: [{
      parts: [{
        id: 'local',
        name: 'local-note',
        prose: 'Inner'
      }]
    }]
  }]);
  const overlay = {
    profile: {
      imports: [{
        href: 'inner.json',
        'include-all': {}
      }],
      modify: {
        alters: [{
          'control-id': 'c',
          removes: [{
            'by-id': 'local'
          }],
          adds: [{
            title: 'Renamed',
            parts: [{
              name: 'local-note',
              prose: 'Outer'
            }]
          }]
        }]
      }
    }
  };
  const result = preview(overlay, [...input.documents, {
    name: 'inner.json',
    doc: input.profile
  }]);
  assert.equal(result.rows[0].control.title, 'Renamed');
  assert.equal(result.rows[0].control.parts.at(-1).prose, 'Outer');
});

test('missing targets warn and unknown selectors never remove arbitrary content', async () => {
  const [{
    preview
  }] = await ready;
  const input = fixture([{
    'control-id': 'c',
    adds: [{
      'by-id': 'missing',
      parts: [{
        name: 'note',
        prose: 'Not inserted'
      }]
    }]
  }]);
  const result = preview(input.profile, input.documents);
  assert.ok(result.notes.some(note => note.includes('missing target')));
  assert.equal(result.rows[0].control.parts.length, 2);
  input.profile.profile.modify.alters = [{
    'control-id': 'c',
    removes: [{
      bogus: 'x'
    }]
  }];
  assert.throws(() => preview(input.profile, input.documents), /Unsupported removal selector/);
});
