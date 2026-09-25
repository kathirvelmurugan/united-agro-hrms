/**
 * CSV sanitization for CWE-1236 / CSV Formula Injection.
 * Prefixes formula trigger characters (= + - @, tab, carriage return) with a single quote
 * so Excel/Sheets treat the cell as text, not a formula.
 */
export function csvSanitize(value: unknown): string {
  const s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export function csvEscape(value: unknown): string {
  const s = csvSanitize(value).replace(/"/g, '""');
  return `"${s}"`;
}
