// Control characters other than tab, newline and carriage return.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Normalises untrusted text from users or the model: removes control and
 * zero-width characters, collapses runs of whitespace and trims. The result
 * is still plain text — it is always rendered as text, never as HTML.
 */
export function cleanText(value: string, { multiline = false } = {}): string {
  const stripped = value.normalize('NFC').replace(CONTROL_CHARS, '').replace(ZERO_WIDTH, '');
  if (multiline) {
    return stripped
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

/** Truncates at a word boundary, adding an ellipsis when cut. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
