import { randomUUID } from "node:crypto";

export const capabilityCatalog = [
  {
    id: "raimosa-health-scan",
    title: "Scan the local RAIMOSA runtime",
    status: "available",
    risk: "read-only",
    adapter: "local-runtime-health",
    description:
      "Verify the workspace, capability registry, platform adapters, and authority controls.",
  },
  {
    id: "find-files",
    title: "Find files and local knowledge",
    status: "available",
    risk: "read-only",
    adapter: "local-filesystem",
    description:
      "Search approved folders by filename and bounded text content.",
  },
  {
    id: "summarize-folder",
    title: "Summarize a folder",
    status: "available",
    risk: "read-only",
    adapter: "local-filesystem",
    description:
      "Report file counts, sizes, types, and recent changes inside an approved folder.",
  },
  {
    id: "organize-files",
    title: "Organize, rename, move, and archive files",
    status: "available",
    risk: "reversible-write",
    adapter: "local-filesystem",
    description:
      "Create an exact plan first, then execute it with a one-time approval.",
  },
  {
    id: "create-work-product",
    title: "Create documents, spreadsheets, and presentations",
    status: "available",
    risk: "write-new-file",
    adapter: "local-filesystem",
    description:
      "Create verified Markdown, CSV, or HTML presentation files without overwriting.",
  },
  {
    id: "applications",
    title: "Open and close supported applications",
    status: process.platform === "darwin" ? "available" : "unavailable",
    risk: "application-control",
    adapter: process.platform === "darwin" ? "macos-open-osascript" : null,
    description:
      "Discover installed macOS applications and control only an exact selected application.",
  },
  {
    id: "process-status",
    title: "Inspect applications and long-running processes",
    status: "available",
    risk: "read-only",
    adapter: "process-status",
    description: "Read bounded process status without arbitrary shell access.",
  },
  {
    id: "agent-runtime-monitor",
    title: "Discover and monitor local AI agent runtimes",
    status: "available",
    risk: "read-only",
    adapter: "local-agent-runtime-monitor",
    description:
      "Detect supported local agent CLIs and their running processes without reading prompts, transcripts, credentials, or private state.",
  },
  {
    id: "folder-monitor",
    title: "Monitor exports, renders, downloads, and uploads",
    status: "available",
    risk: "read-only",
    adapter: "folder-snapshot",
    description:
      "Compare approved-folder snapshots and report added, removed, or changed files.",
  },
  {
    id: "local-notification",
    title: "Send a local notification",
    status: process.platform === "darwin" ? "available" : "unavailable",
    risk: "visible-side-effect",
    adapter: process.platform === "darwin" ? "macos-notification" : null,
    description:
      "Display a visible local macOS notification after an explicit request.",
  },
  {
    id: "open-document",
    title: "Open a document",
    status: process.platform === "darwin" ? "available" : "unavailable",
    risk: "application-control",
    adapter: process.platform === "darwin" ? "macos-open" : null,
    description: "Open one exact file inside the approved folder.",
  },
  {
    id: "mobile-remote",
    title: "Use a phone as a desktop remote",
    status: "available",
    risk: "paired-control",
    adapter: "local-network-pairing",
    description:
      "Pair one phone over the local network to the current visible All Access session; revocation is immediate.",
  },
  {
    id: "system-power",
    title: "Sleep, restart, or shut down",
    status: "unavailable",
    risk: "high-impact",
    adapter: null,
    description:
      "Hidden until a separately authenticated and end-to-end verified power adapter exists.",
  },
  {
    id: "screen-capture",
    title: "Capture and manage screenshots",
    status: "unavailable",
    risk: "sensitive-read",
    adapter: null,
    description:
      "Hidden until screen-recording permission and a verified destination flow are available.",
  },
  {
    id: "model-reasoning",
    title: "Model-powered reasoning",
    status: "unavailable",
    risk: "external-provider",
    adapter: null,
    description:
      "The local OVIA AI Core works without a model. Provider reasoning stays unavailable until configured and verified.",
  },
  {
    id: "agent-command-bridge",
    title: "Command external AI agents",
    status: "unavailable",
    risk: "external-agent-control",
    adapter: null,
    description:
      "No universal agent-control protocol exists. A named, authenticated Codex, Claude, Grok, Gemini, or other provider adapter must be configured and verified before RAIMOSA AI can dispatch work to it.",
  },
];

