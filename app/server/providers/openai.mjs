// OpenAI provider adapter for RAIMOSA.
//
// The adapter reads its API key from the Credential Vault at call time — never
// from the repo, never from a config file, never echoed back — and reports
// `configured:false` until the vault holds `OPENAI_API_KEY`. While unconfigured
// nothing in RAIMOSA may present model output, and `route()` returns null.
//
// Two capabilities:
//   • text      — `complete()` via the Responses API (gpt-5.1).
//   • realtime  — `realtimeSession()` mints a short-lived client token for
//                 WebRTC voice (gpt-realtime-2.1). The long-lived key stays
//                 server-side; the browser only ever sees the ephemeral token.
//
// This is a provider ADAPTER: swapping vendors means adding another file
// here, not touching the product. Nothing outside providers/ imports the
// OpenAI API shape.

import { PROVIDER_KIND } from "../providers.mjs";

const KEY_NAME = "OPENAI_API_KEY";
const TEXT_MODEL = "gpt-5.1";
const REALTIME_MODEL = "gpt-realtime-2.1";
const CACHE_MS = 30_000;

export function createOpenAIProvider({ vault, fetchImpl = fetch }) {
  let cached = { at: 0, present: false };

  async function key(by) {
    return vault ? vault.read(KEY_NAME, { by }) : null;
  }

  // `configured()` is consulted by health and routing often; a keychain read
  // each time would be wasteful and would spam the ledger with "used"
  // receipts, so presence is cached briefly and refreshed on demand.
  async function refresh() {
    const present = Boolean(
      vault && (await vault.read(KEY_NAME, { by: "provider-check" })),
    );
    cached = { at: Date.now(), present };
    return present;
  }

  const adapter = {
    id: "openai",
    name: "OpenAI",
    kind: PROVIDER_KIND.TEXT,
    capabilities: ["text", "realtime-voice"],
    privacy: "external",
    costRank: 2,
    keyName: KEY_NAME,
    models: { text: TEXT_MODEL, realtime: REALTIME_MODEL },
    configured() {
      if (Date.now() - cached.at > CACHE_MS) void refresh();
      return cached.present;
    },
    refresh,

    async complete({ system, input, maxOutputTokens = 800 } = {}) {
      const apiKey = await key("ovia-text");
      if (!apiKey)
        throw new Error(
          "OpenAI is not configured (no OPENAI_API_KEY in the vault).",
        );
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          instructions: system ?? undefined,
          input: String(input ?? ""),
          max_output_tokens: maxOutputTokens,
        }),
      });
      if (!response.ok) throw new Error(`OpenAI responded ${response.status}.`);
      const data = await response.json();
      const text =
        data.output_text ??
        (data.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join("");
      return {
        provider: "openai",
        model: TEXT_MODEL,
        text,
        usage: data.usage ?? null,
      };
    },

    async realtimeSession({ voice = "marin", instructions } = {}) {
      const apiKey = await key("ovia-voice");
      if (!apiKey)
        throw new Error(
          "OpenAI is not configured (no OPENAI_API_KEY in the vault).",
        );
      const response = await fetchImpl(
        "https://api.openai.com/v1/realtime/sessions",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: REALTIME_MODEL, voice, instructions }),
        },
      );
      if (!response.ok) throw new Error(`OpenAI responded ${response.status}.`);
      const data = await response.json();
      // Only the ephemeral client secret leaves the server.
      return {
        provider: "openai",
        model: REALTIME_MODEL,
        clientSecret: data.client_secret?.value ?? null,
        expiresAt: data.client_secret?.expires_at ?? null,
      };
    },
  };
  return adapter;
}
