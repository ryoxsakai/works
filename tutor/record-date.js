// Civil dates for the Japan-based lesson calendar, independent of device timezone.
export function tokyoDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shiftRecordDate(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function recordDateRange(first, last = first) {
  return [new Date(`${first}T00:00:00+09:00`).toISOString(), new Date(`${shiftRecordDate(last, 1)}T00:00:00+09:00`).toISOString()];
}
