async function request(path, body) {
  const response = await fetch(`/api/raimosa${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid adapter response." }));
  if (!response.ok || !data.ok)
    throw new Error(data.error || "Adapter request failed.");
  return data;
}

export const desktopApi = {
  health: () => request("/health"),
  receipts: () => request("/receipts"),
  scan: () => request("/scan", {}),
  plan: (command, root) => request("/plan", { command, root }),
  run: (tool, payload = {}) => request(`/tools/${tool}`, payload),
  exportReceipts: (format, tool) =>
    request("/receipts/export", { format, tool }),
  licenseStatus: () => request("/license/status", {}),
  activateLicense: (key) => request("/license/activate", { key }),
  removeLicense: () => request("/license/remove", {}),
  emergencyStop: () => request("/stop", {}),
  emergencyClear: () => request("/stop/clear", {}),
  emergencyStatus: () => request("/stop/status", {}),
  startAccess: (duration) =>
    request("/access/start", { duration, confirmed: true }),
  endAccess: (token) => request("/access/end", { token }),
  accessStatus: (token) => request("/access/status", { token }),
  startRemote: (accessToken) => request("/remote/start", { accessToken }),
  pairRemote: (code) => request("/remote/pair", { code }),
  remoteStatus: (token) => request("/remote/status", { token }),
  endRemote: (token) => request("/remote/end", { token }),
  runRemote: (tool, remoteToken, payload = {}) =>
    request(`/remote/tools/${tool}`, { ...payload, remoteToken }),
  // Credential vault — values are never returned by any route.
  vaultStatus: () => request("/vault/status", {}),
  vaultPut: (name, secret, purpose, accessToken) =>
    request("/vault/put", { name, secret, purpose, accessToken }),
  vaultRemove: (name, accessToken) =>
    request("/vault/remove", { name, accessToken, confirmation: "CONFIRM" }),
  // Sentinel
  sentinelStatus: () => request("/sentinel/status", {}),
  sentinelPolicy: () => request("/sentinel/policy", {}),
  sentinelSetLevel: (tool, level) =>
    request("/sentinel/policy/set", { tool, level }),
  sentinelRegisterAgent: (agent) => request("/sentinel/agents/register", agent),
  sentinelPauseAgent: (agentId, reason) =>
    request("/sentinel/agents/pause", { agentId, reason }),
  sentinelResumeAgent: (agentId) =>
    request("/sentinel/agents/resume", { agentId }),
  sentinelRevokeAgent: (agentId) =>
    request("/sentinel/agents/revoke", { agentId }),
  sentinelCreateTask: (task) => request("/sentinel/tasks/create", task),
  sentinelClaim: (taskId, claim) =>
    request("/sentinel/tasks/claim", { taskId, ...claim }),
  sentinelVerify: (taskId, checks, root) =>
    request("/sentinel/tasks/verify", { taskId, checks, root }),
  sentinelVerifications: (taskId) =>
    request("/sentinel/tasks/verifications", { taskId }),
  sentinelRequestApproval: (approval) =>
    request("/sentinel/approvals/request", approval),
  sentinelDecide: (approvalId, decision, accessToken) =>
    request("/sentinel/approvals/decide", {
      approvalId,
      decision,
      accessToken,
    }),
  remoteSentinelStatus: (remoteToken) =>
    request("/remote/sentinel/status", { remoteToken }),
  remoteSentinelDecide: (remoteToken, approvalId, decision) =>
    request("/remote/sentinel/decide", { remoteToken, approvalId, decision }),
};
