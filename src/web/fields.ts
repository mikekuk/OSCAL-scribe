import { escapeHtml } from "../shared/lens/views.mjs";

/** Render a bound form field. Values and labels are always escaped as text. */
export function renderField(
  label: string,
  path: string,
  value: unknown,
  canEdit: boolean,
  kind = "text",
  choices: string[] = [],
) {
  const binding = `data-path="${escapeHtml(path)}" ${canEdit ? "" : "disabled"}`;
  const escapedValue = escapeHtml(value ?? "");
  let input: string;

  if (kind === "textarea") {
    input = `<textarea ${binding}>${escapedValue}</textarea>`;
  } else if (kind === "select") {
    const options = choices
      .map(
        (choice) =>
          `<option ${value === choice ? "selected" : ""}>${escapeHtml(choice)}</option>`,
      )
      .join("");
    input = `<select ${binding}>${options}</select>`;
  } else {
    input = `<input type="${kind}" ${binding} value="${escapedValue}">`;
  }

  return `<label class="field">${escapeHtml(label)}${input}</label>`;
}
