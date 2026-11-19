import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let bundle;
export function bundledWorker() {
  // Run the deployed module graph, including Worker-compatible npm dependencies.
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL("../src/index.js", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  }).then(result => result.outputFiles[0].text);
  return bundle;
}