const intentRules = [
  {
    id: "raimosa-health-scan",
    words: ["health scan", "scan raimosa", "diagnose raimosa", "debug raimosa"],
  },
  {
    id: "agent-command-bridge",
    words: [
      "command codex",
      "command claude",
      "command grok",
      "control agent",
      "dispatch agent",
    ],
  },
  {
    id: "agent-runtime-monitor",
    words: [
      "monitor agent",
      "find agents",
      "agent runtime",
      "codex status",
      "claude status",
      "grok status",
    ],
  },
  {
    id: "find-files",
    words: ["find", "search", "locate", "document", "knowledge"],
  },
  {
    id: "summarize-folder",
    words: ["summarize", "summary", "inventory", "folder"],
  },
  {
    id: "organize-files",
    words: ["organize", "rename", "move", "archive", "clean", "downloads"],
  },
  {
    id: "create-work-product",
    words: [
      "create",
      "generate",
      "document",
      "spreadsheet",
      "presentation",
      "report",
    ],
  },
  {
    id: "applications",
    words: ["open app", "launch", "close app", "application", "software"],
  },
  { id: "process-status", words: ["process", "running", "status", "job"] },
  {
    id: "folder-monitor",
    words: [
      "monitor",
      "watch",
      "export",
      "render",
      "download",
      "upload",
      "completion",
    ],
  },
  { id: "local-notification", words: ["notify", "notification", "alert me"] },
  { id: "system-power", words: ["sleep", "restart", "shutdown", "shut down"] },
  { id: "screen-capture", words: ["screenshot", "screen capture"] },
];

export function planCommand(command, { root } = {}) {
  const text = String(command ?? "").trim();
  const lower = text.toLowerCase();
  const matches = intentRules
    .map((rule) => ({
      ...rule,
      score: rule.words.reduce(
        (score, word) => score + (lower.includes(word) ? 1 : 0),
        0,
      ),
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score);
  // No keyword match means OVIA AI does not understand the request. Say so.
  // Defaulting to some capability here would be a fail-open normalizer: the
  // plan would claim an intent the user never expressed.
  if (matches.length === 0) {
    return {
      id: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`,
      command: text,
      intent: "Unrecognized request",
      capabilityId: null,
      scope: root || "Scope required before execution",
      risk: "none",
      adapter: null,
      available: false,
      requiresApproval: false,
      decision: "clarification-needed",
      explanation:
        "OVIA AI could not match this request to a verified capability. Nothing was selected and nothing will run.",
      steps: [
        "State what outcome you want in plain words",
        "OVIA AI will select a verified adapter only when the intent is clear",
        "No execution control is offered for an unrecognized request",
      ],
    };
  }

  const selectedId = matches[0].id;
  const capability = capabilityCatalog.find((item) => item.id === selectedId);
  const available = capability?.status === "available";
  const requiresApproval = !["read-only"].includes(capability?.risk);

  return {
    id: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`,
    command: text,
    intent: capability?.title ?? "Unknown intent",
    capabilityId: selectedId,
    scope: root || "Scope required before execution",
    risk: capability?.risk ?? "unknown",
    adapter: capability?.adapter,
    available,
    requiresApproval,
    decision: available
      ? requiresApproval
        ? "approval-required"
        : "ready-read-only"
      : "unavailable",
    explanation: available
      ? `OVIA AI selected the ${capability.title} adapter because it best matches the request.`
      : `${capability?.title ?? "This capability"} is not available because no verified adapter is installed.`,
    steps: [
      "Confirm intent and exact scope",
      available ? `Use ${capability.adapter}` : "Stop before execution",
      requiresApproval ? "Request explicit approval" : "Remain read-only",
      available
        ? "Create a receipt and verify the result"
        : "Offer no execution control",
    ],
  };
}

export function oviaDoctrine() {
  return {
    name: "OVIA AI Core",
    version: "1.0.0-local",
    modelProvider: null,
    principles: [
      "Understand the outcome before selecting a tool.",
      "Inspect current evidence instead of assuming state.",
      "Use only adapters that report available.",
      "Bind every action to an exact scope.",
      "Classify risk before execution.",
      "Require approval for writes and visible side effects.",
      "Create a receipt for every adapter call.",
      "Verify the observable result before claiming success.",
      "State uncertainty and unavailable capability plainly.",
      "Never claim an action ran without a verified adapter receipt.",
      "Report every detected issue and failed check; never hide, soften, or silently skip a finding.",
      "Coordinate another AI agent only through a named, authenticated, revocable adapter, and never inherit that agent's credentials or authority.",
      "Never inherit credentials, publishing authority, money movement, or arbitrary shell access.",
      "Treat a paired phone as a revocable remote for this desktop, never as silent inherited authority.",
    ],
  };
}
