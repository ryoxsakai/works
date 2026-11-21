export const SCHOOL_PERIOD_NAMES = Object.freeze({
  tomas: "TOMAS",
  daikanyama: "代官山",
  shukutoku_yono: "淑徳与野",
});
export const PERIOD_MODES = Object.freeze(["label", "time", "both"]);
const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultPeriodProfiles() {
  return {
    revision: 0,
    common_mode: "legacy",
    schools: Object.fromEntries(Object.keys(SCHOOL_PERIOD_NAMES).map(key => [
      key, { mode: "label", calendar_ids: [], periods: [] },
    ])),
  };
}

// Old installs have no preference key; malformed input is never used as a
// source for a calendar mapping or period label.
export function readPeriodProfiles(value) {
  const fallback = defaultPeriodProfiles();
  if (!Number.isSafeInteger(value?.revision) || value.revision < 0 ||
      !["legacy", ...PERIOD_MODES].includes(value.common_mode)) return fallback;
  const assigned = new Set();
  const schools = {};
  for (const key of Object.keys(SCHOOL_PERIOD_NAMES)) {
    const school = value.schools?.[key];
    if (!PERIOD_MODES.includes(school?.mode) ||
        !Array.isArray(school.calendar_ids) || !Array.isArray(school.periods)) return fallback;
    const starts = new Set();
    for (const id of school.calendar_ids) {
      if (typeof id !== "string" || !id || assigned.has(id)) return fallback;
      assigned.add(id);
    }
    for (const period of school.periods) {
      if (typeof period?.label !== "string" || !period.label.trim() ||
          !START_TIME.test(period.start_time) || starts.has(period.start_time)) return fallback;
      starts.add(period.start_time);
    }
    schools[key] = {
      mode: school.mode,
      calendar_ids: [...school.calendar_ids],
      periods: school.periods.map(({ label, start_time }) => ({ label, start_time })),
    };
  }
  return { revision: value.revision, common_mode: value.common_mode, schools };
}

function clock(date, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

function commonLabel(periods, time) {
  let match;
  // Existing common settings keep their start-to-next-start behavior.
  for (const entry of periods ?? []) {
    if (entry.start_time <= time && (!match || entry.start_time >= match.start_time)) match = entry;
  }
  return match?.label || "";
}

// All changes are only presentation. Only an explicitly assigned calendar ID
// can select a school profile; school slots match exact Japanese start times.
export function lessonPeriodDisplay(start, calendarId, common, preferences, {
  legacyMode = "label", legacyTimeZone,
} = {}) {
  if (!start) return { primary: "", secondary: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return { primary: "終日", secondary: "" };
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) return { primary: String(start), secondary: "" };
  const school = Object.keys(SCHOOL_PERIOD_NAMES)
    .map(key => preferences?.schools?.[key])
    .find(entry => entry?.calendar_ids?.includes(calendarId));
  const configuredMode = school?.mode ?? preferences?.common_mode ?? "legacy";
  const mode = configuredMode === "legacy" ? legacyMode : configuredMode;
  const time = clock(date, configuredMode === "legacy" ? legacyTimeZone : "Asia/Tokyo");
  const label = mode === "time" ? "" : school
    ? school.periods.find(entry => entry.start_time === time)?.label || ""
    : commonLabel(common, time);
  if (!label) return { primary: time, secondary: "" };
  if (mode === "legacy-list") return { primary: time, secondary: label };
  return { primary: label, secondary: mode === "both" ? time : "" };
}

export function lessonPeriodText(display) {
  return display.secondary ? `${display.primary}（${display.secondary}）` : display.primary;
}
