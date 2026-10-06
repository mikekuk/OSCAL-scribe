import { escapeHtml as h } from "../shared/lens/views.mjs";
type Api = (path: string, method?: string, body?: any) => Promise<any>;
const pageSize = 25;
/** Each workspace has its own filters and page history. SSPs and storage pages
 * are loaded on demand; the bounded library registry contains metadata only. */
export async function showAdmin(api: Api, layout: (html: string) => void, run: (fn: () => Promise<any>) => any, download: (name: string, doc: any) => void, actions: { open: (id: string) => Promise<void>; create: () => Promise<void>; upload: () => Promise<void> }) {
  let view = "Plans", planQuery = "", libraryQuery = "", state = "all", model = "", libraryPage = 0;
  let planPages: (string | undefined)[] = [undefined], partitionPages: (string | undefined)[] = [undefined], recordPages: (string | undefined)[] = [undefined];
  let planResult: any = { items: [] }, partitionResult: any = { items: [] }, records: any = { items: [] }, library: any;
  let partition = "", container = "content", partitionQuery = "", recordQuery = "";
  const checked = (value: string, current: string) => value === current ? " selected" : "";
  const pager = (id: string, page: number, next: boolean) => `<nav class="admin-pager" aria-label="${h(id)} pages"><button class="quiet" id="${id}-prev" ${page ? "" : "disabled"}>Previous</button><span>Page ${page + 1}</span><button class="quiet" id="${id}-next" ${next ? "" : "disabled"}>Next</button></nav>`;
  const notice = (text: string) => { document.querySelector("#message")!.textContent = text; };
  const inspect = (name: string, doc: any) => {
    document.querySelector("#admin-inspector")?.remove();
    const panel = document.createElement("section");
    panel.id = "admin-inspector"; panel.className = "admin-inspector";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Inspect " + name);
    panel.innerHTML = `<div class="component-heading"><h2>${h(name)}</h2><button class="quiet" id="inspect-close">Close</button></div><p>Read-only JSON preview. Download includes the entire document.</p><label class="field">Find text in document<input id="inspect-search" type="search"></label><p id="inspect-result"></p><button id="inspect-download">Download full JSON</button><pre class="admin-json" id="inspect-json"></pre>`;
    document.querySelector("main")!.append(panel);
    const text = JSON.stringify(doc, null, 2), limit = 100000;
    panel.querySelector("#inspect-json")!.textContent = text.slice(0, limit) + (text.length > limit ? "\n… preview truncated; download for the full document." : "");
    panel.querySelector<HTMLButtonElement>("#inspect-close")!.onclick = () => panel.remove();
    panel.querySelector<HTMLButtonElement>("#inspect-download")!.onclick = () => download(name.replace(/[^a-z0-9_.-]/gi, "_") + ".json", doc);
    panel.querySelector<HTMLInputElement>("#inspect-search")!.oninput = e => {
      const needle = (e.target as HTMLInputElement).value, index = text.toLowerCase().indexOf(needle.toLowerCase());
      panel.querySelector("#inspect-result")!.textContent = !needle ? "" : index < 0 ? "No match in this document." : "First match at character " + (index + 1);
      const start = needle && index >= 0 ? Math.max(0, index - 200) : 0;
      panel.querySelector("#inspect-json")!.textContent = text.slice(start, start + limit) + (text.length > start + limit ? "\n… download for the full document." : "");
    };
    panel.querySelector<HTMLButtonElement>("#inspect-close")!.focus();
    panel.onkeydown = e => { if (e.key === "Escape") panel.remove(); };
  };
  async function loadPlans() { planResult = await api("admin/ssps", "POST", { query: planQuery, state, cursor: planPages.at(-1) }); }
  async function loadPartitions() { partitionResult = await api("admin/partitions", "POST", { query: partitionQuery, cursor: partitionPages.at(-1) }); }
  async function loadRecords() { records = await api("admin/raw", "POST", { container, partition, query: recordQuery, cursor: recordPages.at(-1) }); }
  async function refreshLibrary() { library = await api("admin/library"); }
  async function selectView(next: string) {
    view = next;
    if (view === "Plans") await loadPlans();
    else if (view === "Content library") await refreshLibrary();
    else await loadPartitions();
    render();
  }
  function render() {
    let content = "";
    if (view === "Plans") {
      content = `<div class="component-heading"><h2>System security plans</h2><div class="inline"><button id="admin-upload-ssp" class="quiet">Upload SSP</button><button id="admin-new-plan">Create plan</button></div></div><p>Search across plans by title or ID. Permanent deletion removes all revisions, attestations and per-plan audit records.</p>
        <form id="plan-filter" class="admin-filters"><label class="field">Search plans<input id="plan-query" type="search" value="${h(planQuery)}" placeholder="Title or SSP ID"></label><label class="field">Plan state<select id="plan-state">${["all", "active", "archived", "deleting"].map(s => `<option value="${s}"${checked(s,state)}>${h(s)}</option>`).join("")}</select></label><button>Search</button></form>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Plan</th><th>Status</th><th>Actions</th></tr></thead><tbody>${planResult.items.map((s: any) => `<tr><td><strong>${h(s.title)}</strong><small>${h(s.sspId)} · v${s.version}</small></td><td>${s.deleting ? "Deletion in progress" : s.archived ? "Archived" : "Active"}</td><td>${!s.deleting ? `<button class="quiet" data-open-plan="${h(s.sspId)}">Open plan</button>` : ""}<button class="quiet" data-browse-ssp="${h(s.sspId)}">Explore records</button><button class="danger" data-purge="${h(s.sspId)}">${s.deleting ? "Retry deletion" : "Permanently delete"}</button></td></tr>`).join("") || '<tr><td colspan="3">No matching plans on this page.</td></tr>'}</tbody></table></div>${pager("plans",planPages.length-1,!!planResult.cursor)}`;
    } else if (view === "Content library") {
      const matches = library.entries.filter((e: any) => (!model || e.model === model) && (e.title + " " + e.path + " " + e.uuid).toLowerCase().includes(libraryQuery.toLowerCase()));
      const pages = Math.max(1, Math.ceil(matches.length / pageSize)); libraryPage = Math.min(libraryPage, pages-1);
      const visible = matches.slice(libraryPage*pageSize, (libraryPage+1)*pageSize);
      content = `<div class="component-heading"><h2>Content library</h2><button class="quiet" id="library-export" ${library.problems.length || !library.entries.some((e: any) => e.model === "profile") ? "disabled" : ""}>Export for publication</button></div><p>Staged files only. Publication through the controlled-content pipeline preserves existing SSP releases.</p>
        <details class="admin-upload"><summary>Upload a document</summary><label class="field">Library path<input id="library-path" placeholder="catalogs/company.json" maxlength="200"></label><label class="field">OSCAL JSON file<input id="library-file" type="file" accept=".json,application/json"></label><button id="library-upload">Upload document</button></details>
        ${library.problems.length ? `<details><summary>${library.problems.length} reference issues — export blocked</summary>${library.problems.map((p: string) => `<p>${h(p)}</p>`).join("")}</details>` : '<p>All library references resolve.</p>'}
        <form id="library-filter" class="admin-filters"><label class="field">Search library<input id="library-query" type="search" value="${h(libraryQuery)}" placeholder="Title, path or UUID"></label><label class="field">Document type<select id="library-model">${["", "catalog", "profile", "component-definition"].map(m => `<option value="${m}"${checked(m,model)}>${h(m||"All types")}</option>`).join("")}</select></label><button>Search</button></form><p>${matches.length} matching files · ${library.entries.length} total · ${Math.round(library.entries.reduce((n: number,e: any)=>n+e.bytes,0)/1000)} KB</p>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Document</th><th>Type / references</th><th>Actions</th></tr></thead><tbody>${visible.map((e: any) => `<tr><td><strong>${h(e.title)}</strong><small>${h(e.path)}</small></td><td>${h(e.model)}<small>${e.references.length} dependencies</small></td><td><button class="quiet" data-view-asset="${h(e.id)}">Inspect</button><button class="quiet" data-dependencies="${h(e.id)}">References</button><button class="danger" data-delete-asset="${h(e.id)}">Delete</button></td></tr>`).join("") || '<tr><td colspan="3">No matching library files.</td></tr>'}</tbody></table></div>${pager("library",libraryPage,libraryPage+1<pages)}`;
    } else {
      content = `<h2>Raw storage explorer</h2><p>Read-only records from Scribe’s fixed containers. Select a partition, then inspect individual records.</p><div class="admin-storage">
        <aside><h3>Content partitions</h3><form id="partition-filter"><label class="field">Find partition<input id="partition-query" type="search" value="${h(partitionQuery)}" placeholder="Release ID, asset:, library…"></label><button class="quiet">Search</button></form><div class="admin-partitions">${partitionResult.items.map((p: string) => `<button class="quiet ${container==='content'&&partition===p?'selected':''}" data-partition="${h(p)}">${h(p)}</button>`).join("") || '<p>No matching partitions.</p>'}</div>${pager("partitions",partitionPages.length-1,!!partitionResult.cursor)}<p>SSP partitions are available from <button class="quiet" data-view="Plans">Plans</button>.</p></aside>
        <section class="admin-records"><h3>${partition ? h(container+" / "+partition) : "Choose a partition"}</h3>${partition ? `<form id="record-filter" class="admin-filters"><label class="field">Find record ID<input id="record-query" type="search" value="${h(recordQuery)}" placeholder="current, revision:, manifest…"></label><button class="quiet">Search</button></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Record ID</th><th>Kind</th><th>Action</th></tr></thead><tbody>${records.items.map((r: any,i: number) => `<tr><td>${h(r.id||"registry")}</td><td>${h(r.kind||r.operation||"document")}</td><td><button class="quiet" data-inspect-record="${i}">Inspect JSON</button></td></tr>`).join("") || '<tr><td colspan="3">No records on this page.</td></tr>'}</tbody></table></div>${pager("records",recordPages.length-1,!!records.cursor)}`:'<p>Select a content partition on the left, or open a plan’s records from Plans.</p>'}</section></div>`;
    }
    layout(`<div class="eyebrow">APP ADMIN / ${h(view)}</div><h1>Administration</h1><nav class="admin-nav" aria-label="Administration sections">${["Plans","Content library","Raw storage"].map(v=>`<button class="quiet ${v===view?'selected':''}" data-view="${v}" ${v===view?'aria-current="page"':''}>${v}</button>`).join("")}</nav><section class="admin-workspace">${content}</section>`);
    const bind = (id: string, fn: () => Promise<any>) => { const b=document.getElementById(id); if(b)b.onclick=()=>run(fn); };
    const form = (id: string, fn: () => Promise<any>) => { const f=document.getElementById(id); if(f)f.onsubmit=e=>{e.preventDefault();run(fn);}; };
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b=>b.onclick=()=>run(()=>selectView(b.dataset.view!)));
    form("plan-filter",async()=>{planQuery=value("plan-query");state=value("plan-state");planPages=[undefined];await loadPlans();render();});
    form("library-filter",async()=>{libraryQuery=value("library-query");model=value("library-model");libraryPage=0;render();});
    form("partition-filter",async()=>{partitionQuery=value("partition-query");partitionPages=[undefined];await loadPartitions();render();});
    form("record-filter",async()=>{recordQuery=value("record-query");recordPages=[undefined];await loadRecords();render();});
    for(const [id,history,result,load] of [["plans",planPages,planResult,loadPlans],["partitions",partitionPages,partitionResult,loadPartitions],["records",recordPages,records,loadRecords]] as const) {
      bind(id+"-next",async()=>{history.push(result.cursor);await load();render();});
      bind(id+"-prev",async()=>{history.pop();await load();render();});
    }
    bind("library-next",async()=>{libraryPage++;render();}); bind("library-prev",async()=>{libraryPage--;render();});
    document.querySelectorAll<HTMLButtonElement>("[data-partition]").forEach(b=>b.onclick=()=>run(async()=>{container="content";partition=b.dataset.partition!;recordQuery="";recordPages=[undefined];await loadRecords();render();}));
    document.querySelectorAll<HTMLButtonElement>("[data-inspect-record]").forEach(b=>b.onclick=()=>inspect(records.items[Number(b.dataset.inspectRecord)].id||"record",records.items[Number(b.dataset.inspectRecord)]));
    bind("admin-new-plan", actions.create);
    bind("admin-upload-ssp", actions.upload);
    document.querySelectorAll<HTMLButtonElement>("[data-open-plan]").forEach(b=>b.onclick=()=>run(()=>actions.open(b.dataset.openPlan!)));
    document.querySelectorAll<HTMLButtonElement>("[data-browse-ssp]").forEach(b=>b.onclick=()=>run(async()=>{container="ssps";partition=b.dataset.browseSsp!;recordQuery="";recordPages=[undefined];await loadRecords();await selectView("Raw storage");}));
    document.querySelectorAll<HTMLButtonElement>("[data-purge]").forEach(b=>b.onclick=()=>run(async()=>{
      const s=planResult.items.find((s:any)=>s.sspId===b.dataset.purge);
      const confirm=prompt(`Permanently delete ${s.title}, including ALL revisions and attestations? No in-app undo. Type the SSP ID:\n${s.sspId}`);
      if(confirm!==s.sspId)return;
      await api("admin/ssps/"+s.sspId,"DELETE",{confirm,version:s.version});await loadPlans();render();notice("SSP permanently deleted.");
    }));
    bind("library-upload",async()=>{
      const file=document.querySelector<HTMLInputElement>("#library-file")!.files?.[0];
      if(!file)throw Error("Choose an OSCAL JSON file");if(file.size>20_000_000)throw Error("Maximum upload size is 20 MB");
      await api("admin/library","POST",{path:value("library-path"),doc:JSON.parse(await file.text())});await refreshLibrary();render();notice("Document uploaded to the staged library.");
    });
    bind("library-export",async()=>{download("oscal-library-bundle.json",await api("admin/library/export"));notice("Publication bundle prepared for the controlled-content pipeline.");});
    document.querySelectorAll<HTMLButtonElement>("[data-view-asset]").forEach(b=>b.onclick=()=>run(async()=>{const e=library.entries.find((e:any)=>e.id===b.dataset.viewAsset);inspect(e.path,await api("admin/library/"+e.id));}));
    document.querySelectorAll<HTMLButtonElement>("[data-dependencies]").forEach(b=>b.onclick=()=>{const e=library.entries.find((e:any)=>e.id===b.dataset.dependencies);inspect(e.path+" references",{path:e.path,dependsOn:e.references,referencedBy:library.entries.filter((x:any)=>x.references.includes(e.path)).map((x:any)=>x.path)});});
    document.querySelectorAll<HTMLButtonElement>("[data-delete-asset]").forEach(b=>b.onclick=()=>run(async()=>{
      const e=library.entries.find((e:any)=>e.id===b.dataset.deleteAsset), confirm=prompt(`Delete ${e.path} from the staged library? Published releases and SSPs are unchanged. Type the path:`);
      if(confirm!==e.path)return;
      await api("admin/library/"+e.id,"DELETE",{confirm,version:library.version});await refreshLibrary();render();notice("Library document deleted.");
    }));
  }
  await selectView("Plans");
}
