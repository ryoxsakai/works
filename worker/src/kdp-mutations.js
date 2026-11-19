export const KDP_MCP_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS kdp_mcp_requests (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_refs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(grant_id,request_id));",
  "CREATE TRIGGER IF NOT EXISTS kdp_mcp_requests_no_update BEFORE UPDATE ON kdp_mcp_requests BEGIN SELECT RAISE(ABORT,'KDP MCP receipt is immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_mcp_requests_no_delete BEFORE DELETE ON kdp_mcp_requests BEGIN SELECT RAISE(ABORT,'KDP MCP receipt is immutable'); END;",
];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export async function prepareKdpMutation(db, grantId, operation, args) {
  if (typeof args.request_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(args.request_id))
    fail(400, "request_id must contain 8–128 letters, digits, underscores or hyphens; reuse it only for an identical retry");
  const canonical = Object.keys(args).sort().map(key => [key, args[key]]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([operation, canonical])));
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  await db.batch(KDP_MCP_SCHEMA.map(sql => db.prepare(sql)));
  return { grantId, requestId: args.request_id, fingerprint };
}
export async function replayKdpMutation(db, receipt) {
  const saved = await db.prepare("SELECT fingerprint,result_refs FROM kdp_mcp_requests WHERE grant_id=? AND request_id=?")
    .bind(receipt.grantId, receipt.requestId).first();
  if (!saved) return null;
  if (saved.fingerprint !== receipt.fingerprint)
    fail(409, "request_id was already used with different arguments; use a new request_id for a new operation");
  const refs = JSON.parse(saved.result_refs);
  const snapshots = await db.batch(refs.map(ref => db.prepare("SELECT snapshot FROM kdp_history WHERE entity_type=? AND entity_id=? AND revision=?")
    .bind(ref.type, ref.id, ref.revision)));
  const result = {};
  refs.forEach((ref, i) => {
    if (!snapshots[i].results[0]) fail(500, "KDP mutation receipt history is missing");
    result[ref.key] = JSON.parse(snapshots[i].results[0].snapshot);
  });
  return result;
}
// The mutation and its immutable receipt commit in one D1 transaction. A duplicate
// receipt rolls back the competing mutation, then returns the original snapshots.
// Failed CAS writes have changes()=0 and do not reserve a request ID.
export async function commitKdpMutation(db, statements, receipt, refs) {
  if (!receipt) return { results: await db.batch(statements) };
  try {
    const results = await db.batch([
      ...statements,
      db.prepare("INSERT INTO kdp_mcp_requests(grant_id,request_id,fingerprint,result_refs) SELECT ?,?,?,? WHERE changes()=1")
        .bind(receipt.grantId, receipt.requestId, receipt.fingerprint, JSON.stringify(refs)),
    ]);
    // A competitor may have committed before our CAS/preflight. Replaying is also
    // necessary when our statements change zero rows (e.g. simultaneous acceptance).
    const replay = await replayKdpMutation(db, receipt);
    return { results, replay };
  } catch (error) {
    const replay = await replayKdpMutation(db, receipt);
    if (replay) return { replay };
    throw error;
  }
}
