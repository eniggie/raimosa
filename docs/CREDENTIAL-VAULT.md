# RAIMOSA Credential Vault

The vault is a broker over the operating system's secure store, not a store of
its own.

| Platform | Backend | Status |
|---|---|---|
| macOS | login Keychain via `/usr/bin/security`, service prefix `RAIMOSA:` | **verified** (real round-trip in the test suite) |
| Windows | Credential Manager / DPAPI | not yet — storing is refused with an honest message |
| Linux | Secret Service | not yet — storing is refused with an honest message |

## Guarantees

- A secret never enters RAIMOSA's database, the receipt ledger, a log line, or
  an API response. The state DB holds an **index of names** only.
- **No route returns a value.** The API can store (`/vault/put`), list names
  (`/vault/status`), and remove (`/vault/remove`). RAIMOSA's own components —
  for example the OpenAI provider adapter — read a value in-process with
  `vault.read(name)`, use it there, and leave a `vault-secret-used` receipt
  that names the secret and the caller, not the value.
- Storing requires a live All Access session. Removing additionally requires a
  typed `CONFIRM`.
- Receipts (`vault-secret-stored` / `-used` / `-removed`) carry the name, the
  byte length, and the backend — never the value and never a hash of it.
- The `RAIMOSA:` service prefix means the vault cannot see or touch any
  keychain item it did not create.

## Using it

Store `OPENAI_API_KEY` in the Vault screen and the OpenAI provider adapter
reports `configured:true`; until then OVIA AI stays honest and local.

Known limit: `security add-generic-password -w` passes the value as a process
argument, which is briefly visible to other processes running as the same
user. This is the standard macOS CLI behaviour; a native Keychain call would
close it and is the recommended next step for a hardened build.
