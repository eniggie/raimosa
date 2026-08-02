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
};
