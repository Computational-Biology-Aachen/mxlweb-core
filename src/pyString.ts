import type { SliderArgs } from "./modelBuilderBase.js";

/** `s` as a Python string literal — JSON string syntax is valid Python, escapes included. */
export function pyString(s: string): string {
  return JSON.stringify(s);
}

/** `Slider(min="…", max="…", step="…"[, desc="…"])` — an mxlpy slider configuration. */
function pySlider(slider: SliderArgs): string {
  return `Slider(${[
    ["min", slider.min],
    ["max", slider.max],
    ["step", slider.step],
    ["desc", slider.desc],
  ]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${pyString(v!)}`)
    .join(", ")})`;
}

/**
 * `, unit="…", display_name="…", tex_name="…", slider=Slider(…)` — the keyword
 * arguments for whichever of these `entity` sets, each prefixed by `sep`. A
 * module using a slider must import `Slider` from mxlpy ({@link usesSlider}).
 */
export function pyMetaKwargs(
  entity: {
    unit?: string;
    displayName?: string;
    texName?: string;
    slider?: SliderArgs;
  },
  sep = ", ",
): string {
  const kwargs = [
    ["unit", entity.unit],
    ["display_name", entity.displayName],
    ["tex_name", entity.texName],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${sep}${k}=${pyString(v!)}`);
  if (entity.slider !== undefined) {
    kwargs.push(`${sep}slider=${pySlider(entity.slider)}`);
  }
  return kwargs.join("");
}

/** Whether any of `entities` carries a slider, i.e. the module needs `Slider`. */
export function usesSlider(
  entities: Iterable<{ slider?: SliderArgs }>,
): boolean {
  for (const e of entities) if (e.slider !== undefined) return true;
  return false;
}
