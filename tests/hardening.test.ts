import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestLimiter, runtimePolicy, requestLimit, boundedResponse, safePolicy} from '../src/api/security';
import {Service, ApiError} from '../src/api/service';
import {MemoryRepository} from '../src/api/memory';
import type {User, Ssp} from '../src/shared/types';
const user: User = {oid:'11111111-1111-4111-8111-111111111111',tid:'22222222-2222-4222-8222-222222222222',roles:['User']};
const admin: User = {...user,roles:['AppAdmin']};
test('runtime policy fails closed and refuses misspelled settings',()=>{
  assert.deepEqual(runtimePolicy({}),safePolicy);
  assert.throws(()=>runtimePolicy({SCRIBE_ALLOW_RAW_BROWSER:'yes'}));
  assert.deepEqual(runtimePolicy({SCRIBE_ALLOW_RAW_BROWSER:'true'}),{rawBrowser:true,permanentDelete:false});
});
test('admin role alone cannot enable raw access or destructive operations',async()=>{
  const repo = new MemoryRepository();
  const service = new Service(repo, {} as any, {} as any);
  for(const [method,path] of [['POST','/api/admin/raw'],['GET','/api/admin/partitions'],['DELETE','/api/admin/ssps/unknown'],['DELETE','/api/admin/library/unknown']])
    await assert.rejects(service.request(admin,method,path,{}), (e:any)=>e instanceof ApiError && e.status===403);
});
test('request limits are scoped to tenant/user, include expensive calls, expire, and bound memory',()=>{
  let now=0;const limiter=new RequestLimiter(10,2,()=>now,2);
  limiter.check(user,'POST','/api/ssps');limiter.check(user,'POST','/api/ssps');
  assert.throws(()=>limiter.check(user,'POST','/api/ssps'),(e:any)=>e.status===429);
  limiter.check({...user,tid:'other'},'GET','/api/ssps');
  assert.throws(()=>limiter.check({...user,oid:'third'},'GET','/api/ssps'),(e:any)=>e.status===429);
  now=60_001;limiter.check(user,'POST','/api/ssps');
});
test('only an exact admin library upload gets the larger body allowance',()=>{
  assert.equal(requestLimit(admin,'POST','/api/admin/library'),20_001_000);
  for (const [u,m,p] of [[user,'POST','/api/admin/library'],[admin,'PUT','/api/admin/library'],[admin,'POST','/api/ssps'],[admin,'POST','/api/admin/library/anything']] as const) assert.equal(requestLimit(u,m,p),1_000_000);
  assert.equal(boundedResponse({ok:true}),'{"ok":true}');
});
test('plan and history pages bound results without leaking documents or other users',async()=>{
  const repo=new MemoryRepository();
  for(let i=0;i<61;i++)repo.current.set(String(i),{id:'current',sspId:String(i),tenantId:user.tid,ownerId:i===60?'someone-else':user.oid,access:[],oscal:{'system-security-plan':{metadata:{title:'Plan'},'system-characteristics':{'system-name':'System'}}}} as unknown as Ssp);
  const service=new Service(repo,{} as any);
  const first=await service.request(user,'GET','/api/ssps');
  const second=await service.request(user,'GET','/api/ssps?cursor='+first.cursor);
  const third=await service.request(user,'GET','/api/ssps?cursor='+second.cursor);
  assert.deepEqual([first.items.length,second.items.length,third.items.length],[25,25,10]);
  assert.equal(third.cursor,undefined);assert.ok(first.items.every((x:any)=>!('oscal' in x)));
  assert.equal(new Set([...first.items,...second.items,...third.items].map(x=>x.sspId)).size,60);
  repo.history.set('0',Array.from({length:30},(_,i)=>({id:'revision:'+(i+1),revision:i+1,oscal:{sensitive:true}})));
  const history=await service.request(user,'GET','/api/ssps/0/revisions');assert.equal(history.items.length,25);assert.ok(history.items.every((x:any)=>!('oscal' in x)));
  assert.deepEqual((await service.request(user,'GET','/api/ssps/0/revisions/1')).oscal,{sensitive:true});
  await assert.rejects(service.request({...user,oid:'someone-else'},'GET','/api/ssps/0/revisions/1'),(e:any)=>e.status===404);
  await assert.rejects(service.request(user,'GET','/api/ssps?cursor='+'x'.repeat(16001)),(e:any)=>e.status===400);
});
