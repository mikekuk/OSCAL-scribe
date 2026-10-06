import { showSspUpload } from "./ssp-upload";
import { mountPeoplePicker, personLabel } from "./people-picker";
import type { Person } from "../shared/types";
import { componentTypes, localComponentType } from "../shared/component-types";
import { showAdmin } from "./admin-view";
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";
import { escapeHtml as h } from "../shared/lens/views.mjs";
import { flatten, preview } from "../shared/lens/engine.mjs";
import { uuid, reviewStatus } from "../shared/oscal";
import { validate } from "./validation";
import type { Json, Ssp, User } from "../shared/types";
import { addRole, removeRole, effectiveRequirement, requirement, ensureStatement, setDescription, setSectionStatus, systemComponent, syncProgress, applyComponentStatements, removeComponent, addLocalComponent, importedComponentIds, assignedComponentIds, transferControls, setComponentRemarks, deleteLocalComponent, deleteControlAssignment } from "../shared/implementation";
import { filterControls, renderControlCards } from "./control-view";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
let identities = new Map<string, Person>();
let selectedSharePerson: () => Person | undefined = () => undefined;
const livePerson = (oid: string) => `<div data-live-person="${h(oid)}">${personLabel(oid, identities.get(oid))}</div>`;
async function loadIdentities() {
  const plan = current!;
  const ids = [...new Set([plan.ownerId, plan.modifiedBy, ...plan.access.map(a => a.oid), ...history.filter(r => !r.actorIdentity).map(r => r.actor)])];
  for (let start = 0; start < ids.length; start += 100) {
    try {
      const result = await api(`ssps/${plan.sspId}/identities`, "POST", { ids: ids.slice(start, start + 100) });
      if (current !== plan) return;
      for (const person of result.people) identities.set(person.oid, person);
      // Update labels only: an arriving lookup must not reset a user's search or edits.
      document.querySelectorAll<HTMLElement>("[data-live-person]").forEach(node => {
        const oid = node.dataset.livePerson!, person = identities.get(oid);
        const name = document.createElement("span"), contact = document.createElement("small");
        name.textContent = person?.displayName || "User unavailable";
        const address = person?.email || person?.userPrincipalName;
        if (address) { contact.textContent = ` (${address})`; name.append(contact); }
        if (person?.guest) name.append(" · Guest");
        const details = document.createElement("details"), summary = document.createElement("summary"), identity = document.createElement("code");
        summary.textContent = "Identity details"; identity.textContent = oid; details.append(summary, identity);
        node.replaceChildren(name, details);
      });
      if (result.unavailable) return;
    } catch { /* Names are optional display data: opening an SSP must still work. */ }
  }
}
let msal: PublicClientApplication | undefined,
  scopes: string[] = [],
  demo = false,
  user: User,
  approved: any,
  current: Ssp | undefined,
  baseline: any,
  tab = "Overview",
  addComponentOpen = false,
  controlQuery = "",
  controlGroup = "",
  controlComponent = "",
  transferSource = "",
  transferTarget = "",
  dirty = false,
  errors: string[] = [],
  history: any[] = [],
  list: any[] = [];
