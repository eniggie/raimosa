// Anthropic (Claude) provider adapter for RAIMOSA.
//
// Same contract as the OpenAI adapter: the key comes from the Credential
// Vault at call time, `configured()` is false until it exists, and nothing
// outside providers/ knows the vendor's wire shape. Raw HTTP is used on
// purpose — RAIMOSA's server ships dependency-free on a bundled runtime.
//
// Model: Claude Fable 5.1 (the owner asked for it by name). Its API rules:
// thinking is always on (omit the parameter), depth is `output_config.effort`,
// and safety classifiers may end a turn with stop_reason "refusal" — so the
// server-side fallback is enabled by default and a refusal is surfaced as a
// refusal, never as an empty answer.

import { PROVIDER_KIND } from "../providers.mjs";

const KEY_NAME = "ANTHROPIC_API_KEY";
const MODEL = "claude-fable-5-1";
const API_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const CACHE_MS = 30_000;

export function createAnthropicProvider({ vault, fetchImpl = fetch }) {
  let cached = { at: 0, present: false };

  async function key(by) {
    return vault ? vault.read(KEY_NAME, { by }) : null;
  }
  async function refresh() {
    const present = Boolean(
      vault && (await vault.read(KEY_NAME, { by: "provider-check" })),
    );
    cached = { at: Date.now(), present };
    return present;
  }

  return {
    id: "anthropic",
    name: "Anthropic (Claude)",
    kind: PROVIDER_KIND.TEXT,
    capabilities: ["text"],
    privacy: "external",
    costRank: 3,
    keyName: KEY_NAME,
    models: { text: MODEL },
    configured() {
      if (Date.now() - cached.at > CACHE_MS) void refresh();
      return cached.present;
    },
    refresh,

    /**
     * Single-turn completion. `effort` defaults to low: OVIA AI answers are
     * short and grounded, and the facts arrive already established.
     */
    async complete({
      system,
      input,
      maxOutputTokens = 1024,
      effort = "low",
    } = {}) {
      const apiKey = await key("ovia-text");
      if (!apiKey)
        throw new Error(
          "Anthropic is not configured (no ANTHROPIC_API_KEY in the vault).",
        );
      const response = await fetchImpl(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
            "anthropic-beta": FALLBACK_BETA,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: maxOutputTokens,
            system: system ?? undefined,
            output_config: { effort },
            fallbacks: "default",
            messages: [{ role: "user", content: String(input ?? "") }],
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Anthropic responded ${response.status}.`);
      const data = await response.json();
      if (data.stop_reason === "refusal") {
        return {
          provider: "anthropic",
          model: data.model ?? MODEL,
          text: "",
          refused: true,
          reason:
            data.stop_details?.explanation ??
            data.stop_details?.category ??
            "refused",
          usage: data.usage ?? null,
        };
      }
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return {
        provider: "anthropic",
        model: data.model ?? MODEL,
        text,
        refused: false,
        usage: data.usage ?? null,
      };
    },
  };
}
