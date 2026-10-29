# Calendar-count load validation for explicit aliases

Draft PR157. Synthetic only; no production reads, saves, settings changes, credentials or SQL activation. This extends the earlier four-calendar measurement; preflight now adds two SQL reads on valid alias paths.

## Existing supported counts and reproduced issue

`worker/src/tutor-settings.js` already caps guarded setting arrays at1000 unique values. Original Tutor settings and legacy `/api/settings` writes/readers do not impose a calendar-count bound. This change does not add one. Validate1,4,8,20,49,50,100,1000 and legacy1001 selected calendars.

The previous collision lookup performed one outgoing event GET for each other selected calendar. A synthetic50-external-call limiter reproduces failure at1000 calendars before any save. Cloudflare plan/runtime limits vary; this is a deterministic fixture reproduction, not a production runtime observation.

## Fix

For more than8 other calendars, use Google's documented read-only Calendar batch endpoint in sequential chunks of100. Every inner request is an escaped event GET projected to `id,status`; existing OAuth permissions and Google per-operation quota still apply. No collision check is skipped or cached across requests. Match complete response IDs and counts; only404 means absent. Wrong IDs, duplicates, truncated boundaries, invalid JSON and non404 failures stop before mutation without retry. Cancelled-event behavior remains unchanged. Small configurations keep their original individual GET path.

Alias preflight checks schema, immutable mapping ID/revision/key and active status before Calendar lookup. Missing/partial schema503, malformed400 and missing/disabled409 consume no outgoing Google calls. The authoritative calendar, title/generation, hold, profile snapshot and in-transaction revocation checks still follow. No alias fallback, copying, merging or automatic identity choice is introduced.

## Measured actual Worker HTTP path

Four changed chapters; synthetic token refresh and Calendar responses; isolated D1. Cold uses a fresh DB wrapper so all11 attribution schema statements are included. Warm reuses that wrapper. SQL counts include every statement in transactions; DB calls count each batch as one binding roundtrip. Do not add SQL-statement counts to fetch counts as if every SQL statement were an HTTP connection.

| Selected calendars | SQL cold/warm | DB calls cold/warm | External calls cold/warm | Binding+external cold/warm |
|---|---|---|---|---|
|1|42 /31|17 /16|2 /2|19 /18|
|4|42 /31|17 /16|5 /5|22 /21|
|8|42 /31|17 /16|9 /9|26 /25|
|20,49,50,100|42 /31|17 /16|3 /3|20 /19|
|1000,1001|42 /31|17 /16|12 /12|29 /28|

Fixtures enforce SQL<=50, outgoing fetches<=50 and binding calls+outgoing fetches<=50 independently, conservatively covering the lower invocation budgets. No plan upgrade or configured limit increase is assumed. These are count measurements, not production CPU/latency/daily-quota certification.

## Safety cases

- Malformed mapping:1 SQL,0 external; unknown mapping:2 SQL,0 external.
- Absent/partial mapping schema:503, no Google traffic; metadata read `available:false` and no auto-DDL.
- Ordinary full-title profile save works at1000 calendars without the mapping table; no profile-key fallback.
- Duplicate event in another calendar:409 before progress mutation; unavailable batch part:502 before mutation.
- Unlink before progress commit:409, zero chapter writes; append-only unlink history retained.
- Save commits before unlink: subsequent confirmation409 preserves committed progress and unlink audit; stale repeat stops in preflight with0 outgoing calls and no replay.
- Batch parser rejects partial/duplicate/wrong/invalid response IDs, invalid JSON, incomplete MIME and403/429/500; valid repeated non-identity HTTP headers (such as Vary) are accepted, while duplicate Content-ID/Content-Type remain blocked. No automatic retry. Sequential1000-event lookup uses10 batches, preserving all requested IDs.

## Remaining checks

No known count-limit implementation gap remains for the guarded maximum1000 and tested legacy1001 configuration. Legacy inputs remain unbounded, so arbitrary counts are not certified; normal Google per-operation quotas also remain. Production plan/CPU/latency and real Google batch response behavior require read-only authenticated deployment observation after the pending fresh backup/schema rollout. Actual iPhone, supplied-image pixels and physical printing remain unverified. No production test save is needed.

Official references checked2026-10-29:

- [Google Calendar batch semantics, response correlation and quota](https://developers.google.com/workspace/calendar/api/guides/batch)
- [Workers subrequests and connection limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests)
- [D1 query limits](https://developers.cloudflare.com/d1/platform/limits/)
