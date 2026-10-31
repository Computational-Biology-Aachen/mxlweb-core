/**
 * nodeLoader.ts — loads the WASM runtime from disk, for headless use outside a
 * browser Worker (tests, CI). Never import this from browser code.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileModelWith, type EmscriptenModule } from "./wasmLoader.js";

const wasmDir = fileURLToPath(
  new URL("../../../static/wasm/", import.meta.url),
);

export async function loadRadauNode(): Promise<EmscriptenModule> {
  const js = fs.readFileSync(path.join(wasmDir, "radau5.js"), "utf8");
  // Node misdetects the MODULARIZE=1 glue as ambiguous CJS/ESM when evaluated
  // via `new Function`, so it has to be required from a real .cjs file. Unique
  // per process: test workers load this concurrently.
  const cjsPath = path.join(os.tmpdir(), `mxlweb-radau5-${process.pid}.cjs`);
  fs.writeFileSync(cjsPath, `${js}\nmodule.exports = RadauModule;\n`);
  try {
    const factory = createRequire(import.meta.url)(cjsPath) as (opts: {
      locateFile: (f: string) => string;
    }) => Promise<EmscriptenModule>;
    return await factory({ locateFile: (f) => path.join(wasmDir, f) });
  } finally {
    fs.rmSync(cjsPath, { force: true });
  }
}

let wat2wasm: ((code: string) => Uint8Array) | null = null;

function watToWasmNode(wat: string): Uint8Array {
  if (!wat2wasm) {
    const js = fs.readFileSync(path.join(wasmDir, "wat-compiler.js"), "utf8");
    const mod: { exports: { default?: (code: string) => Uint8Array } } = {
      exports: {},
    };
    new Function("module", "exports", js)(mod, mod.exports);
    if (!mod.exports.default) {
      throw new Error("wat-compiler bundle did not export a default function");
    }
    wat2wasm = mod.exports.default;
  }
  return wat2wasm(wat);
}

export function compileModelNode(
  wat: string,
  mod: EmscriptenModule,
): Promise<WebAssembly.Instance> {
  return compileModelWith(wat, mod, watToWasmNode);
}
