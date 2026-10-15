/**
 * Fit-to-data UI shared by the mxl-web and green-sloth sites: the {@link Fit}
 * popover component plus the curriculum/config/CSV helpers it (and mxl-web's
 * UDE/NDE showcases) build on.
 *
 * Svelte-only and Vite-only (Svelte components, `?worker&url` imports via
 * `./workers`), so this subpath is excluded from the package's `tsc` build
 * and only exposed under the `svelte` export condition — consumers compile it
 * from source.
 *
 * @module
 */

export { default as Fit } from "./Fit.svelte";
export {
  default as FitLineChart,
  type PhaseRegion,
} from "./FitLineChart.svelte";
export { default as CurriculumStagesEditor } from "./CurriculumStagesEditor.svelte";
export { default as SimErrDisplay } from "./SimErrDisplay.svelte";
export * from "./curriculum";
export * from "./curriculumRunner";
export * from "./fitConfig";
export * from "./csvParse";
export * from "./random";
export * from "./types";
export * from "./utils";
