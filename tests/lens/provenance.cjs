const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=Promise.all([import('../../src/shared/lens/engine.mjs'),import('../../src/shared/lens/views.mjs')]);
test('profile colours only changed prose and ODPs including aggregate dependencies',async()=>{
  const [{preview},{renderControls}]=await ready;
  const catalog={catalog:{controls:[{id:'c',title:'Original',params:[{id:'p',values:['yearly']},{id:'aggregate',props:[{name:'aggregates',value:'p'}]}],parts:[{id:'s',name:'statement',prose:'Review {{ insert: param, aggregate }}.'},{id:'old',name:'guidance',prose:'To remove'}]}]}};
  const profile={profile:{imports:[{href:'c.json','include-all':{}}],modify:{'set-parameters':[{'param-id':'p',values:['daily']}],alters:[{'control-id':'c',removes:[{'by-id':'old'}],adds:[{parts:[{id:'new',name:'guidance',prose:'Added <script>text</script>'}]}]}]}}};
  const before=JSON.stringify(catalog),result=preview(profile,[{name:'c.json',doc:catalog}]);
  const html=renderControls('profile',result,null,0,'','');
  assert.match(html,/Review <span class="odp odp-derived"[^>]*><span class="profile-change"[^>]*>daily<\/span><\/span>\./);
  assert.match(html,/<span class="profile-change"[^>]*>Added &lt;script&gt;text/);
  assert.match(html,/Profile removals \(1\)/);assert.match(html,/To remove/);
  assert.equal(JSON.stringify(catalog),before);
  assert.ok(!renderControls('catalog',preview(catalog,[]),null,0,'','').includes('class="profile-change"'));
});
test('nested profiles retain catalogue origin and mark changed titles',async()=>{
  const [{preview},{renderControls}]=await ready;
  const docs=[{name:'c.json',doc:{catalog:{controls:[{id:'c',title:'Old',parts:[{id:'s',name:'statement',prose:'Original'}]}]}}},{name:'inner.json',doc:{profile:{imports:[{href:'c.json','include-all':{}}],modify:{alters:[{'control-id':'c',adds:[{title:'New'}]}]}}}}];
  const outer={profile:{imports:[{href:'inner.json','include-all':{}}]}};
  const result=preview(outer,docs);assert.equal(result.rows[0].baseControl.title,'Old');
  assert.match(renderControls('profile',result,null,0,'',''),/<span class="profile-change"[^>]*>New<\/span>/);
});
