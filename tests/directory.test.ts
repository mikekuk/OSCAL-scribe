import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDirectory, type Directory } from "../src/api/directory";
import { Service } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
import { personLabel } from "../src/web/people-picker";
import type { Person, User } from "../src/shared/types";
const tenant = "33333333-3333-4333-8333-333333333333", owner: User = { oid: "11111111-1111-4111-8111-111111111111", tid: tenant, roles: ["User"], displayName: "Saved owner" }, guest = "22222222-2222-4222-8222-222222222222";
const release: any = { id: "test", profiles: [{ id: "low", resolved: { catalog: { controls: [{ id: "ac-1", title: "Policy", parts: [{ id: "ac-1_smt", name: "statement", prose: "Maintain policy." }] }] } } }], components: [], sources: [] };
async function fixture() {
  const people = new Map<string, Person>([[owner.oid, { oid: owner.oid, displayName: "Original name", email: "owner@example.test" }], [guest, { oid: guest, displayName: "Guest person", userPrincipalName: "guest_example.test#EXT#@tenant.test", guest: true }]]);
  let down = false;
  const directory: Directory = { search: async () => { if (down) throw Error("offline"); return [...people.values()]; }, lookup: async (_, id) => { if (down) throw Error("offline"); return people.get(id); } };
  const repo = new MemoryRepository(), service = new Service(repo, { active: async () => release, get: async () => release }, undefined, directory);
  const plan = await service.request(owner, "POST", "ssps", { releaseId: "test", profileId: "low", systemName: "Directory test" });
  return { people, repo, service, plan, path: "ssps/" + plan.sspId, outage: () => { down = true; } };
}
const denied = (value: Promise<any>, status: number) => assert.rejects(value, (e: any) => e.status === status);

test("sharing search and ID resolution are scoped to authorized plan participants", async () => {
  const {service,plan,path} = await fixture();
  await denied(service.request({...owner,tid:"other"},"POST",path+"/people",{query:"Gue"}),404);
  await denied(service.request({...owner,oid:guest},"POST",path+"/people",{query:"Gue"}),404);
  const shared = await service.request(owner,"POST",path+"/share",{oid:guest,permission:"edit"},String(plan.version));
  await denied(service.request({...owner,oid:guest},"POST",path+"/people",{query:"Gue"}),403);
  await denied(service.request(owner,"POST",path+"/identities",{ids:["unrelated"]}),403);
  await denied(service.request(owner,"POST",path+"/identities",{ids:Array(101).fill(owner.oid)}),400);
  const resolved = await service.request({...owner,oid:guest},"POST",path+"/identities",{ids:[owner.oid,guest]});
  assert.equal(resolved.people.length,2);
  assert.equal(shared.access[0].oid,guest);
});
test("saved actor names stay immutable after rename; old IDs resolve without rewriting history",async()=>{
  const {service,repo,path,plan,people} = await fixture();
  people.set(owner.oid,{oid:owner.oid,displayName:"Renamed person"});
  const saved = await service.request(owner,"PUT",path,{oscal:plan.oscal},String(plan.version));
  const history = (await service.request(owner,"GET",path+"/revisions")).items;
  assert.equal(history[0].actorIdentity.displayName,"Original name");
  assert.equal(history[1].actorIdentity.displayName,"Renamed person");
  assert.equal(history[1].actor,owner.oid);
  assert.equal(saved.currentRevision,2);
  // Simulate an immutable revision written before identity snapshots existed.
  delete repo.history.get(plan.sspId)!.find(r => r.id === "revision:1")!.actorIdentity;
  const before = JSON.stringify(await repo.records(plan.sspId,"revision:"));
  const labels = await service.request(owner,"POST",path+"/identities",{ids:[owner.oid]});
  assert.equal(labels.people[0].displayName,"Renamed person");
  assert.equal(JSON.stringify(await repo.records(plan.sspId,"revision:")),before);
});
test("deleted people cannot receive new shares; revocation and saving survive directory failure",async()=>{
  const {service,path,plan,people,outage} = await fixture();
  const shared = await service.request(owner,"POST",path+"/share",{oid:guest,permission:"read"},String(plan.version));
  people.delete(guest);
  await denied(service.request(owner,"POST",path+"/share",{oid:guest,permission:"edit"},String(shared.version)),400);
  outage();
  const revoked = await service.request(owner,"POST",path+"/share",{oid:guest,permission:"remove"},String(shared.version));
  const saved = await service.request(owner,"PUT",path,{oscal:revoked.oscal},String(revoked.version));
  const history = (await service.request(owner,"GET",path+"/revisions")).items;
  assert.equal(history.at(-1).actorIdentity.displayName,"Saved owner");
  assert.equal(saved.access.length,0);
  const labels = await service.request(owner,"POST",path+"/identities",{ids:[owner.oid]});
  assert.equal(labels.unavailable,true);
});
test("Graph uses fixed tenant, escaped prefix queries, bounded results and fresh share validation",async()=>{
  const calls: string[] = [];
  let exists = true;
  const request = async (url: any) => { calls.push(String(url)); return new Response(JSON.stringify(String(url).includes('users?') ? {value:Array(30).fill({id:guest,displayName:"Same name",userPrincipalName:"guest#EXT#@tenant",userType:"Guest"})} : {id:guest,displayName:"Person"}),{status:exists?200:404}); };
  const directory = new GraphDirectory(tenant,{getToken:async()=>({token:"test"})} as any,request as any);
  const matches = await directory.search(tenant,"O'Ne");
  assert.equal(matches.length,20); assert.equal(matches[0].guest,true); assert.equal(matches[0].email,undefined);
  assert.match(new URL(calls[0]).searchParams.get('$filter')!,/O''Ne/);
  await denied(directory.search(tenant,"ab"),400);
  await denied(directory.lookup("other",guest),403);
  await directory.lookup(tenant,guest); const count = calls.length;
  await directory.lookup(tenant,guest); assert.equal(calls.length,count);
  exists=false; assert.equal(await directory.lookup(tenant,guest,true),undefined);
  assert.equal(calls.length,count+1);
});
test("Graph failures stay sanitized and displayed directory fields are escaped",async()=>{
  const directory = new GraphDirectory(tenant,{getToken:async()=>({token:"secret"})} as any,async()=>{throw Error("token secret");});
  await assert.rejects(directory.search(tenant,"Per"),(e:any)=>e.status===503&&!e.message.includes("secret"));
  const html = personLabel(guest,{oid:guest,displayName:'<img src=x onerror=alert(1)>',email:'<script>'});
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>'));
  assert.match(personLabel(guest),/User unavailable/);
});
