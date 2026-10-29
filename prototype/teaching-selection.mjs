import {isGroupLessonTitle,selectionTitleWithoutAnnotation} from '../shared/student-profile-key.js';
export {isGroupLessonTitle,selectionTitleWithoutAnnotation,curriculumSelectionName} from '../shared/student-profile-key.js';
// Original Tutor selection/color semantics. Keep source comparison tests in sync.

const TOKEN_DELIMITER_RE = /([\s　()（）【】\[\]・/,、:：\-])/;

export function tokenizeText(text) {
  return text
    .split(TOKEN_DELIMITER_RE)
    .filter((part) => part !== "" && !(part.length === 1 && TOKEN_DELIMITER_RE.test(part)));
}

export function normalizeCurriculumText(text) {
  return String(text || "")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim();
}

export function eventMatchesCurriculumName(event, name) {
  const query = normalizeCurriculumText(name);
  if ((event.summary || "").trim() === name.trim()) return true;
  const source = normalizeCurriculumText(`${event.summary || ""} ${event.description || ""}`);
  if (!query) return false;
  if (query.includes(" ")) {
    const parts = tokenizeText(query).map(normalizeCurriculumText);
    const tokens = tokenizeText(source).map(normalizeCurriculumText);
    return tokens.some((_, i) => parts.every((part, j) => tokens[i + j] === part));
  }
  return tokenizeText(source).some((token) => normalizeCurriculumText(token) === query);
}







export function isNonLessonSelectionTitle(title) {
  if (String(title || "").includes("○")) return true;
  const name = normalizeCurriculumText(selectionTitleWithoutAnnotation(title));
  return /会議|教科会|打ち?合[わ]?せ|ミーティング|WT\s*作成/i.test(name);
}

export function lightenHexColor(hex, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export const fallbackColors=['#c8e6c9','#bbdefb','#ffe0b2','#f8bbd0','#d1c4e9','#b2ebf2','#fff9c4'];
export function calendarAppearance(calendar,index=0){const fallback=fallbackColors[index%fallbackColors.length],raw=/^#[0-9a-f]{6}$/i.test(calendar?.backgroundColor||'')?calendar.backgroundColor:fallback;return {id:calendar.id,name:calendar.summary||calendar.id,raw,bg:calendar.backgroundColor===raw?lightenHexColor(raw,.72):fallback,fg:'#1f2937'};}
export function calendarGroup(name,calendar,kinds={}){const label=calendar?.name||'',kind=kinds[JSON.stringify([calendar?.id,name])];return /TOMAS/i.test(label)?'TOMAS':/代官山/.test(label)?((isGroupLessonTitle(name)||kind==='group'||(!kind&&/集団|グループ/.test(label)))?'代官山 · 集団':'代官山 · 個別'):label||'その他';}
