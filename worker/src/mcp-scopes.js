export const MCP_SCOPE = "schedule:read";
export const KDP_WRITE_SCOPE = "kdp:write";

// Release gate: enabling it requires an owner-approved authentication change.
// Never add this scope to an existing code, access token, or refresh family.
export const kdpMcpWriteEnabled = (env) => env.KDP_MCP_WRITE_ENABLED === "true";
export const mcpScopes = (env) => [MCP_SCOPE, ...(kdpMcpWriteEnabled(env) ? [KDP_WRITE_SCOPE] : [])];
export function canonicalMcpScope(value) {
  const scopes = String(value).split(" ");
  if (!scopes.includes(MCP_SCOPE) || new Set(scopes).size !== scopes.length ||
      scopes.some(scope => ![MCP_SCOPE, KDP_WRITE_SCOPE].includes(scope))) return null;
  return scopes.includes(KDP_WRITE_SCOPE) ? `${MCP_SCOPE} ${KDP_WRITE_SCOPE}` : MCP_SCOPE;
}
export function supportedMcpScope(env, value) {
  const canonical = canonicalMcpScope(value);
  return canonical === MCP_SCOPE ||
    (kdpMcpWriteEnabled(env) && canonical === `${MCP_SCOPE} ${KDP_WRITE_SCOPE}`);
}
export function requireKdpWrite(env, auth) {
  if (!kdpMcpWriteEnabled(env))
    throw Object.assign(new Error("KDP MCP editing is not enabled"), { status: 403 });
  if (!auth?.fid || !auth.scope?.split(" ").includes(KDP_WRITE_SCOPE))
    throw Object.assign(new Error("KDP editing requires a new OAuth connection with explicit kdp:write consent; existing grants cannot be upgraded by refresh"), { status: 403 });
}
