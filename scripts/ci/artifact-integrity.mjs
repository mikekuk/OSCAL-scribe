import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function artifactHashes(root) {
  const hashes={};
  function walk(path) {
    const absolute=root+'/'+path, stat=lstatSync(absolute);
    if(stat.isSymbolicLink()) throw Error('Artifact symlinks are not allowed');
    if(stat.isDirectory()) for(const name of readdirSync(absolute).sort()) walk(path+'/'+name);
    else hashes[path]=createHash('sha256').update(readFileSync(absolute)).digest('hex');
  }
  walk('api.zip');walk('web');return hashes;
}
export function verifyArtifact(root, provenance) {
  if(JSON.stringify(artifactHashes(root)) !== JSON.stringify(provenance.hashes)) throw Error('Application artifact digest mismatch');
}
