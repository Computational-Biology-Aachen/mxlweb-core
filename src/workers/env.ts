/**
 * Runtime configuration shared by every worker wrapper in this module.
 *
 * Kept framework-agnostic on purpose: the consuming site (a SvelteKit app,
 * typically) calls {@link setWorkerBasePath} once with its own base path
 * (`resolve("/")` from `$app/paths`) before the first worker is created.
 * Each worker appends `/wasm/...` itself when loading its Emscripten runtime.
 *
 * @module
 */

/** True in a browser main thread — false during SSR/prerender. */
export const isBrowser = typeof window !== "undefined";

let basePath = "";

/** Sets the site base path handed to every worker on `__INIT__`. A trailing
 * slash is stripped, since workers append `/wasm/...` themselves. */
export function setWorkerBasePath(path: string): void {
  basePath = path.replace(/\/$/, "");
}

export function getWorkerBasePath(): string {
  return basePath;
}
