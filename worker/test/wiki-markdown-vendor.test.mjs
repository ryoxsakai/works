import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("Local Markdown libraries match the pinned npm sources and retain their licenses", async () => {
  for (const [vendor, dependency] of [
    ["marked.esm.js", "marked/lib/marked.esm.js"],
    ["purify.es.mjs", "dompurify/dist/purify.es.mjs"],
    ["LICENSE.marked", "marked/LICENSE"],
    ["LICENSE.dompurify", "dompurify/LICENSE"],
  ]) {
    const a = await readFile(
      new URL("../../wiki/vendor/" + vendor, import.meta.url),
    );
    const b = await readFile(
      new URL("../node_modules/" + dependency, import.meta.url),
    );
    assert.ok(a.equals(b), vendor);
  }
});
