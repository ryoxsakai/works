import test from "node:test";
import assert from "node:assert/strict";

import {
  parseWeeklyTestDraft,
  renderPrintSheets,
  createPrintDocumentHtml,
} from "../print-template.mjs";

function makeDraft() {
  const lines = ["Weekly Test 第14回", "", "1. 適切なものを選びなさい。", ""];
  for (let number = 1; number <= 10; number += 1) {
    lines.push(
      `(${number}) [${900 + number}] This is (   ) question ${number}.`,
      "選択肢：① one　② two　③ three　④ four",
      "解　答：②",
      "解　説：選択問題の解説です。",
      ""
    );
  }
  lines.push("2. 語句を並び替えなさい。", "");
  for (let number = 11; number <= 15; number += 1) {
    lines.push(
      `(${number}) [${900 + number}] 日本語文です。`,
      "This ( is / a / test ).",
      "解　答：is a test",
      "完成文：This is a test.",
      "解　説：並べ替え問題の解説です。",
      ""
    );
  }
  lines.push("3. 空所に英語を入れなさい。", "");
  for (let number = 16; number <= 20; number += 1) {
    lines.push(
      `(${number}) [${900 + number}] 日本語文です。`,
      "Please take (c   ) of yourself.",
      "解　答：care",
      "解　説：空所補充問題の解説です。",
      ""
    );
  }
  lines.push("4. 誤りを正しなさい。", "");
  for (let number = 21; number <= 25; number += 1) {
    const noError = number === 22;
    lines.push(
      `(${number}) [${900 + number}] 日本語文です。`,
      "This ①[are] ②[a] ③[simple] ④[test].",
      `解　答：${noError ? "誤りなし" : "①"}`,
      `正しい形：${noError ? "誤りなし" : "is"}`,
      "和　訳：これは簡単なテストです。",
      "解　説：誤り訂正問題の解説です。",
      ""
    );
  }
  return lines.join("\n");
}

test("25問のWeekly Test原稿を4大問として解析する", () => {
  const parsed = parseWeeklyTestDraft(makeDraft());
  assert.equal(parsed.round, 14);
  assert.equal(parsed.questions.length, 25);
  assert.deepEqual(
    [1, 2, 3, 4].map((section) => parsed.questions.filter((question) => question.section === section).length),
    [10, 5, 5, 5]
  );
  assert.equal(parsed.questions[10].completed, "This is a test.");
  assert.equal(parsed.questions[21].answer, "誤りなし");
});

test("問題3ページ・白紙1ページ・解答2ページを出力する", () => {
  const parsed = parseWeeklyTestDraft(makeDraft());
  const sheets = renderPrintSheets(parsed);
  assert.equal((sheets.match(/class="sheet/g) || []).length, 6);
  assert.match(sheets, /class="sheet blank-sheet" data-page="4"/);
  assert.match(sheets, /data-page="6"/);
  assert.match(sheets, /解答・解説/);
  assert.match(sheets, /<span class="explanation-label">【解説】<\/span>/);
});

test("空欄の丸括弧内を全角スペース2つで出力する", () => {
  const parsed = parseWeeklyTestDraft(makeDraft());
  const sheets = renderPrintSheets(parsed);
  assert.match(sheets, /This is \(　　\) question 1\./);
  assert.match(sheets, /class="word-blank"[^>]*>\(　　\)<\/span>/);
  assert.doesNotMatch(sheets, /\(   \)/);
});

test("印刷HTMLではPaged.jsを任意に無効化できる", () => {
  const parsed = parseWeeklyTestDraft(makeDraft());
  const browserHtml = createPrintDocumentHtml(parsed, { paged: true });
  const exportHtml = createPrintDocumentHtml(parsed, { paged: false, cssText: "body{color:#111}" });
  assert.match(browserHtml, /pagedjs@0\.4\.3/);
  assert.doesNotMatch(exportHtml, /pagedjs@/);
  assert.match(exportHtml, /<style>body\{color:#111\}<\/style>/);
});

test("欠番がある原稿は印刷しない", () => {
  const invalid = makeDraft().replace(/^\(25\).*?(?=\n\n|$)/ms, "");
  assert.throws(() => parseWeeklyTestDraft(invalid), /検出数 24\/25/);
});
