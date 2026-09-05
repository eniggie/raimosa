# Connecting an AI agent to RAIMOSA Sentinel (MCP)

Sentinel supervises agents that **report to it**. Any MCP-compatible agent —
Codex, Claude Code, Gemini CLI, a browser agent — connects through the bridge
`app/bin/raimosa-mcp.mjs`, which speaks the Model Context Protocol over stdio
and forwards to the running RAIMOSA adapter on loopback.

Nothing is enforced in the bridge. Every rule lives in the adapter, so an
agent that bypasses the bridge and calls the API directly gets exactly the
same treatment.

## The contract an agent gets

| The agent can… | Sentinel's response |
|---|---|
| register itself (`sentinel_register_agent`) | a registry row, a budget, an approved root |
| create a task with acceptance criteria | `PLANNED` |
| say it is done (`sentinel_claim_complete`) | **`CLAIMED`** — recorded `verified:false`, honesty `UNCERTAIN`. Never trusted. |
| ask to be verified (`sentinel_request_verification`) | Sentinel runs **its own** allowlisted checks in the approved root; status comes from that evidence only |
| ask for approval (`sentinel_request_approval`) | `pending` — an agent can never approve itself |
| report spend (`sentinel_record_usage`) | over budget → paused |

There is deliberately **no tool that runs a desktop action**. Agents report;
the owner decides; Sentinel verifies.

## Register

Start the adapter first (`raimosa`, default port 4173).

**Claude Code**

```bash
claude mcp add --scope user raimosa -- node /path/to/RAIMOSA/app/bin/raimosa-mcp.mjs
```

**Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.raimosa]
command = "node"
args = ["/path/to/RAIMOSA/app/bin/raimosa-mcp.mjs"]
```

Non-default port: set `RAIMOSA_URL=http://127.0.0.1:<port>` in the server's
environment.

## What the owner sees

Every call becomes a receipt in the tamper-evident ledger (`sentinel-*`). The
Sentinel screen shows the agent, its task, the claim text kept visibly separate
from the verification evidence, and any approval waiting for a decision. The
phone remote shows the same and can approve or deny; a Level 3 approval still
requires the desktop's live All Access underneath.

## Honesty vocabulary on evidence

`KNOWN` (a fact RAIMOSA holds) · `VERIFIED` (Sentinel observed it) ·
`INFERRED` (derived) · `UNCERTAIN` (an agent's statement) · `UNKNOWN` (could
not be checked). A trust score is `INFERRED` from verification history and is
labelled "not a guarantee".
