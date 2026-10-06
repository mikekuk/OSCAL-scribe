// Pinned public reference content; publication still requires organisational approval.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const config=JSON.parse(await readFile('content/reference.json','utf8'));
const root='work/reference-source'; await mkdir(root,{recursive:true});
for(const file of config.files) {
  const response=await fetch(file.url,{signal:AbortSignal.timeout(60_000)});
  if(!response.ok) throw Error(`Reference download failed: ${file.path}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(data).digest('hex')!==file.sha256) throw Error(`Reference checksum mismatch: ${file.path}`);
  JSON.parse(data.toString('utf8')); await writeFile(root+'/'+file.path,data);
}
await writeFile(root+'/manifest.json',JSON.stringify({demo:false,sources:config.files.map((f:any)=>f.path),profiles:config.profiles,provenance:config},null,2));
console.log('Pinned NIST reference sources prepared; publication is a separate approval decision.');