const tabs = [
  "Overview",
  "People & Roles",
  "System Characteristics",
  "Components",
  "Controls / Implementation",
  "Attestation & History",
  "OSCAL / Validation",
];
const openCards = new Set<string>();
const selectedControls = new Set<string>();
let planPages: (string | undefined)[] = [undefined], planNext: string | undefined;
let revisionPages: (string | undefined)[] = [undefined], revisionNext: string | undefined;
let sessionGeneration = 0;
function clearSession() {
  sessionGeneration++;
  current = undefined; list = []; history = []; baseline = undefined; approved = undefined;
  identities.clear(); rowCache = undefined; selectedControls.clear(); openCards.clear(); dirty = false;
  planPages = [undefined]; revisionPages = [undefined]; planNext = undefined; revisionNext = undefined;
  errors = []; selectedSharePerson = () => undefined;
  controlQuery = controlGroup = controlComponent = transferSource = transferTarget = "";
  app.replaceChildren();
}
function sessionExpired() {
  clearSession();
  const section = document.createElement('section'), title = document.createElement('h1'), button = document.createElement('button');
  title.textContent = 'Your session has ended'; button.textContent = 'Sign in again';
  button.onclick = () => void msal?.loginRedirect({scopes, prompt:'select_account'});
  section.append(title,button); app.append(section);
}
async function loadPlanPage() {
  const cursor = planPages.at(-1);
  const page = await api('ssps' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
  list = page.items; planNext = page.cursor;
}
async function loadRevisionPage() {
  const cursor = revisionPages.at(-1);
  const page = await api(`ssps/${current!.sspId}/revisions` + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
  history = page.items; revisionNext = page.cursor;
}
const body = () => current!.oscal["system-security-plan"];
async function api(path: string, method = "GET", data?: any) {
  const generation = sessionGeneration;
  let token = "";
  if (msal) {
    const account = msal.getActiveAccount();
    if (!account) throw Error("Please sign in");
    try {
      token = (await msal.acquireTokenSilent({ account, scopes })).accessToken;
    } catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) throw error;
      clearSession();
      await msal.acquireTokenRedirect({ account, scopes });
      throw Error("Sign-in required");
    }
  }
  if (generation !== sessionGeneration) throw Error("Session changed");
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(current ? { "If-Match": String(current.version) } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (generation !== sessionGeneration) throw Error("Session changed");
  if (r.status === 401) { sessionExpired(); throw Error("Please sign in again"); }
  const result = await r.json();
  if (generation !== sessionGeneration) throw Error("Session changed");
  if (!r.ok) throw Error([result.error, ...(result.details || [])].join("\n"));
  return result;
}
const editable = () =>
  current &&
  !current.archived &&
  (current.ownerId === user.oid ||
    (user.roles.includes("Security") || user.roles.includes("AppAdmin")) ||
    current.access.some((a) => a.oid === user.oid && a.permission === "edit"));
const administer = () =>
  current && (current.ownerId === user.oid || (user.roles.includes("Security") || user.roles.includes("AppAdmin")));
function pathValue(path: string) {
  return path.split("/").reduce((o, k) => o?.[k], body());
}
function field(
  label: string,
  path: string,
  kind = "text",
  choices: string[] = [],
) {
  const value = pathValue(path) ?? "",
    disabled = !editable() ? "disabled" : "";
  return `<label class="field">${h(label)}${kind === "textarea" ? `<textarea data-path="${h(path)}" ${disabled}>${h(value)}</textarea>` : kind === "select" ? `<select data-path="${h(path)}" ${disabled}>${choices.map((c) => `<option ${value === c ? "selected" : ""}>${h(c)}</option>`).join("")}</select>` : `<input type="${kind}" data-path="${h(path)}" value="${h(value)}" ${disabled}>`}</label>`;
}
function info(label: string, value: any) {
  return `<div><small>${h(label)}</small><p>${h(value ?? "—")}</p></div>`;
}
function layout(content: string) {
  app.innerHTML = `<header><a href="#" id="home"><span class="logo">S</span> OSCAL <b>Scribe</b></a><span class="header-note">SECURITY PLANNING WORKSPACE</span><span>${demo ? "LOCAL DEMO · NOT SAVED" : h(user?.oid?.slice(0, 8) || "")} ${user?.roles.includes("AppAdmin") ? '<button id="admin" class="quiet">Administration</button>' : ""} ${msal ? '<button id="logout" class="quiet">Sign out</button>' : ""}</span></header>${demo ? '<div class="demo">Fictional test environment. Data is held in memory and clears when the demo server restarts.</div>' : ""}<main>${content}</main><div id="message" role="status" aria-live="polite"></div>`;
  document.querySelector("#admin")?.addEventListener("click", () => void run(async () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    current = undefined; dirty = false;
    await showAdmin(api, layout, run, download, { open, create: newAdminPlan, upload: uploadSsp });
  }));
  document.querySelector("#home")?.addEventListener("click", (e) => {
    e.preventDefault();
    void run(home);
  });
  document
    .querySelector("#logout")
    ?.addEventListener("click", () => { clearSession(); void msal?.logoutRedirect(); });
}
function message(text: string, error = false) {
  const m = document.querySelector("#message")!;
  m.textContent = text;
  m.className = error ? "error" : "notice";
}
async function run(fn: () => Promise<any> | void) {
  try {
    await fn();
  } catch (e) {
    if (document.querySelector("#message")) message((e as Error).message, true);
  }
}
async function uploadSsp() {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  current = undefined; dirty = false;
  showSspUpload(layout, api, open, () => run(home));
}
async function newAdminPlan() {
  approved = await api("content");
  list = []; current = undefined; dirty = false;
  renderHome();
  document.querySelector<HTMLElement>("#new-form")!.hidden = false;
  document.querySelector<HTMLInputElement>("#system-name")!.focus();
}
async function home() {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  current = undefined;
  dirty = false;
  if (user.roles.includes("AppAdmin")) { await showAdmin(api, layout, run, download, { open, create: newAdminPlan, upload: uploadSsp }); return; }
  planPages = [undefined]; await loadPlanPage();
  approved = await api("content");
  renderHome();
}
function renderHome() {
  layout(
    `<div class="eyebrow">YOUR ASSURANCE LIBRARY</div><div class="page-title"><div><h1>System security plans</h1><p>Describe your systems. Connect controls to implementation. Keep a clear record.</p></div><div class="inline"><button id="upload-ssp" class="quiet">Upload SSP</button><button id="new">＋ Create a plan</button></div></div><div class="stats">${info("PLANS ON THIS PAGE", list.length)}${info("REVIEW NEEDED", list.filter((x) => reviewStatus(x) !== "Attested").length)}${info("APPROVED BASELINES", approved.profiles.length)}</div><section id="new-form" hidden><h2>Create a system security plan</h2><label class="field">System name<input id="system-name" maxlength="200"></label><label class="field">Approved baseline<select id="profile">${approved.profiles.map((p: any) => `<option value="${h(p.id)}">${h(p.title)}</option>`).join("")}</select></label><button id="create">Create plan</button></section><div class="plans">${list.length ? list.map((s) => `<button class="plan-card" data-open="${h(s.sspId)}"><span class="pill">${h(s.archived ? "Archived" : reviewStatus(s))}</span><h2>${h(s.systemName)}</h2><p>${h(s.profileId)} · Revision ${s.currentRevision}</p><small>Updated ${h(new Date(s.modifiedAt).toLocaleDateString())}</small><span class="arrow">↗</span></button>`).join("") : '<section class="empty"><h2>Your first plan starts with a baseline.</h2><p>Choose an approved profile and Scribe creates a workspace for every applicable control.</p></section>'}</div><nav aria-label="Plan pages"><button id="plans-prev" ${planPages.length === 1 ? 'disabled' : ''}>Previous</button><span>Page ${planPages.length}</span><button id="plans-next" ${planNext ? '' : 'disabled'}>Next</button></nav>`,
  );
  document.querySelector<HTMLButtonElement>('#plans-prev')!.onclick = () => void run(async () => { planPages.pop(); await loadPlanPage(); renderHome(); });
  document.querySelector<HTMLButtonElement>('#plans-next')!.onclick = () => void run(async () => { planPages.push(planNext); await loadPlanPage(); renderHome(); });
  document.querySelector("#upload-ssp")!.addEventListener("click", () => void run(uploadSsp));
  document.querySelector("#new")!.addEventListener("click", () => {
    document.querySelector<HTMLElement>("#new-form")!.hidden = false;
  });
  document.querySelector("#create")!.addEventListener("click", () =>
    run(async () => {
      const s = await api("ssps", "POST", {
        releaseId: approved.id,
        profileId: (document.querySelector("#profile") as HTMLSelectElement)
          .value,
        systemName: (document.querySelector("#system-name") as HTMLInputElement)
          .value,
      });
      await open(s.sspId);
    }),
  );
  document
    .querySelectorAll<HTMLElement>("[data-open]")
    .forEach((e) => (e.onclick = () => void run(() => open(e.dataset.open!))));
}
async function open(id: string) {
  current = await api("ssps/" + id);
  identities = new Map();
  baseline = await api(`content/${current!.releaseId}/${current!.profileId}`);
  rowCache = undefined;
  controlQuery = "";
  controlGroup = "";
  controlComponent = "";
  transferSource = "";
  transferTarget = "";
  selectedControls.clear();
  addComponentOpen = false;
  openCards.clear();
  revisionPages = [undefined]; await loadRevisionPage();
  tab = "Overview";
  dirty = false;
  errors = [];
  render();
  void loadIdentities();
}
let rowCache: any[] | undefined;
function rows() {
  if (rowCache) return rowCache;
  const authoritative = flatten(baseline.profile.resolved.catalog) as any[];
  try {
    const docs = baseline.sources.map((s: any) => ({
        ...s,
        name: s.path.split("/").pop(),
      })),
      profile = docs.find((s: any) => s.path === baseline.profile.path),
      p = preview(profile.doc, docs);
    for (const row of authoritative) {
      const origin = p.rows.filter((r: any) => r.control.id === row.control.id);
      if (origin.length === 1) {
        row.baseControl = origin[0].baseControl;
        row.baseParameters = origin[0].baseParameters;
      }
    }
  } catch {
    /* Authoritative resolved content remains usable when Lens cannot preview a merge. */
  }
  rowCache = authoritative;
  return authoritative;
}
function render() {
  if (!current) return;
  // Capture only currently rendered expanders. Filters hide cards without
  // destroying their state; switching tabs and saving also preserve expansion.
  document.querySelectorAll<HTMLDetailsElement>("[data-expand-key]").forEach(e => {
    if (e.open) openCards.add(e.dataset.expandKey!);
    else openCards.delete(e.dataset.expandKey!);
  });
  const b = body();
  layout(
    `<div class="workspace-heading"><div><div class="eyebrow">${h(current.profileId)} / REVISION ${current.currentRevision}</div><h1>${h(b["system-characteristics"]["system-name"])}</h1><p><span class="pill">${h(current.archived ? "Archived" : reviewStatus(current))}</span> <span id="save-state">${dirty ? "Unsaved changes" : "All changes saved"}</span></p></div><button id="save" ${editable() ? "" : "disabled"}>Save revision</button></div><div class="workspace"><nav aria-label="SSP sections">${tabs.map((t) => `<button data-tab="${t}" class="${tab === t ? "active" : ""}">${t}</button>`).join("")}<div class="nav-foot">Approved content<br><code>${h(current.releaseId.slice(0, 12))}</code><p>Security permissions are separate from system roles.</p></div></nav><article><h2>${tab}</h2>${section()}</article></div>`,
  );
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach(
    (e) =>
      (e.onclick = () => {
        tab = e.dataset.tab!;
        render();
      }),
  );
  document.querySelector("#save")!.addEventListener("click", () => run(save));
  document
    .querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("[data-path]")
    .forEach((e) =>
      e.addEventListener("input", () => {
        const parts = e.dataset.path!.split("/");
        let node = b;
        for (const k of parts.slice(0, -1))
          node = node[k] ??= /^\d+$/.test(parts[parts.indexOf(k) + 1])
            ? []
            : {};
        node[parts.at(-1)!] = e.value;
        mark();
      }),
    );
  bind();
}
function mark() {
  dirty = true;
  const el = document.querySelector("#save-state");
  if (el) el.textContent = "Unsaved changes";
}
function section(): string {
  const b = body(),
    s = current!;
  if (tab === "Overview")
    return `<div class="form-grid">${field("System name", "system-characteristics/system-name")}${field("Plan title", "metadata/title")}${field("System status", "system-characteristics/status/state", "select", ["under-development", "operational", "under-major-modification", "disposition", "other"])}${field("System description", "system-characteristics/description", "textarea")}</div><div class="metadata-grid"><div><small>Owner</small>${livePerson(s.ownerId)}</div>${info("Created", s.createdAt)}${info("Modified", s.modifiedAt)}${info("Last attested", s.lastAttestation?.at)}${info("Next attestation due", s.lastAttestation?.due)}</div>${administer() ? `<hr><h3>Sharing</h3><p>Find a person in this tenant and choose their access. They must also be assigned to Scribe; sharing does not invite users or grant application access.</p><div id="people-picker"></div><div class="inline"><select id="share-permission" aria-label="Permission"><option value="read">Read</option><option value="edit">Edit</option></select><button id="share">Share</button></div>${s.access.map((a) => `<div class="sharing-entry">${livePerson(a.oid)} · ${a.permission} <button class="quiet" data-revoke="${h(a.oid)}">Remove access</button></div>`).join("")}<hr><button id="archive" class="quiet" ${s.archived ? "disabled" : ""}>Archive this plan</button>` : ""}`;
  if (tab === "People & Roles")
    return `<p>Assign the people accountable for this system. Add or remove roles to fit this plan; these assignments do not grant access to Scribe.</p><div class="inline"><input id="new-role-title" aria-label="New role name" placeholder="Role name" maxlength="120" ${editable() ? "" : "disabled"}><button id="add-role" ${editable() ? "" : "disabled"}>Add role</button></div>${(b.metadata.roles || [])
      .map((role: Json) => {
        const id = role.id;
        const r = b.metadata["responsible-parties"]?.find((r: Json) => r["role-id"] === id);
        const party = b.metadata.parties?.find((p: Json) => p.uuid === r?.["party-uuids"]?.[0]);
        return `<section class="role-card"><div class="role-heading"><label class="field">Role name<input data-role-title="${h(id)}" value="${h(role.title)}" maxlength="120" ${editable() ? "" : "disabled"}></label><button class="role-remove quiet" data-remove-role="${h(id)}" aria-label="Delete ${h(role.title)} role" title="Delete role" ${editable() ? "" : "disabled"}>×</button></div><div class="form-grid"><label class="field">Full name<input data-person="${h(id)}" data-kind="name" value="${h(party?.name || "")}" ${editable() ? "" : "disabled"}></label><label class="field">Email<input type="email" data-person="${h(id)}" data-kind="email" value="${h(party?.["email-addresses"]?.[0] || "")}" ${editable() ? "" : "disabled"}></label></div></section>`;
      }).join("")}${b.metadata.roles?.length ? "" : "<p>No roles yet. Add a role and assign a person before attestation.</p>"}`;
  if (tab === "System Characteristics")
    return `<div class="form-grid">${field("Security sensitivity", "system-characteristics/security-sensitivity-level", "select", ["low", "moderate", "high"])}${["confidentiality", "integrity", "availability"].map((k) => field(k + " objective", `system-characteristics/security-impact-level/security-objective-${k}`, "select", ["low", "moderate", "high"])).join("")}${field("Authorization boundary", "system-characteristics/authorization-boundary/description", "textarea")}${field("Information type", "system-characteristics/system-information/information-types/0/title")}${field("Information description", "system-characteristics/system-information/information-types/0/description", "textarea")}${["confidentiality", "integrity", "availability"].map((k) => field("Information " + k, `system-characteristics/system-information/information-types/0/${k}-impact/base`, "select", ["low", "moderate", "high"])).join("")}</div>`;
  if (tab === "Components") return components();
  if (tab === "Controls / Implementation") return controls();
  if (tab === "Attestation & History")
    return `<p>Attestation records an exact saved revision and its SHA-256 digest. Later changes require a new attestation.</p><div class="stats">${info("Review status", reviewStatus(s))}${info("Attested revision", s.lastAttestation?.revision)}${info("Next review", s.lastAttestation?.due)}</div>${administer() ? `<label class="field">Attesting system role<select id="attest-role">${(b.metadata.roles || []).map((r: Json) => `<option value="${h(r.id)}">${h(r.title)}</option>`).join("")}</select></label><button id="attest" ${dirty || s.archived || !b.metadata.roles?.length ? "disabled" : ""}>Attest saved revision ${s.currentRevision}</button>` : ""}<h3>Immutable revision history</h3>${history
      .sort((a, b) => b.revision - a.revision)
      .map(
        (r) =>
          `<section class="revision"><b>Revision ${r.revision}</b><span>${h(new Date(r.at).toLocaleString())}</span><div><small>Saved by</small>${r.actorIdentity ? personLabel(r.actor, r.actorIdentity) : livePerson(r.actor)}${r.actorIdentity ? "<small>Name recorded at save time</small>" : ""}</div><button data-revision="${r.revision}" class="quiet">Download revision</button></section>`,
      )
      .join("")}<nav aria-label="Revision pages"><button id="history-prev" ${revisionPages.length === 1 ? "disabled" : ""}>Previous</button><span>Page ${revisionPages.length}</span><button id="history-next" ${revisionNext ? "" : "disabled"}>Next</button></nav>`;
  return `<p>Schema validation checks structure and references. It does not certify that controls are effective.</p><button id="validate">Validate plan</button> <button id="export">Download OSCAL SSP</button> <button id="export-baseline" class="quiet">Download pinned baseline</button><div class="validation" role="status">${errors.length ? errors.map((e) => `<p>${h(e)}</p>`).join("") : "Run validation to check the current document."}</div><details><summary>Inspect OSCAL JSON</summary><pre>${h(JSON.stringify(current!.oscal, null, 2))}</pre></details>`;
}
/** Local component records live only in the SSP. Imported records retain their
 * definition identity; adding a Windows/Linux component never publishes a CDEF. */
