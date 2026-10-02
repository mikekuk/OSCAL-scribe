const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const ready = Promise.all([
  import('../../src/shared/lens/engine.mjs'), import('../../src/shared/lens/parameters.mjs'), import('../../src/shared/lens/views.mjs')
]);

test('real SI-3 displays nested ODP prompts and labelled flowing statements', async () => {
  const [{
    preview
  }, , {
    renderControls
  }] = await ready;
  const control = require('./fixtures/nist-si-3.json');
  const result = preview({
    catalog: {
      controls: [control]
    }
  }, []);
  const html = renderControls('catalog', result, null, 0, '', '');
  assert.ok(html.includes('[SELECT (one or more): signature-based / non-signature-based]'));
  assert.ok(html.replace(/<[^>]*>/g, '').includes('take [ODP: action]'));
  for (const label of ['a.', 'b.', 'c.', '1.', '2.', 'd.']) {
    assert.ok(html.includes('class="item-label">' + label + '</strong>'));
  }
  assert.ok(!html.includes('{{ insert:'));
  assert.ok(!html.includes('<h4>Parameters</h4>'));
  assert.ok(!html.includes('assessment objective'));
  assert.ok(!html.includes('si-3_smt.a'));
  assert.ok(!html.includes('<dt>props</dt>'));
});

test('profile values replace inherited parameters and outer overlays win', async () => {
  const [{
    preview
  }, {
    substituteParameters
  }] = await ready;
  const catalogue = {
    catalog: {
      params: [{
        id: 'frequency',
        label: 'frequency'
      }],
      groups: [{
        params: [{
          id: 'role',
          label: 'role'
        }],
        controls: [{
          id: 'c',
          title: 'C',
          parts: [{
            name: 'statement',
            prose: '{{ insert: param, frequency }} by {{ insert: param, role }}'
          }]
        }]
      }]
    }
  };
  const base = {
    profile: {
      imports: [{
        href: 'cat.json',
        'include-all': {}
      }],
      modify: {
        'set-parameters': [{
          'param-id': 'frequency',
          values: ['weekly']
        }, {
          'param-id': 'role',
          values: ['owner']
        }]
      }
    }
  };
  const overlay = {
    profile: {
      imports: [{
        href: 'base.json',
        'include-all': {}
      }],
      modify: {
        'set-parameters': [{
          'param-id': 'frequency',
          values: ['daily']
        }]
      }
    }
  };
  const documents = [{
    name: 'cat.json',
    doc: catalogue
  }, {
    name: 'base.json',
    doc: base
  }];
  const row = preview(overlay, documents).rows[0];
  assert.equal(substituteParameters(row.control.parts[0].prose, row.parameters), 'daily by owner');
  assert.equal(catalogue.catalog.params[0].values, undefined);
  assert.equal(base.profile.modify['set-parameters'][0].values[0], 'weekly');
});

test('undefined and circular parameter references become explicit readable prompts', async () => {
  const [, {
    substituteParameters
  }] = await ready;
  assert.equal(substituteParameters('{{ insert: param, missing }}'), '[Undefined parameter: missing]');
  const scope = {
    a: {
      values: ['{{ insert: param, b }}']
    },
    b: {
      values: ['{{ insert: param, a }}']
    }
  };
  assert.equal(substituteParameters('{{ insert: param, a }}', scope), '[Circular parameter: a]');
});

test('assessment section toggles reveal their nested content and hide statements', async () => {
  const [{
    preview
  }, , {
    renderControls,
    renderSectionOptions
  }] = await ready;
  const result = preview({
    catalog: {
      controls: [{
        id: 'c',
        title: 'C',
        parts: [{
            name: 'statement',
            prose: 'Statement text'
          },
          {
            name: 'assessment-method',
            parts: [{
              name: 'assessment-objects',
              title: 'Evidence <review>',
              prose: 'Interview evidence',
              parts: [{name:'detail',title:'Follow-up',prose:'Nested evidence'}]
            }]
          }
        ]
      }]
    }
  }, []);
  assert.ok(!renderControls('catalog', result, null, 0, '', '').includes('Interview evidence'));
  const settings = {
    statement: false,
    'assessment-method': true
  };
  const html = renderControls('catalog', result, null, 0, '', '', settings);
  assert.ok(html.includes('Interview evidence'));
  assert.match(html, /<h5 class="subsection-title">Evidence &lt;review&gt;<\/h5>/);
  assert.match(html, /<h6 class="subsection-title">Follow-up<\/h6>/);
  assert.match(html, /class="statement-subsection"/);
  assert.doesNotMatch(renderSectionOptions(result.rows, settings), /data-section="(?:assessment-objects|detail)"/);
  assert.doesNotMatch(renderControls('catalog', result, null, 0, '', '', {'assessment-method':false}), /Nested evidence|Evidence &lt;review&gt;/);
  assert.ok(!html.includes('Statement text'));
  assert.ok(renderSectionOptions(result.rows, settings).includes(
    'data-section="assessment-method" checked'));
});

test('ODP values are escaped as text and are searchable after substitution', async () => {
  const [{
    preview
  }, , {
    renderControls
  }] = await ready;
  const result = preview({
    catalog: {
      controls: [{
        id: 'c',
        title: 'C',
        params: [{
          id: 'p',
          values: ['<script>alert(1)</script>']
        }],
        parts: [{
          name: 'statement',
          prose: 'Use {{ insert: param, p }}.'
        }]
      }]
    }
  }, []);
  const html = renderControls('catalog', result, null, 0, '', 'alert');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('1 control'));
});
test('workspace model groups preserve original selection and removal indices',async()=>{
  const {renderDocuments}=await import('../../src/shared/lens/views.mjs');
  const docs=[{name:'p.json',doc:{profile:{}}},{name:'a.json',doc:{catalog:{}}},{name:'q.json',doc:{profile:{metadata:{title:'<unsafe>'}}}}];
  const html=renderDocuments(docs,2,false,new Set(['profile']));
  assert.match(html,/data-model-group="profile">/);
  assert.match(html,/Profiles \(2\)/);
  assert.match(html,/data-model-group="catalog" open/);
  assert.match(html,/class="doc active" data-doc="2"/);
  assert.match(html,/data-remove-doc="2"/);
  assert.match(html,/&lt;unsafe&gt;/);
  assert.equal(renderDocuments([],0),'');
});
