import { PublicClientApplication } from "@azure/msal-browser";
import { escapeHtml as h } from "../shared/lens/views.mjs";
import { flatten, preview } from "../shared/lens/engine.mjs";
import { uuid, statementParts, reviewStatus } from "../shared/oscal";
import { validate } from "./validation";
import type { Json, Ssp, User } from "../shared/types";
import { addRole, removeRole, effectiveRequirement, requirement, ensureStatement, setDescription, setSectionStatus, progress, prop, setProp, syncProgress, contributionList, removeComponent } from "../shared/implementation";
import { filterControls, renderControlCards } from "./control-view";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
let msal: PublicClientApplication | undefined,
  scopes: string[] = [],
  demo = false,
  user: User,
  approved: any,
  current: Ssp | undefined,
  baseline: any,
  tab = "Overview",
  controlQuery = "",
  controlGroup = "",
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
const body = () => current!.oscal["system-security-plan"];
async function api(path: string, method = "GET", data?: any) {
  let token = "";
  if (msal) {
    const account = msal.getAllAccounts()[0];
    if (!account) throw Error("Please sign in");
    try {
      token = (await msal.acquireTokenSilent({ account, scopes })).accessToken;
    } catch {
      await msal.acquireTokenRedirect({ account, scopes });
      throw Error("Sign-in required");
    }
  }
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(current ? { "If-Match": String(current.version) } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await r.json();
  if (!r.ok) throw Error([result.error, ...(result.details || [])].join("\n"));
  return result;
}
const editable = () =>
  current &&
  !current.archived &&
  (current.ownerId === user.oid ||
    user.roles.includes("Security") ||
    current.access.some((a) => a.oid === user.oid && a.permission === "edit"));
const administer = () =>
  current && (current.ownerId === user.oid || user.roles.includes("Security"));
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
  app.innerHTML = `<header><a href="#" id="home"><span class="logo">S</span> OSCAL <b>Scribe</b></a><span class="header-note">SECURITY PLANNING WORKSPACE</span><span>${demo ? "LOCAL DEMO · NOT SAVED" : h(user?.oid?.slice(0, 8) || "")} ${msal ? '<button id="logout" class="quiet">Sign out</button>' : ""}</span></header>${demo ? '<div class="demo">Fictional test environment. Data is held in memory and clears when the demo server restarts.</div>' : ""}<main>${content}</main><div id="message" role="status" aria-live="polite"></div>`;
  document.querySelector("#home")?.addEventListener("click", (e) => {
    e.preventDefault();
    void run(home);
  });
  document
    .querySelector("#logout")
    ?.addEventListener("click", () => msal?.logoutRedirect());
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
    message((e as Error).message, true);
  }
}
async function home() {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  current = undefined;
  dirty = false;
  list = await api("ssps");
  approved = await api("content");
  renderHome();
}
function renderHome() {
  layout(
    `<div class="eyebrow">YOUR ASSURANCE LIBRARY</div><div class="page-title"><div><h1>System security plans</h1><p>Describe your systems. Connect controls to implementation. Keep a clear record.</p></div><button id="new">＋ Create a plan</button></div><div class="stats">${info("PLANS", list.length)}${info("REVIEW NEEDED", list.filter((x) => reviewStatus(x) !== "Attested").length)}${info("APPROVED BASELINES", approved.profiles.length)}</div><section id="new-form" hidden><h2>Create a system security plan</h2><label class="field">System name<input id="system-name" maxlength="200"></label><label class="field">Approved baseline<select id="profile">${approved.profiles.map((p: any) => `<option value="${h(p.id)}">${h(p.title)}</option>`).join("")}</select></label><button id="create">Create plan</button></section><div class="plans">${list.length ? list.map((s) => `<button class="plan-card" data-open="${h(s.sspId)}"><span class="pill">${h(s.archived ? "Archived" : reviewStatus(s))}</span><h2>${h(s.systemName)}</h2><p>${h(s.profileId)} · Revision ${s.currentRevision}</p><small>Updated ${h(new Date(s.modifiedAt).toLocaleDateString())}</small><span class="arrow">↗</span></button>`).join("") : '<section class="empty"><h2>Your first plan starts with a baseline.</h2><p>Choose an approved profile and Scribe creates a workspace for every applicable control.</p></section>'}</div>`,
  );
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
  baseline = await api(`content/${current!.releaseId}/${current!.profileId}`);
  rowCache = undefined;
  controlQuery = "";
  controlGroup = "";
  openCards.clear();
  history = await api(`ssps/${id}/revisions`);
  tab = "Overview";
  dirty = false;
  errors = [];
  render();
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
    return `<div class="form-grid">${field("System name", "system-characteristics/system-name")}${field("Plan title", "metadata/title")}${field("System status", "system-characteristics/status/state", "select", ["under-development", "operational", "under-major-modification", "disposition", "other"])}${field("System description", "system-characteristics/description", "textarea")}</div><div class="metadata-grid">${info("Owner (Entra object ID)", s.ownerId)}${info("Created", s.createdAt)}${info("Modified", s.modifiedAt)}${info("Last attested", s.lastAttestation?.at)}${info("Next attestation due", s.lastAttestation?.due)}</div>${administer() ? `<hr><h3>Sharing</h3><p>Use the person's immutable object ID from this Entra tenant. They must also be assigned to the application.</p><div class="inline"><input id="share-oid" aria-label="Entra object ID" placeholder="Entra object ID"><select id="share-permission" aria-label="Permission"><option value="read">Read</option><option value="edit">Edit</option></select><button id="share">Share</button></div>${s.access.map((a) => `<p>${h(a.oid)} · ${a.permission} <button class="quiet" data-revoke="${h(a.oid)}">Remove access</button></p>`).join("")}<hr><button id="archive" class="quiet" ${s.archived ? "disabled" : ""}>Archive this plan</button>` : ""}`;
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
  if (tab === "Components")
    return `<p>Select approved shared services. Their published contribution stays read-only; record this system's use separately.</p>${baseline.components
      .flatMap((d: Json) => d["component-definition"].components || [])
      .map((c: Json) => {
        const i = b["system-implementation"].components.findIndex(
          (x: Json) => x.uuid === c.uuid,
        );
        return `<section><label class="component-title"><input type="checkbox" data-component="${h(c.uuid)}" ${i >= 0 ? "checked" : ""} ${editable() ? "" : "disabled"}> ${h(c.title)}</label><p>${h(c.description)}</p><details><summary>Published control contributions</summary>${c["control-implementations"]?.flatMap((ci: Json) => ci["implemented-requirements"].map((r: Json) => `<p><b>${h(r["control-id"])}</b> ${h(r.description)}</p>`)).join("")}</details>${i >= 0 ? field("How this system uses the service", `system-implementation/components/${i}/remarks`, "textarea") : ""}</section>`;
      })
      .join("")}`;
  if (tab === "Controls / Implementation") return controls();
  if (tab === "Attestation & History")
    return `<p>Attestation records an exact saved revision and its SHA-256 digest. Later changes require a new attestation.</p><div class="stats">${info("Review status", reviewStatus(s))}${info("Attested revision", s.lastAttestation?.revision)}${info("Next review", s.lastAttestation?.due)}</div>${administer() ? `<label class="field">Attesting system role<select id="attest-role">${(b.metadata.roles || []).map((r: Json) => `<option value="${h(r.id)}">${h(r.title)}</option>`).join("")}</select></label><button id="attest" ${dirty || s.archived || !b.metadata.roles?.length ? "disabled" : ""}>Attest saved revision ${s.currentRevision}</button>` : ""}<h3>Immutable revision history</h3>${history
      .sort((a, b) => b.revision - a.revision)
      .map(
        (r) =>
          `<section class="revision"><b>Revision ${r.revision}</b><span>${h(new Date(r.at).toLocaleString())}</span><small>Actor ${h(r.actor)}</small><button data-revision="${r.revision}" class="quiet">Download revision</button></section>`,
      )
      .join("")}`;
  return `<p>Schema validation checks structure and references. It does not certify that controls are effective.</p><button id="validate">Validate plan</button> <button id="export">Download OSCAL SSP</button> <button id="export-baseline" class="quiet">Download pinned baseline</button><div class="validation" role="status">${errors.length ? errors.map((e) => `<p>${h(e)}</p>`).join("") : "Run validation to check the current document."}</div><details><summary>Inspect OSCAL JSON</summary><pre>${h(JSON.stringify(current!.oscal, null, 2))}</pre></details>`;
}
function controls() {
  const rr = rows();
  const groups = new Map<string, string>();
  rr.forEach(row => row.groups.forEach((g: Json) => groups.set(g.id || g.title, g.title || g.id)));
  return `<div class="control-toolbar"><label class="field">Find controls<input id="control-search" type="search" value="${h(controlQuery)}" placeholder="ID, title or requirement text"></label><label class="field">Control group<select id="control-group"><option value="">All groups</option>${[...groups].map(([id, title]) => `<option value="${h(id)}" ${controlGroup === id ? "selected" : ""}>${h(title)}</option>`).join("")}</select></label></div><div class="control-actions"><span id="control-count" role="status" aria-live="polite"></span><button id="expand-controls" class="quiet">Expand all</button><button id="collapse-controls" class="quiet">Collapse all</button></div><p class="status-legend"><span class="status-not-set">Not set</span><span class="status-partial">Partial</span><span class="status-implemented">Implemented</span><span class="status-alternative">Alternative</span><span class="status-component">By component</span><span class="status-not-applicable">N/A</span></p><div id="control-cards">${renderControlCards(body(), rr, baseline.components, !!editable(), openCards)}</div><p id="no-controls" hidden>No controls match these filters.</p>`;
}
function applyControlFilter() {
  const matches = new Set(filterControls(rows(), controlGroup, controlQuery).map(r => r.control.id));
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
            remarks:
              "Describe onboarding, scope and remaining system responsibilities.",
          });
          // Selecting a shared service imports its declared contribution. Unknown
          // or partial coverage stays partial; existing user section decisions win.
          for (const row of rows()) {
            const r = requirement(body(), row.control.id);
            if (!contributionList(body(), baseline.components, row.control.id).some(x => x.component.uuid === id)) continue;
            for (const part of statementParts(row.control)) {
              const existing = r.statements?.find((x: Json) => x["statement-id"] === part.id);
              if (!prop(existing || {}, "implementation-status"))
                setSectionStatus(body(), r, row.control, part.id, "component:" + id, baseline.components);
            }
          }
        } else {
          removeComponent(body(), id, rows());
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
  const systemId = body()["system-implementation"].components[0].uuid;
  const search = document.querySelector<HTMLInputElement>("#control-search");
  if (search) search.oninput = () => { controlQuery = search.value; applyControlFilter(); };
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
    setSectionStatus(body(), reqFor(e), controlFor(e), e.dataset.sectionStatus!, e.value, baseline.components);
    mark(); render();
  }));
  document.querySelectorAll<HTMLSelectElement>("[data-completion]").forEach(e => e.onchange = () => void run(() => {
    if (!editable()) return;
    const req = reqFor(e), control = controlFor(e);
    if (e.value === "implemented" && !progress(req, control).allComplete) throw Error("Complete every required section first");
    setProp(req, "completion-decision", e.value === "auto" ? undefined : e.value);
    syncProgress(req, control); mark(); render();
  }));
  document.querySelectorAll<HTMLSelectElement>("[data-req-role]").forEach(e => e.onchange = () => {
    if (!editable()) return;
    const req = reqFor(e);
    if (e.value) req["responsible-roles"] = [{ "role-id": e.value }];
    else delete req["responsible-roles"];
    mark();
  });
  document.querySelectorAll<HTMLTextAreaElement>("[data-system-description], [data-bycomponent], [data-statement], [data-statement-remarks], [data-control-remarks]").forEach(e => e.oninput = () => {
    if (!editable()) return;
    const req = reqFor(e);
    if (e.hasAttribute("data-control-remarks")) { if (e.value) req.remarks = e.value; else delete req.remarks; }
    else if (e.dataset.statementRemarks) {
      const statement = ensureStatement(req, e.dataset.statementRemarks);
      if (e.value) statement.remarks = e.value; else delete statement.remarks;
    } else {
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
  on("share", async () => {
    if (dirty) throw Error("Save your edits before changing sharing");
    current = await api(`ssps/${current!.sspId}/share`, "POST", {
      oid: (document.querySelector("#share-oid") as HTMLInputElement).value,
      permission: (
        document.querySelector("#share-permission") as HTMLSelectElement
      ).value,
    });
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
  // Persist the same section/component roll-up that the user reviewed, including
  // conservative contributions from older published components.
  for (const row of rows()) {
    const req = requirement(body(), row.control.id);
    Object.assign(req, effectiveRequirement(body(), req, row.control, baseline.components));
    if (prop(req, "status-tracking")) syncProgress(req, row.control);
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
  history = await api(`ssps/${current!.sspId}/revisions`);
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
  a.click();
  URL.revokeObjectURL(url);
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
async function start() {
  let config: any;
  try {
    config = await (await fetch("/config.json")).json();
  } catch {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      config = await (await fetch("/api/config")).json();
    else throw Error("Deployment configuration missing");
  }
  demo =
    config.localDemo === true &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!demo) {
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
    await msal.handleRedirectPromise();
    if (!msal.getAllAccounts().length) {
      layout(
        '<section class="login"><div class="eyebrow">SECURITY PLANNING, CONNECTED</div><h1>A clear record of your<br>system security.</h1><p>Sign in with your company account to create and maintain security plans.</p><button id="signin">Sign in with Microsoft</button></section>',
      );
      document
        .querySelector("#signin")!
        .addEventListener("click", () => msal!.loginRedirect({ scopes }));
      return;
    }
  }
  user = await api("me");
  await home();
}
layout("<section><h1>Opening your workspace…</h1></section>");
void run(start);
