import { test } from "node:test";
import assert from "node:assert/strict";
import { Service, ApiError } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
import { createSsp } from "../src/shared/oscal";
import { validate } from "../src/shared/validation";
import { copyUploadedSsp } from "../src/shared/ssp-import";
import { uploadHelp } from "../src/web/ssp-upload";
const profile: any = { id: "original", title: "Original baseline", resolved: { catalog: { controls: [{ id: "ac-1", title: "Policy", parts: [{ id: "ac-1_smt", name: "statement", prose: "Maintain policy." }] }] } } };
const release: any = { id: "historic-release", profiles: [profile], components: [], sources: [] };
const user = { oid: "11111111-1111-4111-8111-111111111111", tid: "tenant", roles: ["User"], displayName: "Uploader" };
function setup() {
  const repo = new MemoryRepository();
  const service = new Service(repo, { active: async () => { throw Error("Active release must not be used"); }, get: async id => { if(id!==release.id) throw new ApiError(404,"Missing release"); return release; } });
  const oscal = createSsp("Previously downloaded", profile, release.id);
  oscal["system-security-plan"].metadata.version = "12";
  return {repo,service,oscal};
}
const rejects = (p: Promise<any>, code: number) => assert.rejects(p,(e:any)=>e.status===code);
for(const role of ["User","Security","AppAdmin"]) test(`${role} can preview and import an SSP pinned to an older release`,async()=>{
 const {repo,service,oscal}=setup(), actor={...user,roles:[role]};
 const preview=await service.request(actor,"POST","ssps/import/preview",{oscal});
 assert.equal(preview.profileTitle,"Original baseline"); assert.equal(repo.current.size,0);
 const imported=await service.request(actor,"POST","ssps/import",{oscal});
 assert.notEqual(imported.sspId,oscal["system-security-plan"].uuid);
 assert.equal(imported.ownerId,user.oid);assert.equal(imported.tenantId,user.tid);
 assert.deepEqual(imported.access,[]);assert.equal(imported.lastAttestation,undefined);assert.equal(imported.currentRevision,1);
 assert.equal(imported.oscal["system-security-plan"].metadata.version,"1");
 assert.deepEqual(imported.oscal["system-security-plan"]["control-implementation"],oscal["system-security-plan"]["control-implementation"]);
 assert.deepEqual(imported.oscal["system-security-plan"]["system-implementation"],oscal["system-security-plan"]["system-implementation"]);
 const revision=(await repo.records(imported.sspId,"revision:"))[0];
 assert.equal(revision.actor,user.oid);assert.equal(revision.actorIdentity.displayName,"Uploader");
 assert.deepEqual(validate(imported.oscal),[]);
 const again=await service.request(actor,"POST","ssps/import",{oscal});
 assert.notEqual(imported.sspId,again.sspId);assert.equal(repo.current.size,2);
});
test("upload cannot replace another tenant's SSP or import application permissions",async()=>{
 const {repo,service,oscal}=setup();
 const original=await service.request(user,"POST","ssps/import",{oscal});
 const before=JSON.stringify(await repo.get(original.sspId));
 const other={...user,tid:"another-tenant",oid:"22222222-2222-4222-8222-222222222222"};
 const copy=await service.request(other,"POST","ssps/import",{oscal:original.oscal});
 assert.equal(copy.tenantId,other.tid);assert.equal(copy.ownerId,other.oid);
 assert.equal(JSON.stringify(await repo.get(original.sspId)),before);
 await rejects(service.request(other,"POST","ssps/import",{oscal,ownerId:user.oid,access:[{oid:user.oid,permission:"edit"}]}),400);
 await rejects(service.request(undefined,"POST","ssps/import",{oscal}),401);
 await rejects(service.request({...user,roles:[]},"POST","ssps/import",{oscal}),403);
});
test("invalid uploads and unavailable baselines leave storage unchanged",async()=>{
 const {repo,service,oscal}=setup();
 for(const doc of [{},{oscal},null,{...oscal,access:[]}]) await rejects(service.request(user,"POST","ssps/import",{oscal:doc}),422);
 for(const href of ["https://example.test/profile.json","urn:oscal-scribe:missing:original","urn:oscal-scribe:historic-release:missing"]){
  const doc=structuredClone(oscal);doc["system-security-plan"]["import-profile"].href=href;
  await rejects(service.request(user,"POST","ssps/import",{oscal:doc}),422);
 }
 const invalid=structuredClone(oscal);invalid["system-security-plan"]["control-implementation"]["implemented-requirements"][0]["control-id"]="ac-999";
 await rejects(service.request(user,"POST","ssps/import",{oscal:invalid}),422);
 const noSystem=structuredClone(oscal);noSystem["system-security-plan"]["system-implementation"].components[0].type="system";
 await rejects(service.request(user,"POST","ssps/import",{oscal:noSystem}),422);
 const huge=structuredClone(oscal);huge["system-security-plan"].metadata.title="x".repeat(1_000_000);
 await rejects(service.request(user,"POST","ssps/import",{oscal:huge}),413);
 assert.equal(repo.current.size,0);
});
test("copy remaps local root links without changing embedded identities or the source",()=>{
 const {oscal}=setup(),root=oscal["system-security-plan"],id="99999999-9999-4999-8999-999999999999";
 root.metadata.links=[{href:"#"+root.uuid,rel:"related"}];
 const original=JSON.stringify(oscal),copy=copyUploadedSsp(oscal,id,new Date().toISOString());
 assert.equal(JSON.stringify(oscal),original);
 assert.equal(copy["system-security-plan"].metadata.links[0].href,"#"+id);
 assert.equal(copy["system-security-plan"].metadata.links.at(-1).href,"urn:uuid:"+root.uuid);
 assert.match(uploadHelp,/1 MB/);assert.match(uploadHelp,/original published content release/);assert.match(uploadHelp,/not overwritten/);
});
