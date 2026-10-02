import { PublicClientApplication } from "@azure/msal-browser";
import { escapeHtml as h, renderControls } from "../shared/lens/views.mjs";
import { substituteParameters } from "../shared/lens/parameters.mjs";
import { flatten, preview } from "../shared/lens/engine.mjs";
import { roles, uuid, statementParts, reviewStatus } from "../shared/oscal";
import { validate } from "./validation";
import type { Json, Ssp, User } from "../shared/types";
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
  controlIndex = 0,
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
    return `<p>Assign the people accountable for this system. These assignments do not grant access to Scribe.</p>${roles
      .map(([id, title]) => {
        const r = b.metadata["responsible-parties"]?.find(
            (r: Json) => r["role-id"] === id,
          ),
          party = b.metadata.parties?.find(
            (p: Json) => p.uuid === r?.["party-uuids"]?.[0],
          );
        return `<section><h3>${title}</h3><div class="form-grid"><label class="field">Full name<input data-person="${id}" data-kind="name" value="${h(party?.name || "")}" ${editable() ? "" : "disabled"}></label><label class="field">Email<input type="email" data-person="${id}" data-kind="email" value="${h(party?.["email-addresses"]?.[0] || "")}" ${editable() ? "" : "disabled"}></label></div></section>`;
      })
      .join("")}`;
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
    return `<p>Attestation records an exact saved revision and its SHA-256 digest. Later changes require a new attestation.</p><div class="stats">${info("Review status", reviewStatus(s))}${info("Attested revision", s.lastAttestation?.revision)}${info("Next review", s.lastAttestation?.due)}</div>${administer() ? `<label class="field">Attesting system role<select id="attest-role">${roles.map(([id, title]) => `<option value="${id}">${title}</option>`).join("")}</select></label><button id="attest" ${dirty || s.archived ? "disabled" : ""}>Attest saved revision ${s.currentRevision}</button>` : ""}<h3>Immutable revision history</h3>${history
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
  controlIndex = Math.min(controlIndex, rr.length - 1);
  const row = rr[controlIndex],
    b = body(),
    requirements = b["control-implementation"]["implemented-requirements"],
    index = requirements.findIndex(
      (r: Json) => r["control-id"] === row.control.id,
    ),
    req = requirements[index],
    base = `control-implementation/implemented-requirements/${index}`;
  return `<div class="control-toolbar"><label class="field">Find a control<input id="control-search" placeholder="ID or title"></label><label class="field">Applicable control<select id="control-select">${rr.map((r: any, i: number) => `<option value="${i}" ${i === controlIndex ? "selected" : ""}>${h(r.control.id.toUpperCase() + " — " + r.control.title)}</option>`).join("")}</select></label></div><div class="requirement"><div class="eyebrow">AUTHORITATIVE REQUIREMENT</div><p class="legend">Catalogue text · <span class="profile-changed">Profile changes</span> · ODPs retain their assignment state</p>${renderControls("catalog", { rows: [row], sources: [], notes: [] }, null, 0, "", "", { parameters: false })}</div><section class="implementation"><div class="eyebrow">SYSTEM IMPLEMENTATION</div><h3>How does your system meet this requirement?</h3>${field("Implementation status", base + "/props/0/value", "select", ["planned", "partial", "implemented", "not-applicable"])}${field("Implementation description", base + "/by-components/0/description", "textarea")}${field("Remarks", base + "/remarks", "textarea")}<label class="field">Responsible system role<select id="req-role" ${editable() ? "" : "disabled"}><option value="">Unassigned</option>${roles.map(([id, title]) => `<option value="${id}" ${req["responsible-roles"]?.[0]?.["role-id"] === id ? "selected" : ""}>${title}</option>`).join("")}</select></label><h3>Component implementation</h3>${b[
    "system-implementation"
  ].components
    .slice(1)
    .map((c: Json) => {
      const bc = req["by-components"]?.find(
        (x: Json) => x["component-uuid"] === c.uuid,
      );
      return `<label class="field">${h(c.title)}<textarea data-bycomponent="${h(c.uuid)}" ${editable() ? "" : "disabled"}>${h(bc?.description || "")}</textarea></label>`;
    })
    .join("")}<h3>Statement implementation</h3>${statementParts(row.control)
    .map((p) => {
      const stmt = req.statements?.find(
        (x: Json) => x["statement-id"] === p.id,
      );
      return `<label class="field">${h(p.props?.find((x: Json) => x.name === "label")?.value || p.id)}<small>${substituteParameters(p.prose, row.parameters)}</small><textarea data-statement="${h(p.id)}" ${editable() ? "" : "disabled"}>${h(stmt?.["by-components"]?.[0]?.description || "")}</textarea></label>`;
    })
    .join("")}<h3>System parameter assignments</h3>${Object.values(
    row.parameters,
  )
    .map(
      (p: any) =>
        `<label class="field">${h(p.id)} · ${h(p.label || "Organization-defined value")}<small>Profile: ${h(p.values?.join("; ") || p.select?.choice?.join("; ") || "No assigned value")}</small><input data-parameter="${h(p.id)}" value="${h(req["set-parameters"]?.find((x: Json) => x["param-id"] === p.id)?.values?.join("; ") || "")}" placeholder="Separate multiple values with ;" ${editable() ? "" : "disabled"}></label>`,
    )
    .join("")}</section>`;
}
function activeReq() {
  return body()["control-implementation"]["implemented-requirements"].find(
    (r: Json) => r["control-id"] === rows()[controlIndex].control.id,
  );
}
function bind() {
  document.querySelectorAll<HTMLInputElement>("[data-person]").forEach(
    (e) =>
      (e.oninput = () => {
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
        } else {
          body()["system-implementation"].components = list.filter(
            (c: Json) => c.uuid !== id,
          );
          for (const r of body()["control-implementation"][
            "implemented-requirements"
          ]) {
            r["by-components"] = r["by-components"]?.filter(
              (c: Json) => c["component-uuid"] !== id,
            );
            if (!r["by-components"]?.length) delete r["by-components"];
          }
        }
        mark();
        render();
      }),
  );
  const select = document.querySelector<HTMLSelectElement>("#control-select");
  if (select)
    select.onchange = () => {
      controlIndex = Number(select.value);
      render();
    };
  const search = document.querySelector<HTMLInputElement>("#control-search");
  if (search)
    search.oninput = () => {
      for (const o of select!.options)
        // Keep the displayed selection consistent with the implementation being edited.
        o.hidden = !o.selected && !o.text.toLowerCase().includes(search.value.toLowerCase());
    };
  const role = document.querySelector<HTMLSelectElement>("#req-role");
  if (role)
    role.onchange = () => {
      const r = activeReq();
      if (role.value) r["responsible-roles"] = [{ "role-id": role.value }];
      else delete r["responsible-roles"];
      mark();
    };
  document.querySelectorAll<HTMLInputElement>("[data-parameter]").forEach(
    (e) =>
      (e.oninput = () => {
        const r = activeReq(),
          id = e.dataset.parameter!;
        r["set-parameters"] = (r["set-parameters"] || []).filter(
          (p: Json) => p["param-id"] !== id,
        );
        if (e.value.trim())
          r["set-parameters"].push({
            "param-id": id,
            values: e.value
              .split(";")
              .map((v) => v.trim())
              .filter(Boolean),
          });
        if (!r["set-parameters"].length) delete r["set-parameters"];
        mark();
      }),
  );
  document.querySelectorAll<HTMLTextAreaElement>("[data-bycomponent]").forEach(
    (e) =>
      (e.oninput = () => {
        const r = activeReq(),
          id = e.dataset.bycomponent!;
        r["by-components"] = (r["by-components"] || []).filter(
          (x: Json) => x["component-uuid"] !== id,
        );
        if (e.value.trim())
          r["by-components"].push({
            uuid: uuid(),
            "component-uuid": id,
            description: e.value,
          });
        if (!r["by-components"].length) delete r["by-components"];
        mark();
      }),
  );
  document.querySelectorAll<HTMLTextAreaElement>("[data-statement]").forEach(
    (e) =>
      (e.oninput = () => {
        const r = activeReq(),
          id = e.dataset.statement!;
        r.statements = (r.statements || []).filter(
          (x: Json) => x["statement-id"] !== id,
        );
        if (e.value.trim())
          r.statements.push({
            uuid: uuid(),
            "statement-id": id,
            "by-components": [
              {
                uuid: uuid(),
                "component-uuid":
                  body()["system-implementation"].components[0].uuid,
                description: e.value,
              },
            ],
          });
        if (!r.statements.length) delete r.statements;
        mark();
      }),
  );
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
