// RAIMOSA AI provider abstraction.
//
// RAIMOSA must survive any one vendor changing its API or pricing, so no part
// of the product may import a vendor SDK directly. Providers register here
// with a declared kind, and routing picks one by task, privacy, and cost.
//
// This registry ships with NO provider configured. That is deliberate and it
// is reported honestly: `route()` returns `null` with a reason rather than a
// provider that would silently fail, and nothing in the product may claim
// model output while `configured` is false. Adding a provider means adding an
// adapter module that implements `{ id, kind, capabilities, configured(),
// complete(), stream() }` and registering it — never wiring a vendor inline.

const providers = new Map();

export const PROVIDER_KIND = Object.freeze({
  TEXT: "text",
  REALTIME_VOICE: "realtime-voice",
  EMBEDDING: "embedding",
  LOCAL: "local",
});

/**
 * Register a provider adapter. `configured` must be a function that checks for
 * real credentials at call time, so a missing key is discovered when it is
 * needed rather than assumed at boot.
 */
export function registerProvider(adapter) {
  if (
    !adapter?.id ||
    !adapter?.kind ||
    typeof adapter.configured !== "function"
  )
    throw new Error(
      "A provider adapter needs an id, a kind, and configured().",
    );
  providers.set(adapter.id, adapter);
  return adapter;
}

export function listProviders() {
  return [...providers.values()].map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    kind: p.kind,
    capabilities: p.capabilities ?? [],
    configured: Boolean(p.configured()),
    privacy: p.privacy ?? "external", // "local" providers never leave the device
  }));
}

/**
 * Choose a provider for a request. Preference order is deliberate: privacy
 * first (a local model when the request is sensitive), then the requested
 * kind, then the lowest declared cost. Returns `{ provider: null, reason }`
 * when nothing suitable is configured — callers must surface that, never
 * pretend.
 */
export function route({ kind = PROVIDER_KIND.TEXT, sensitive = false } = {}) {
  const candidates = [...providers.values()].filter(
    (p) => p.kind === kind && p.configured(),
  );
  if (!candidates.length)
    return {
      provider: null,
      reason: providers.size
        ? `No configured provider offers ${kind}.`
        : "No AI provider is configured. RAIMOSA works locally without one; add an adapter to enable model features.",
    };
  const ordered = candidates
    .filter((p) => !sensitive || p.privacy === "local")
    .sort((a, b) => (a.costRank ?? 1) - (b.costRank ?? 1));
  if (!ordered.length)
    return {
      provider: null,
      reason:
        "This request is marked sensitive and no local provider is configured.",
    };
  return { provider: ordered[0], reason: null };
}

export function providerSummary() {
  const list = listProviders();
  return {
    configured: list.filter((p) => p.configured).map((p) => p.id),
    available: list,
    modelProvider: list.find((p) => p.configured)?.id ?? null,
  };
}
