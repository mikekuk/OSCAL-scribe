import { escapeHtml as h } from "../shared/lens/views.mjs";
import type { Person } from "../shared/types";
export function personLabel(oid: string, person?: Person): string {
  const contact = person?.email || person?.userPrincipalName;
  return `<span>${h(person?.displayName || "User unavailable")}${contact ? ` <small>(${h(contact)})</small>` : ""}${person?.guest ? " · Guest" : ""}</span><details><summary>Identity details</summary><code>${h(oid)}</code></details>`;
}
/** Search results never grant access themselves. Selection supplies only the ID
 * and the server revalidates it when sharing. Generation checks discard stale replies. */
export function mountPeoplePicker(root: HTMLElement, search: (query: string) => Promise<Person[]>) {
  root.innerHTML = '<label class="field">Find a person<input type="search" id="person-query" autocomplete="off" placeholder="Start typing a name or email" aria-describedby="person-search-status"></label><p id="person-search-status" role="status" aria-live="polite">Type at least 3 characters. Search matches the start of a name, email or sign-in name.</p><div id="person-results" class="person-results"></div><p id="person-selected"></p>';
  const input = root.querySelector<HTMLInputElement>("input")!, results = root.querySelector<HTMLElement>("#person-results")!, status = root.querySelector<HTMLElement>("#person-search-status")!, selected = root.querySelector<HTMLElement>("#person-selected")!;
  let choice: Person | undefined, generation = 0, timer: ReturnType<typeof setTimeout>;
  input.oninput = () => {
    const current = ++generation, query = input.value.trim();
    clearTimeout(timer); choice = undefined; selected.textContent = ""; results.replaceChildren();
    if (query.length < 3) { status.textContent = "Type at least 3 characters."; return; }
    if (query.length > 100) { status.textContent = "Use no more than 100 characters."; return; }
    status.textContent = "Searching…";
    timer = setTimeout(async () => {
      if (!root.isConnected) return;
      try {
        const people = await search(query);
        if (generation !== current || !root.isConnected) return;
        status.textContent = people.length ? `${people.length} matches${people.length === 20 ? " — refine your search if needed" : ""}. Select a person below.` : "No matching people. Guests must already exist in this tenant.";
        for (const person of people) {
          const button = document.createElement("button"); button.type = "button"; button.className = "quiet";
          button.textContent = `${person.displayName} · ${person.email || person.userPrincipalName || person.oid}${person.guest ? " · Guest" : ""}`;
          button.onclick = () => { choice = person; results.replaceChildren(); selected.textContent = "Selected: " + button.textContent; status.textContent = "Choose Read or Edit, then Share."; };
          results.append(button);
        }
      } catch (error) { if (generation === current && root.isConnected) status.textContent = (error as Error).message; }
    }, 350);
  };
  return () => choice;
}
