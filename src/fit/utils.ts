export function arrayColumn<T>(arr: Array<Array<T>>, n: number): Array<T> {
  return arr.map((x) => x[n]);
}

/**
 * Serialize a map of CSS custom-property overrides into an inline `style`
 * attribute value, e.g. `{ "--foo": "1px" }` -> `"--foo:1px"`. Skips
 * undefined values so callers can spread optional overrides directly in.
 */
export function toStyleString(
  vars: Record<string, string | undefined>,
): string {
  return Object.entries(vars)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
