# Lesson cards and memo autosave

Regular confirmed fixed-owner cards show the icon, name, count, refresh button,
current plan, next plan and student memo. Names are plain text. Time, previous
plan and the persistent binding link are removed from the regular card view;
hidden record fields and their persistence are retained.

The refresh button rechecks the next lesson candidate. It does not increment
counts, save a memo, complete a lesson or change an event's owner. Existing
dirty/pending/conflict gates remain in force. Errors, unconfirmed ownership,
unknown save outcomes and recovery copies may expose contextual recovery UI.
Legacy name-key memo editors retain their explicit sharing acknowledgement;
the compact fixed-owner flow does not infer shared memo identity from a name.

Fixed-owner memos save after 600 ms without input or on leaving the field.
IME composition is not saved halfway through. Saves are serialized per owner;
edits made while a request is pending retain the newest value and use the
successful response's revision for a subsequent save. Drafts persist locally
before requests, including the original base revision and operation ID.
Recovered input is not automatically submitted on mount. A failed or uncertain
request is not automatically replayed. Existing audit verification, explicit
conflict comparison and download/recovery paths remain available.

Next cards are selected chronologically within the source calendar, including
same normalized exact-title cards with different existing owner IDs. Confirmed
next cards retain their own owner and record; linked saves independently fence
the source owner and target owner/revision. No owners, history rows or memos are
merged or copied. Unconfirmed/recreated/changed targets remain gated, explicit
exclusions are respected and simultaneous candidates remain ambiguous.

Synthetic browser coverage includes debounce/blur, in-flight edits, failure and
retry, offline/reload recovery, lost-response audit verification without resend,
conflict comparison, IME, unmount/recovery, keyboard operation, target isolation,
cross-view record synchronization and responsive card layouts. No test writes
to live calendars or production records.

The user-supplied Library image could not be materialized in this cloud
environment: the transfer helper returned `download failed` for the signed
`sdmntprwestus3.oaiusercontent.com` URL, which is not in this environment's
allowed-host list. The implementation uses the explicit textual requirements;
the supplied image has not been visually compared. Synthetic rendered cards
are inspected separately. No production deployment or live verification is
included in this change.
