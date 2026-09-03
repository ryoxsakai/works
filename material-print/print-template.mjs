const SECTION_DEFAULTS = {
  1: "次の(　　)内に入れるのに最も適切なものを選択肢から1つ選びなさい。",
  2: "日本語の意味に合うように、(　　)内の語句を並び替えて正しい英文を完成させなさい。",
  3: "日本語の意味に合うように、(　　)内にそれぞれ適切な英語を入れなさい。",
  4: "次の各英文の下線部（①〜④）の中に、文法上誤っているものが1つあります。その番号を選び、正しい形に直しなさい。誤りがない場合は「誤りなし」としなさい。",
};

const FIELD_PATTERN = /^(選択肢|解[　\s]*答|解[　\s]*説|完成文|正しい形|和[　\s]*訳)：\s*(.*)$/;
const ANSWER_SECTION_LABELS = {
  1: "4択問題",
  2: "並び替え問題",
  3: "空所補充問題",
  4: "正誤判定問題",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapePrintText(value) {
  return escapeHtml(String(value ?? "").replace(/\([\t 　]*\)/g, "(　　)"));
}

function normalizedFieldName(label) {
  return label.replace(/[　\s]/g, "");
}

function sectionNumberForQuestion(number) {
  if (number <= 10) return 1;
  if (number <= 15) return 2;
  if (number <= 20) return 3;
  return 4;
}

function parseQuestionBlock(header, rawBody) {
  const number = Number(header[1]);
  const sourceNumber = Number(header[2]);
  const section = sectionNumberForQuestion(number);
  const lead = header[3].trim();
  const bodyLines = [];
  const fields = {};
  let activeField = null;

  for (const rawLine of rawBody.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[1-4]\.\s+/.test(line)) break;
    const fieldMatch = line.match(FIELD_PATTERN);
    if (fieldMatch) {
      activeField = normalizedFieldName(fieldMatch[1]);
      fields[activeField] = fieldMatch[2].trim();
      continue;
    }
    if (activeField) {
      fields[activeField] = `${fields[activeField]} ${line}`.trim();
    } else {
      bodyLines.push(line);
    }
  }

  return {
    number,
    sourceNumber,
    section,
    prompt: lead,
    sentence: bodyLines.join(" ").trim(),
    choices: fields["選択肢"] || "",
    answer: fields["解答"] || "",
    explanation: fields["解説"] || "",
    completed: fields["完成文"] || "",
    correction: fields["正しい形"] || "",
    translation: fields["和訳"] || "",
  };
}

function validateTest(test) {
  const problems = test.questions;
  const numbers = problems.map((question) => question.number);
  const expected = Array.from({ length: 25 }, (_, index) => index + 1);
  const missing = expected.filter((number) => !numbers.includes(number));
  const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);

  if (problems.length !== 25 || missing.length || duplicates.length) {
    const detail = [
      `検出数 ${problems.length}/25`,
      missing.length ? `不足: ${missing.join(", ")}` : "",
      duplicates.length ? `重複: ${[...new Set(duplicates)].join(", ")}` : "",
    ].filter(Boolean).join(" / ");
    throw new Error(`Weekly Testの問題番号を確認してください（${detail}）。`);
  }

  for (const question of problems) {
    if (!question.prompt) throw new Error(`(${question.number}) の問題文がありません。`);
    if (!question.answer) throw new Error(`(${question.number}) の解答がありません。`);
    if (!question.explanation) throw new Error(`(${question.number}) の解説がありません。`);
    if (question.section === 1 && !question.choices) {
      throw new Error(`(${question.number}) の選択肢がありません。`);
    }
    if (question.section > 1 && !question.sentence) {
      throw new Error(`(${question.number}) の英文がありません。`);
    }
    if (question.section === 2 && !question.completed) {
      throw new Error(`(${question.number}) の完成文がありません。`);
    }
    if (question.section === 4 && !question.correction) {
      throw new Error(`(${question.number}) の正しい形がありません。`);
    }
  }
}

export function parseWeeklyTestDraft(input, options = {}) {
  const text = normalizeText(input);
  const titleMatch = text.match(/^Weekly Test\s+第(\d+)回\s*$/m);
  if (!titleMatch) throw new Error("先頭の「Weekly Test 第○回」を確認してください。");

  const instructions = { ...SECTION_DEFAULTS };
  for (const match of text.matchAll(/^([1-4])\.\s+(.+)$/gm)) {
    instructions[Number(match[1])] = match[2].trim();
  }

  const headers = [...text.matchAll(/^\((\d+)\)\s+\[(\d+)\]\s*(.*)$/gm)];
  const questions = headers.map((header, index) => {
    const start = header.index + header[0].length;
    const end = headers[index + 1]?.index ?? text.length;
    return parseQuestionBlock(header, text.slice(start, end));
  });

  const test = {
    year: Number(options.year || 2026),
    round: Number(options.round || titleMatch[1]),
    course: String(options.course || "英語H/S"),
    score: Number(options.score || 25),
    sourceTitle: titleMatch[0],
    instructions,
    questions,
  };
  validateTest(test);
  return test;
}

