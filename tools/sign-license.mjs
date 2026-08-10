#!/usr/bin/env node
// Mint a RAIMOSA Pro license key by hand. ECONTEUR-side only — needs the
// private signing key, which lives OUTSIDE the repo and must never be committed.
//
//   node tools/sign-license.mjs "buyer@email.com"
//
// Private key path resolves from RAIMOSA_LICENSE_KEY or ~/.raimosa-keys/.
// Print the emitted key and email it to the buyer. For automatic delivery on
// purchase, run store/fulfillment/server.mjs instead — it imports the same
// minting core (tools/mint-license.mjs).

import { mintLicenseKey, resolveKeyPath } from "./mint-license.mjs";

const holder = process.argv[2];
if (!holder) {
  console.error('Usage: node tools/sign-license.mjs "buyer@email.com"');
  process.exit(1);
}

let result;
try {
  result = mintLicenseKey(holder);
} catch (error) {
  console.error(
    `Could not mint a key (signing key at ${resolveKeyPath()}): ${error.message}`,
  );
  process.exit(1);
}

console.log(
  `\n  RAIMOSA Pro license for ${result.payload.h} (issued ${result.payload.i})\n`,
);
console.log(`  ${result.key}\n`);
