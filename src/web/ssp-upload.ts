import { escapeHtml as h } from "../shared/lens/views.mjs";
// Reused by ordinary home and App Admin's paged Plans view.
export const uploadHelp = `
  <h2>Upload a previously downloaded SSP</h2>
  <ul><li>Choose an OSCAL SSP <strong>JSON file downloaded from Scribe</strong>, including a downloaded saved revision. PDF, XML, ZIP and raw Cosmos record wrappers are not supported.</li>
  <li>The file must use supported OSCAL version <strong>1.2.2</strong> and be no larger than <strong>1 MB</strong>.</li>
  <li>Its original published content release and profile must still exist in this environment. A different active baseline is fine; the upload keeps its original baseline. If missing, ask an administrator to restore or publish the exact source release.</li>
  <li>Keep the original <code>import-profile</code> reference, all required controls and valid component/party references. The SSP needs one <code>this-system</code> component. Validation explains any rejected content.</li>
  <li>Upload creates a <strong>new copy owned by you</strong>, with a new document ID and revision 1. Existing plans are not overwritten. Sharing, app audit history and app attestations are not restored; review and share the new plan as needed.</li>
  <li>Implementation narratives, statuses, components and OSCAL metadata are preserved, apart from the new document identity/version/time and an import-source link. Uploaded implementation claims have not been independently verified.</li></ul>`;
export function showSspUpload(layout: (html: string) => void, api: (path: string, method?: string, body?: any) => Promise<any>, open: (id: string) => Promise<void>, back: () => Promise<void>) {
  layout(`<div class="page-title"><h1>Upload an SSP</h1><button id="upload-help" class="quiet">What can I upload?</button></div><p>Restore a downloaded SSP as a new copy. Review the file and baseline before importing.</p><section><label class="field">OSCAL SSP JSON file<input id="ssp-file" type="file" accept=".json,application/json"></label><button id="ssp-review">Check file</button><div id="ssp-preview" role="status" aria-live="polite"></div><div class="inline"><button id="ssp-import" disabled>Import as a new copy</button><button id="ssp-cancel" class="quiet">Back to plans</button></div></section><dialog id="ssp-help" aria-label="SSP upload requirements">${uploadHelp}<button id="ssp-help-close">Close help</button></dialog>`);
  const fileInput = document.querySelector<HTMLInputElement>("#ssp-file")!, review = document.querySelector<HTMLButtonElement>("#ssp-review")!, submit = document.querySelector<HTMLButtonElement>("#ssp-import")!, preview = document.querySelector<HTMLElement>("#ssp-preview")!, dialog = document.querySelector<HTMLDialogElement>("#ssp-help")!;
  let doc: any, generation = 0;
  document.querySelector<HTMLButtonElement>("#upload-help")!.onclick = () => dialog.showModal();
  document.querySelector<HTMLButtonElement>("#ssp-help-close")!.onclick = () => dialog.close();
  document.querySelector<HTMLButtonElement>("#ssp-cancel")!.onclick = () => { void back(); };
  fileInput.onchange = () => { generation++; doc = undefined; submit.disabled = true; preview.textContent = ""; };
  const errorText = (error: any) => [error.message, ...(Array.isArray(error.details) ? error.details : [])].join("\n");
  review.onclick = async () => {
    const current = ++generation; doc = undefined; submit.disabled = true; review.disabled = true;
    try {
      const file = fileInput.files?.[0];
      if (!file) throw Error("Choose an SSP JSON file first.");
      if (file.size > 1_000_000) throw Error("This file exceeds the 1 MB upload limit.");
      let candidate: any;
      try { candidate = JSON.parse(await file.text()); } catch { throw Error("The file is not valid JSON. Upload the OSCAL JSON download."); }
      preview.textContent = "Checking SSP and original baseline…";
      const result = await api("ssps/import/preview", "POST", { oscal: candidate });
      if (current !== generation || !preview.isConnected) return;
      doc = candidate;
      preview.innerHTML = `<h3>${h(result.systemName)}</h3><p>${h(result.title)}</p><p>Baseline: ${h(result.profileTitle)}</p><p>Original release: <code>${h(result.releaseId)}</code></p><p>Ready to import as a new private plan owned by you. Saved history starts at revision 1.</p>`;
      submit.disabled = false;
    } catch (error) { if (current === generation) preview.textContent = errorText(error); }
    finally { review.disabled = false; }
  };
  submit.onclick = async () => {
    if (!doc) return;
    submit.disabled = true; review.disabled = true; fileInput.disabled = true;
    try {
      const plan = await api("ssps/import", "POST", { oscal: doc });
      // After a successful write never re-enable import if opening the editor fails.
      doc = undefined;
      preview.textContent = "Imported successfully. The new plan is available from Plans.";
      await open(plan.sspId);
    } catch (error) { preview.textContent = errorText(error); if (doc) submit.disabled = false; }
    finally { review.disabled = false; fileInput.disabled = false; }
  };
}
