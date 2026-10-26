/** `s` as a Python string literal — JSON string syntax is valid Python, escapes included. */
export function pyString(s: string): string {
  return JSON.stringify(s);
}

/** `, unit="…", display_name="…", tex_name="…"` — the keyword arguments for whichever of the three `entity` sets, each prefixed by `sep`. */
export function pyMetaKwargs(
  entity: { unit?: string; displayName?: string; texName?: string },
  sep = ", ",
): string {
  return [
    ["unit", entity.unit],
    ["display_name", entity.displayName],
    ["tex_name", entity.texName],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${sep}${k}=${pyString(v!)}`)
    .join("");
}
