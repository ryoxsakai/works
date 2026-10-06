CREATE TABLE IF NOT EXISTS kdp_mcp_requests (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_refs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(grant_id,request_id));
CREATE TRIGGER IF NOT EXISTS kdp_mcp_requests_no_update BEFORE UPDATE ON kdp_mcp_requests BEGIN SELECT RAISE(ABORT,'KDP MCP receipt is immutable'); END;
CREATE TRIGGER IF NOT EXISTS kdp_mcp_requests_no_delete BEFORE DELETE ON kdp_mcp_requests BEGIN SELECT RAISE(ABORT,'KDP MCP receipt is immutable'); END;
