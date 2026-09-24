/**
 * HTML templating with escaping on by default.
 *
 * Customer messages are untrusted input. Every value interpolated into the
 * `html` template is escaped unless it is itself the output of `html` or
 * `raw`, so a message like `<script>` shows up as text instead of running
 * in the dashboard.
 */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

type Value = SafeHtml | string | number | boolean | null | undefined | readonly Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map((item) => render(item)).join("");
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, index) => {
    out += render(value) + (strings[index + 1] ?? "");
  });
  return new SafeHtml(out);
}

/** Marks trusted markup. Never pass user input to this. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}