function questions(test, start, end) {
  return test.questions.filter((question) => question.number >= start && question.number <= end);
}

function renderTestHeader(test, answer = false) {
  if (answer) {
    return `
      <header class="test-header answer-header">
        <div class="answer-title">${escapeHtml(test.year)} 年度　Weekly Test　第${escapeHtml(test.round)}回　<span class="course-label">${escapeHtml(test.course)}</span>　解答</div>
        <div class="answer-label">解答・解説一覧</div>
      </header>`;
  }
  return `
    <header class="test-header">
      <div class="test-heading">
        <span>${escapeHtml(test.year)} 年度</span>
        <strong>Weekly Test</strong>
        <span>第${escapeHtml(test.round)}回</span>
        <span class="course-slot"><span class="course-label">${escapeHtml(test.course)}</span></span>
        <span class="test-score">/${escapeHtml(test.score)}</span>
      </div>
      <div class="student-fields">
        <span>クラス</span><i></i><span>名前</span><i class="student-name"></i><span>受験日（</span><i></i><span>／</span><i></i><span>）</span>
      </div>
    </header>`;
}

function renderSectionHeading(number, instruction, compact = false) {
  const roman = ["", "I.", "II.", "III.", "IV."][number];
  return `
    <div class="section-heading${compact ? " is-compact" : ""}">
      <span class="section-number">${compact ? `${number}.` : roman}</span>
      <p>${escapePrintText(instruction)}</p>
      ${number === 1 && !compact ? '<span class="section-score">配点　各1点</span>' : ""}
    </div>`;
}

function splitChoices(rawChoices) {
  const matches = [...String(rawChoices).matchAll(/([①②③④⑤⑥⑦⑧⑨⑩])\s*([^①②③④⑤⑥⑦⑧⑨⑩]+)/g)];
  if (!matches.length) return [rawChoices];
  return matches.map((match) => `${match[1]} ${match[2].trim()}`);
}

function renderChoiceQuestion(question) {
  return `
    <article class="problem problem-choice">
      <p class="problem-line"><span class="problem-number">(${question.number}) [${question.sourceNumber}]</span><span>${escapePrintText(question.prompt)}</span></p>
      <div class="choice-row">${splitChoices(question.choices).map((choice) => `<span>${escapeHtml(choice)}</span>`).join("")}</div>
    </article>`;
}

function renderOrderingAnswerLine(sentence) {
  const text = String(sentence);
  const open = text.indexOf("(");
  const close = text.indexOf(")", open + 1);
  if (open < 0 || close < 0) return `<span class="ordering-blank is-full"></span>`;
  return `${escapeHtml(text.slice(0, open))}<span class="ordering-blank"></span>${escapeHtml(text.slice(close + 1))}`;
}

function renderOrderingQuestion(question) {
  return `
    <article class="problem problem-ordering">
      <p class="problem-japanese"><span class="problem-number">(${question.number}) [${question.sourceNumber}]</span><span>${escapePrintText(question.prompt)}</span></p>
      <p class="problem-english">${escapePrintText(question.sentence)}</p>
      <p class="ordering-answer">${renderOrderingAnswerLine(question.sentence)}</p>
    </article>`;
}

function renderFillSentence(question) {
  const words = question.answer.split(/\s+/).filter(Boolean);
  let index = 0;
  const segments = String(question.sentence).split(/\([A-Za-z]\s+\)/g);
  const blanks = [...String(question.sentence).matchAll(/\([A-Za-z]\s+\)/g)];
  let html = "";
  segments.forEach((segment, segmentIndex) => {
    html += escapeHtml(segment);
    if (segmentIndex < blanks.length) {
      const word = words[index++] || "answer";
      const width = Math.max(7, Math.min(13, word.length + 3));
      html += `<span class="word-blank" style="--blank-ch:${width}ch">(　　)</span>`;
    }
  });
  return html;
}

function renderFillQuestion(question) {
  return `
    <article class="problem problem-fill">
      <p class="problem-japanese"><span class="problem-number">(${question.number}) [${question.sourceNumber}]</span><span>${escapePrintText(question.prompt)}</span></p>
      <p class="problem-english">${renderFillSentence(question)}</p>
    </article>`;
}

function renderMarkedSentence(sentence) {
  const text = String(sentence);
  const pattern = /([①②③④])\[([^\]]*)\]/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapePrintText(text.slice(cursor, match.index));
    html += `<span class="error-marker">${match[1]}<span>${escapeHtml(match[2])}</span></span>`;
    cursor = match.index + match[0].length;
  }
  html += escapePrintText(text.slice(cursor));
  return html;
}

