#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  parseWeeklyTestDraft,
  createPrintDocumentHtml,
} from "../material-print/print-template.mjs";

const run = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/render-weekly-test.mjs INPUT.txt OUTPUT.pdf");
  process.exit(2);
}

const chromeCandidates = [
  process.env.WORKS_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chromePath = chromeCandidates[0];
if (!chromePath) throw new Error("Chromeの実行ファイルを指定してください。");

const [draftText, cssText] = await Promise.all([
  readFile(path.resolve(inputPath), "utf8"),
  readFile(path.join(projectRoot, "material-print", "print.css"), "utf8"),
]);
const parsed = parseWeeklyTestDraft(draftText);
const html = createPrintDocumentHtml(parsed, { paged: false, cssText });
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "works-weekly-print-"));
const htmlPath = path.join(tempDirectory, "weekly-test.html");

try {
  await writeFile(htmlPath, html, "utf8");
  await run(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${path.resolve(outputPath)}`,
    pathToFileURL(htmlPath).href,
  ], { maxBuffer: 10 * 1024 * 1024 });
  console.log(`Rendered ${parsed.questions.length} questions to ${path.resolve(outputPath)}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
