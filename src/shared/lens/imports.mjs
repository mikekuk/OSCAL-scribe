/** Browser-local document loading and OSCAL import-to-file matching. */
// A synthetic origin is used only to apply URL path rules. No requests are made.
const ORIGIN = 'https://oscal.local/';
// Directory uploads preserve paths; individual uploads only provide a filename.
export function documentPath(entry) {
  return entry.path || entry.name;
}

function urlPath(path) {
  return new URL(path.split('/').map(encodeURIComponent).join('/'), ORIGIN);
}
/** Select JSON alternatives from a direct import or a back-matter resource. */
export function importHrefs(body, href) {
  if (typeof href !== 'string' || !href) throw Error('Import is missing its href.');
  if (!href.startsWith('#')) return [href];
  const resource = body['back-matter']?.resources?.find(r => r.uuid === href.slice(1));
  if (!resource) throw Error('Missing back-matter import resource: ' + href);
  const links = (resource.rlinks || []).filter(link => {
    if (!link.href) return false;
    const media = (link['media-type'] || '').split(';')[0].trim().toLowerCase();
    if (media) return media === 'application/json' || media.endsWith('+json');
    return /\.json$/i.test(new URL(link.href, ORIGIN).pathname);
  });
  if (!links.length) throw Error('Import resource ' + href +
    ' has no JSON link. XML, YAML and embedded base64 imports are not supported.');
  return [...new Set(links.map(link => link.href))];
}
/** Bind an import to an uploaded file without fetching remote content. */
export function resolveImport(body, href, source, documents) {
  const references = importHrefs(body, href);
  const base = urlPath(documentPath(source));
  const urls = references.map(ref => new URL(ref, base));
  if (urls.some(url => !['http:', 'https:'].includes(url.protocol))) throw Error(
    'Unsupported import URL scheme: ' + href);
  // Match full paths first across all JSON alternatives. Never silently substitute
  // a same-named file elsewhere in an uploaded directory tree.
  for (const url of urls) {
    const target = decodeURIComponent(url.pathname).replace(/^\//, '');
    const exact = documents.filter(d => documentPath(d) === target || documentPath(d) === url.href);
    if (exact.length > 1) throw Error('Ambiguous import path: ' + target);
    if (exact.length === 1) return exact[0];
  }
  // Plain multi-file uploads have no directory information. Allow a unique
  // basename in that mode; absolute remote references can also bind locally.
  const loose = !documentPath(source).includes('/');
  for (let i = 0; i < urls.length; i++) {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(references[i]);
    const name = decodeURIComponent(urls[i].pathname.split('/').pop());
    const candidates = documents.filter(d => (loose || absolute || !documentPath(d).includes(
      '/')) && documentPath(d).split('/').pop() === name);
    if (candidates.length > 1) throw Error('Ambiguous import: ' + name +
      '. Open the common parent folder to preserve relative paths.');
    if (candidates.length === 1) return candidates[0];
  }
  throw Error('Missing JSON import: ' + references.join(' or ') +
    '. Open the common parent folder containing the profile and its sources, or select the source JSON file separately.'
  );
}

/** Read supported files, replacing identical paths and collecting per-file errors. */
export async function readDocuments(files, existing, {
  folder = false
} = {}) {
  const documents = [...existing],
    errors = [];
  let added = 0,
    skipped = 0;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (!/\.json$/i.test(file.name)) {
      skipped++;
      continue;
    }
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('File exceeds the 20 MB limit.');
      const doc = JSON.parse(await file.text());
      const types = ['catalog', 'profile', 'mapping-collection'].filter(k => doc && typeof doc === 'object' && doc[k]);
      if (!types.length && folder) {
        skipped++;
        continue;
      }
      if (types.length !== 1 || typeof doc[types[0]] !== 'object' || Array.isArray(doc[types[0]]))
        throw Error('Expected one catalogue, profile or mapping collection object.');
      const entry = {
        name: file.name,
        path,
        doc
      };
      const index = documents.findIndex(d => documentPath(d) === path);
      if (index < 0) documents.push(entry);
      else documents[index] = entry;
      added++;
    } catch (e) {
      errors.push(path + ': ' + e.message);
    }
  }
  return {
    documents,
    added,
    skipped,
    errors
  };
}