function renderErrorQuestion(question) {
  return `
    <article class="problem problem-error">
      <p class="problem-english error-sentence"><span class="problem-number">(${question.number}) [${question.sourceNumber}]</span> ${renderMarkedSentence(question.sentence)}</p>
      <div class="correction-fields"><span>誤り：</span><b>[</b><i></i><b>]</b><strong>→</strong><span>正しい形：</span><b>[</b><i class="correction-long"></i><b>]</b></div>
    </article>`;
}

function renderAnswerGrid(start, end) {
  const cells = [];
  for (let number = start; number <= end; number += 1) {
    cells.push(`<div class="answer-cell"><span>${number}</span><i></i></div>`);
  }
  return `<div class="answer-grid" style="--grid-columns:${end - start + 1}">${cells.join("")}</div>`;
}

function renderAnswerItem(question) {
  const answerNumber = `<span class="answer-number">(${question.number})</span>`;
  let detail = "";
  if (question.section === 1) {
    detail = `<p class="answer-key">${answerNumber}　<strong class="answer-value">${escapeHtml(question.answer)}</strong></p>`;
  } else if (question.section === 2) {
    detail = `<p class="answer-key">${answerNumber} ${escapeHtml(question.answer)}</p>`;
  } else if (question.section === 3) {
    detail = `<p class="answer-key">${answerNumber} ${escapeHtml(question.answer)}</p>`;
  } else {
    const correction = question.answer === "誤りなし"
      ? "誤りなし"
      : `${question.answer}　${question.correction}`;
    detail = `<p class="answer-key">${answerNumber} ${escapeHtml(correction)}</p>`;
  }
  return `
    <article class="answer-item answer-item--section-${question.section}">
      ${detail}
      <p class="answer-explanation"><span class="explanation-label">【解説】</span>${escapeHtml(question.explanation)}</p>
    </article>`;
}

function renderProblemPageOne(test) {
  return `
    <section class="sheet problem-sheet problem-sheet-one" data-page="1">
      ${renderTestHeader(test)}
      ${renderSectionHeading(1, test.instructions[1])}
      <div class="problem-list choice-list">${questions(test, 1, 10).map(renderChoiceQuestion).join("")}</div>
      ${renderAnswerGrid(1, 10)}
    </section>`;
}

function renderProblemPageTwo(test) {
  return `
    <section class="sheet problem-sheet problem-sheet-two" data-page="2">
      ${renderSectionHeading(2, test.instructions[2])}
      <div class="problem-list ordering-list">${questions(test, 11, 15).map(renderOrderingQuestion).join("")}</div>
      ${renderSectionHeading(3, test.instructions[3])}
      <div class="problem-list fill-list">${questions(test, 16, 20).map(renderFillQuestion).join("")}</div>
      ${renderAnswerGrid(16, 20)}
      <p class="continue-note">裏面にも問題があります</p>
    </section>`;
}

function renderProblemPageThree(test) {
  return `
    <section class="sheet problem-sheet problem-sheet-three" data-page="3">
      ${renderSectionHeading(4, test.instructions[4])}
      <div class="problem-list error-list">${questions(test, 21, 25).map(renderErrorQuestion).join("")}</div>
    </section>`;
}

function renderBlankPage() {
  return '<section class="sheet blank-sheet" data-page="4" aria-label="白紙ページ"></section>';
}

function renderAnswerPage(test, page, groups) {
  return `
    <section class="sheet answer-sheet answer-sheet-${page}" data-page="${page}">
      ${page === 5 ? renderTestHeader(test, true) : ""}
      ${groups.map(([section, start, end, showHeading = true]) => `
        ${showHeading ? renderSectionHeading(section, ANSWER_SECTION_LABELS[section], true) : ""}
        <div class="answer-list">${questions(test, start, end).map(renderAnswerItem).join("")}</div>`).join("")}
    </section>`;
}

export function renderPrintSheets(test) {
  return [
    renderProblemPageOne(test),
    renderProblemPageTwo(test),
    renderProblemPageThree(test),
    renderBlankPage(),
    renderAnswerPage(test, 5, [[1, 1, 10], [2, 11, 13]]),
    renderAnswerPage(test, 6, [[2, 14, 15, false], [3, 16, 20], [4, 21, 25]]),
  ].join("\n");
}

export function createPrintDocumentHtml(test, options = {}) {
  const cssHref = options.cssHref || "./print.css";
  const stylesheet = options.cssText
    ? `<style>${String(options.cssText).replaceAll("</style", "<\\/style")}</style>`
    : `<link rel="stylesheet" href="${escapeHtml(cssHref)}" />`;
  const includePaged = options.paged !== false;
  const pagedScript = includePaged
    ? `<script>
        window.PagedConfig = {
          after: function () {
            window.parent.postMessage({ type: "works-material-print-ready" }, "*");
          }
        };
      </script>
      <script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>`
    : "";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(test.sourceTitle)} 印刷</title>
  ${stylesheet}
</head>
<body>
  <main class="print-document">${renderPrintSheets(test)}</main>
  ${pagedScript}
</body>
</html>`;
}
