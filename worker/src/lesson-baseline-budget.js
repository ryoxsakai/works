// Count each D1 statement conservatively as a subrequest, including cold schema
// setup (11), initial reads, settings, refresh-token read and OAuth fetch. Leave
// five slots below the 50-subrequest ceiling, plus slack within each row cost.
export function baselinePageLimit(calendarCount, requested = 25) {
  const available = Math.floor((45 - 20) / (calendarCount + 8));
  return Math.max(0, Math.min(2, requested, available));
}