function components() {
  const b = body(), imported = importedComponentIds(baseline.components), disabled = editable() ? "" : "disabled";
  const locals: Json[] = b["system-implementation"].components.filter((c: Json) => !imported.has(c.uuid));
  // Preserve custom types already present in an SSP; never silently select another value.
  const typeOptions = (selected: string) => componentTypes.map(([type, description]) => `<option value="${type}" ${selected === type ? "selected" : ""} ${type === "this-system" ? "disabled" : ""}>${type} — ${h(description)}${type === "this-system" ? " (default component)" : ""}</option>`).join("")
    + (selected && !componentTypes.some(([type]) => type === selected) ? `<option value="${h(selected)}" selected>${h(selected)} — locally defined</option>` : "")
    + '<option value="">Locally defined type…</option>';
  return `<div class="component-heading"><p>Use This system for shared implementation, or add components that match your system. Assign controls using Copy or Move in Controls / Implementation.</p><button id="toggle-add-component" class="quiet component-add" aria-label="Add local component" aria-expanded="${addComponentOpen}" title="Add local component" ${disabled}>+</button></div>
    ${locals.map(c => c.type === "this-system" ? '<section><h3>This system</h3><p><strong>Type: this-system</strong> — The system as a whole. Always included in this SSP.</p></section>' : `<section><div class="component-heading"><h3>${h(c.title)}</h3><button class="quiet" data-delete-local-component="${h(c.uuid)}" ${disabled}>Delete component</button></div><p class="legend">Deleting this component returns any uniquely assigned work to This system.</p>
      <label class="field">Component name<input data-local-component="${h(c.uuid)}" data-component-field="title" value="${h(c.title)}" ${disabled}></label>
      <label class="field">Component type<select data-local-component="${h(c.uuid)}" data-component-field="type" ${disabled}>${typeOptions(c.type)}</select></label>
      <label class="field">Description<textarea data-local-component="${h(c.uuid)}" data-component-field="description" ${disabled}>${h(c.description)}</textarea></label></section>`).join("")}

    <h3>Published components</h3><p>Select a published component to import its statement implementations. Blue identifies imported components; each implementation keeps its own OSCAL status.</p>
    ${baseline.components.flatMap((d: Json) => d["component-definition"].components || []).map((c: Json) => {
      const i = b["system-implementation"].components.findIndex((x: Json) => x.uuid === c.uuid);
      return `<section class="imported-component"><label class="component-title"><input type="checkbox" data-component="${h(c.uuid)}" ${i >= 0 ? "checked" : ""} ${disabled}>${h(c.title)}</label><p>${h(c.description)}</p><details><summary>Published control contributions</summary>${(c["control-implementations"] || []).flatMap((ci: Json) => ci["implemented-requirements"].map((r: Json) => `<p><strong>${h(r["control-id"])}</strong> ${h(r.description)}</p>${(r.statements || []).map((x: Json) => `<p><strong>${h(x["statement-id"])}</strong> ${h(x.description)}</p>`).join("")}`)).join("")}</details>${i >= 0 ? field("How this system uses the service", `system-implementation/components/${i}/remarks`, "textarea") : ""}</section>`;
    }).join("")}
    ${addComponentOpen ? `<section><h3>Add a component to this SSP</h3><div class="form-grid"><label class="field">New component name<input id="new-component-title" placeholder="Component name" ${disabled}></label><label class="field">New component type<select id="new-component-type" ${disabled}>${typeOptions("software")}</select></label></div><label class="field">New component description<textarea id="new-component-description" ${disabled}></textarea></label><button id="add-component" ${disabled}>Add component</button></section>` : ""}`;
}
function controls() {
  const rr = rows(), b = body(), imported = importedComponentIds(baseline.components), disabled = editable() ? "" : "disabled";
  const all: Json[] = b["system-implementation"].components;
  const local = all.filter(c => !imported.has(c.uuid));
  if (!all.some(c => c.uuid === transferSource)) transferSource = all.find(c => c.type === "this-system")!.uuid;
  if (!local.some(c => c.uuid === transferTarget && c.uuid !== transferSource)) transferTarget = local.find(c => c.uuid !== transferSource)?.uuid || "";
  const options = (list: Json[], value: string) => list.map(c => `<option value="${h(c.uuid)}" ${c.uuid === value ? "selected" : ""}>${h(c.title)}</option>`).join("");
  const groups = new Map<string, string>();
  rr.forEach(row => row.groups.forEach((g: Json) => groups.set(g.id || g.title, g.title || g.id)));
  return `<div class="control-toolbar"><label class="field">Find controls<input id="control-search" type="search" value="${h(controlQuery)}" placeholder="ID, title or requirement text"></label><label class="field">Control group<select id="control-group"><option value="">All groups</option>${[...groups].map(([id, title]) => `<option value="${h(id)}" ${controlGroup === id ? "selected" : ""}>${h(title)}</option>`).join("")}</select></label><label class="field">Component view<select id="control-component"><option value="">All components</option>${options(all, controlComponent)}</select></label></div>
    <div class="transfer-toolbar"><strong>Copy or move selected control implementations</strong><p>Copy keeps the source. Move reassigns it. Existing destination work is never overwritten.</p><div class="form-grid"><label class="field">From component<select id="transfer-source" ${disabled}>${options(all, transferSource)}</select></label><label class="field">To component<select id="transfer-target" ${disabled}><option value="">Choose a local component</option>${options(local.filter(c => c.uuid !== transferSource), transferTarget)}</select></label></div><span id="selected-control-count">${selectedControls.size} controls selected</span> <button id="copy-controls" ${disabled}>Copy selected</button> <button id="move-controls" ${disabled || (imported.has(transferSource) ? "disabled" : "")}>Move selected</button> <button id="clear-control-selection" class="quiet">Clear selection</button>${imported.has(transferSource) ? '<p>Imported originals stay assigned to their source. Copy them to make a local implementation.</p>' : ""}</div>
    <div class="control-actions"><span id="control-count" role="status" aria-live="polite"></span><button id="expand-controls" class="quiet">Expand all</button><button id="collapse-controls" class="quiet">Collapse all</button></div>
    <p class="status-legend">${Object.entries({ planned: "Planned", partial: "Partial", implemented: "Implemented", alternative: "Alternative", "not-applicable": "Not applicable" }).map(([state, label]) => `<span class="status-${state}">${label}</span>`).join("")}<span class="origin-imported">Blue: imported source</span></p>
    <div id="control-cards">${renderControlCards(b, rr, baseline.components, !!editable(), openCards, selectedControls, controlComponent)}</div><p id="no-controls" hidden>No controls match these filters.</p>`;
}
function applyControlFilter() {
  const matches = new Set(filterControls(rows(), controlGroup, controlQuery)
    .filter(r => !controlComponent || assignedComponentIds(effectiveRequirement(body(), requirement(body(), r.control.id), r.control, baseline.components)).has(controlComponent))
    .map(r => r.control.id));
  document.querySelectorAll<HTMLElement>("[data-control-card]").forEach(e => e.hidden = !matches.has(e.dataset.controlCard!));
  const count = document.querySelector("#control-count");
  if (count) count.textContent = `${matches.size} of ${rows().length} controls`;
  const empty = document.querySelector<HTMLElement>("#no-controls");
  if (empty) empty.hidden = matches.size > 0;
}
function bind() {
  document.querySelectorAll<HTMLInputElement>("[data-person]").forEach(
    (e) =>
      (e.oninput = () => {
        if (!editable()) return;
        const m = body().metadata,
          id = e.dataset.person!;
        m.parties ??= [];
        m["responsible-parties"] ??= [];
        let role = m["responsible-parties"].find(
          (r: Json) => r["role-id"] === id,
        );
        if (!role) {
          role = { "role-id": id, "party-uuids": [uuid()] };
          m["responsible-parties"].push(role);
          m.parties.push({
            uuid: role["party-uuids"][0],
            type: "person",
            name: "Unassigned",
          });
        }
        const p = m.parties.find(
          (x: Json) => x.uuid === role["party-uuids"][0],
        );
        if (e.dataset.kind === "name") p.name = e.value;
        else if (e.value) p["email-addresses"] = [e.value];
        else delete p["email-addresses"];
        mark();
      }),
  );
  document.querySelectorAll<HTMLInputElement>("[data-component]").forEach(
    (e) =>
      (e.onchange = () => {
        if (!editable()) return;
        const list = body()["system-implementation"].components,
          id = e.dataset.component!;
        if (e.checked) {
          const c = baseline.components
            .flatMap((d: Json) => d["component-definition"].components)
            .find((x: Json) => x.uuid === id);
          list.push({
            uuid: c.uuid,
            type: c.type,
            title: c.title,
            description: c.description,
            status: { state: "operational" },
            links: [{ rel: "imported-from", href: "urn:uuid:" + baseline.components.find((d: Json) => d["component-definition"].components.some((x: Json) => x.uuid === id))["component-definition"].uuid + "#" + id }],
            remarks:
              "Describe onboarding, scope and remaining system responsibilities.",
          });
          for (const row of rows())
            applyComponentStatements(body(), requirement(body(), row.control.id), row.control, baseline.components);
        } else {
          removeComponent(body(), id, rows(), baseline.components);
        }
        mark();
        render();
      }),
  );
  // Use control/statement IDs on every input: editing multiple open cards must
  // never depend on the previously selected control or an array index.
  const controlFor = (e: HTMLElement) => rows().find(r => r.control.id === e.dataset.control).control;
  const reqFor = (e: HTMLElement) => {
    const req = requirement(body(), e.dataset.control!);
    Object.assign(req, effectiveRequirement(body(), req, controlFor(e), baseline.components));
    return req;
  };
  const systemId = body()["system-implementation"].components.find((c: Json) => c.type === "this-system")?.uuid;
  const search = document.querySelector<HTMLInputElement>("#control-search");
  if (search) search.oninput = () => { controlQuery = search.value; applyControlFilter(); };
  document.querySelector<HTMLSelectElement>("#control-component")?.addEventListener("change", e => {
    controlComponent = (e.target as HTMLSelectElement).value;
    if (controlComponent) transferSource = controlComponent;
    render();
  });
  document.querySelectorAll<HTMLInputElement>("[data-select-control]").forEach(e => {
    e.onclick = event => event.stopPropagation();
    e.onchange = () => {
      if (e.checked) selectedControls.add(e.dataset.selectControl!); else selectedControls.delete(e.dataset.selectControl!);
      document.querySelector("#selected-control-count")!.textContent = `${selectedControls.size} controls selected`;
    };
  });
  document.querySelector<HTMLSelectElement>("#transfer-source")?.addEventListener("change", e => { transferSource = (e.target as HTMLSelectElement).value; render(); });
  document.querySelector<HTMLSelectElement>("#transfer-target")?.addEventListener("change", e => { transferTarget = (e.target as HTMLSelectElement).value; });
  document.querySelector("#clear-control-selection")?.addEventListener("click", () => { selectedControls.clear(); render(); });
  for (const mode of ["copy", "move"] as const) document.querySelector("#" + mode + "-controls")?.addEventListener("click", () => void run(() => {
    if (!editable()) return;
    transferControls(body(), rows(), [...selectedControls], transferSource, transferTarget, mode, baseline.components);
    const count = selectedControls.size;
    selectedControls.clear(); mark(); render(); message(`${count} control implementations ${mode === "copy" ? "copied" : "moved"}.`);
  }));
  document.querySelector("#toggle-add-component")?.addEventListener("click", () => {
    addComponentOpen = !addComponentOpen; render();
    document.querySelector<HTMLInputElement>("#new-component-title")?.focus();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-delete-local-component]").forEach(e => e.onclick = () => void run(() => {
    if (!editable()) return;
    deleteLocalComponent(body(), e.dataset.deleteLocalComponent!, rows(), baseline.components);
    if (controlComponent === e.dataset.deleteLocalComponent) controlComponent = "";
    mark(); render(); message("Component deleted. Any uniquely assigned work has returned to System.");
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-delete-assignment]").forEach(e => e.onclick = () => void run(() => {
    if (!editable()) return;
    deleteControlAssignment(body(), reqFor(e), controlFor(e), e.dataset.deleteAssignment!, baseline.components);
    mark(); render(); message("Control assignment deleted; implementation is retained in the other components.");
  }));
  document.querySelector("#add-component")?.addEventListener("click", () => void run(() => {
    if (!editable()) return;
    const selected = document.querySelector<HTMLSelectElement>("#new-component-type")!.value;
    const type = selected || prompt("Enter a locally defined component type:");
    if (type === null) return;
    const component = addLocalComponent(body(), document.querySelector<HTMLInputElement>("#new-component-title")!.value,
      type, document.querySelector<HTMLTextAreaElement>("#new-component-description")!.value);
    transferTarget = component.uuid; addComponentOpen = false; mark(); render();
  }));
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-local-component]").forEach(e => e.onchange = () => void run(() => {
    if (!editable()) return;
    const component = body()["system-implementation"].components.find((c: Json) => c.uuid === e.dataset.localComponent);
    if (!component || importedComponentIds(baseline.components).has(component.uuid) || component.type === "this-system") throw Error("Choose an editable local component");
    const field = e.dataset.componentField!;
    let value = e.value.trim();
    if (field === "type") {
      const custom = value || prompt("Enter a locally defined component type:", component.type);
      if (custom === null) { render(); return; }
      value = localComponentType(custom);
    }
    if (!value || (field === "title" && value.length > 120)) throw Error("Enter a component name and description");
    if (field === "title" && body()["system-implementation"].components.some((c: Json) => c.uuid !== component.uuid && c.title.toLowerCase() === value.toLowerCase())) throw Error("That component name already exists");
    component[field] = value; mark(); render();
  }));
  const group = document.querySelector<HTMLSelectElement>("#control-group");
  if (group) group.onchange = () => { controlGroup = group.value; applyControlFilter(); };
  if (tab === "Controls / Implementation") applyControlFilter();
  for (const [id, value] of [["expand-controls", true], ["collapse-controls", false]] as const) {
    document.querySelector("#" + id)?.addEventListener("click", () => {
      document.querySelectorAll<HTMLDetailsElement>("[data-control-card]:not([hidden])").forEach(e => {
        e.open = value;
        // Keep the embedded Lens content open: its summary is hidden inside
        // the separately expandable requirements panel.
        if (!value) e.querySelectorAll<HTMLDetailsElement>("[data-expand-key]").forEach(d => d.open = false);
      });
    });
  }
  document.querySelectorAll<HTMLSelectElement>("[data-section-status]").forEach(e => e.onchange = () => void run(() => {
    if (!editable()) return;
    setSectionStatus(body(), reqFor(e), controlFor(e), e.dataset.sectionStatus!, e.value, baseline.components, e.dataset.implementationComponent);
    mark(); render();
  }));
  document.querySelectorAll<HTMLSelectElement>("[data-req-role]").forEach(e => e.onchange = () => {
    if (!editable()) return;
    const req = reqFor(e);
    if (e.value) req["responsible-roles"] = [{ "role-id": e.value }];
    else delete req["responsible-roles"];
    mark();
  });
  document.querySelectorAll<HTMLTextAreaElement>("[data-bycomponent], [data-statement], [data-component-remarks], [data-control-remarks]").forEach(e => e.oninput = () => {
    if (!editable()) return;
    const req = reqFor(e);
    if (e.hasAttribute("data-control-remarks")) { if (e.value) req.remarks = e.value; else delete req.remarks; }
    else if (e.dataset.componentRemarks) {
      setComponentRemarks(e.dataset.statement ? ensureStatement(req, e.dataset.statement) : req, e.dataset.componentRemarks, e.value);    } else {
      const target = e.dataset.statement ? ensureStatement(req, e.dataset.statement) : req;
      setDescription(target, e.dataset.bycomponent || systemId, e.value);
    }
    mark();
  });
  document.querySelectorAll<HTMLInputElement>("[data-role-title]").forEach(e => e.onchange = () => void run(() => {
    if (!editable()) return;
    const title = e.value.trim(), role = body().metadata.roles.find((r: Json) => r.id === e.dataset.roleTitle);
    if (!title || title.length > 120) { e.value = role.title; throw Error("Enter a role name of 1–120 characters"); }
    role.title = title; mark();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-remove-role]").forEach(e => e.onclick = () => {
    if (!editable()) return;
    removeRole(body(), e.dataset.removeRole!); mark(); render();
  });
  document.querySelector("#add-role")?.addEventListener("click", () => void run(() => {
    if (!editable()) return;
    addRole(body(), document.querySelector<HTMLInputElement>("#new-role-title")!.value); mark(); render();
  }));
  const on = (id: string, fn: () => any) =>
    document.querySelector("#" + id)?.addEventListener("click", () => run(fn));
  const picker = document.querySelector<HTMLElement>("#people-picker");
  selectedSharePerson = picker ? mountPeoplePicker(picker, query => api(`ssps/${current!.sspId}/people`, "POST", { query })) : () => undefined;
  on("share", async () => {
    const person = selectedSharePerson();
    if (!person) throw Error("Search for and select a person first");
    if (dirty) throw Error("Save your edits before changing sharing");
    current = await api(`ssps/${current!.sspId}/share`, "POST", {
      oid: person.oid,
      permission: (
        document.querySelector("#share-permission") as HTMLSelectElement
      ).value,
    });
    identities.set(person.oid, person);
    render();
  });
  document.querySelectorAll<HTMLElement>("[data-revoke]").forEach(
    (e) =>
      (e.onclick = () =>
        void run(async () => {
          if (dirty) throw Error("Save edits first");
          current = await api(`ssps/${current!.sspId}/share`, "POST", {
            oid: e.dataset.revoke,
            permission: "remove",
          });
          render();
        })),
  );
  on("archive", async () => {
    if (dirty) throw Error("Save edits first");
    if (confirm("Archive this plan? Its history will remain available.")) {
      current = await api(`ssps/${current!.sspId}/archive`, "POST", {});
      render();
    }
  });
  on("attest", async () => {
    current = await api(`ssps/${current!.sspId}/attest`, "POST", {
      revision: current!.currentRevision,
      systemRole: (document.querySelector("#attest-role") as HTMLSelectElement)
        .value,
    });
    render();
    message("Attestation recorded for the saved revision.");
  });
  on("validate", async () => {
    errors = validate(current!.oscal);
    if (!errors.length)
      errors = (
        await api(`ssps/${current!.sspId}/validate`, "POST", {
          oscal: current!.oscal,
        })
      ).errors;
    render();
    if (!errors.length) message("OSCAL schema and reference checks passed.");
  });
  on("export", async () => {
    errors = (
      await api(`ssps/${current!.sspId}/validate`, "POST", {
        oscal: current!.oscal,
      })
    ).errors;
    if (errors.length) {
      render();
      throw Error("Resolve validation errors before export");
    }
    download("ssp.json", current!.oscal);
  });
  on("history-prev", async () => { revisionPages.pop(); await loadRevisionPage(); render(); });
  on("history-next", async () => { revisionPages.push(revisionNext); await loadRevisionPage(); render(); });
  on("export-baseline", () => download("pinned-content.json", baseline));
  document.querySelectorAll<HTMLElement>("[data-revision]").forEach(
    (e) =>
      (e.onclick = () =>
        void run(async () => {
          const r = await api(
            `ssps/${current!.sspId}/revisions/${e.dataset.revision}`,
          );
          download(`ssp-revision-${r.revision}.json`, r.oscal);
        })),
  );
}
async function save() {
  systemComponent(body());
  // Persist the same section/component roll-up that the user reviewed, including
  // statement-specific contributions from selected published components.
  for (const row of rows()) {
    const req = requirement(body(), row.control.id);
    applyComponentStatements(body(), req, row.control, baseline.components, false);
  }
  errors = validate(current!.oscal);
  if (errors.length) {
    tab = "OSCAL / Validation";
    render();
    throw Error("Resolve validation errors before saving");
  }
  current = await api("ssps/" + current!.sspId, "PUT", {
    oscal: current!.oscal,
  });
  dirty = false;
  revisionPages = [undefined]; await loadRevisionPage();
  render();
  message("Saved as immutable revision " + current!.currentRevision);
}
function download(name: string, data: any) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser time to begin reading the Blob before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
async function start() {
  let config: any;
  try {
    const response = await fetch("/config.json", {cache:"no-store"});
    if (!response.ok) throw Error("Missing deployment configuration");
    config = await response.json();
  } catch {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      config = await (await fetch("/api/config")).json();
    else throw Error("Deployment configuration missing");
  }
  demo =
    config.localDemo === true &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!demo) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.tenantId) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.clientId)) throw Error('Invalid deployment sign-in configuration');
    scopes = [`api://${config.clientId}/access_as_user`];
    msal = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: location.origin + "/",
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await msal.initialize();
    const redirect = await msal.handleRedirectPromise();
    const accounts = msal.getAllAccounts();
    msal.setActiveAccount(redirect?.account || (accounts.length === 1 ? accounts[0] : null));
    if (!msal.getActiveAccount()) {
      layout(
        '<section class="login"><div class="eyebrow">SECURITY PLANNING, CONNECTED</div><h1>A clear record of your<br>system security.</h1><p>Sign in with your company account to create and maintain security plans.</p><button id="signin">Sign in with Microsoft</button></section>',
      );
      document
        .querySelector("#signin")!
        .addEventListener("click", () => msal!.loginRedirect({ scopes, prompt: "select_account" }));
      return;
    }
  }
  user = await api("me");
  await home();
}
layout("<section><h1>Opening your workspace…</h1></section>");
void run(start);

// A restored browser history page must recheck authorization before displaying SSPs.
window.addEventListener("pageshow", event => { if (event.persisted) { clearSession(); location.reload(); } });
