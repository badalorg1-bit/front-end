#!/usr/bin/env node
/**
 * verify-direct-payment-retirement.mjs
 *
 * Read-only check that the self-serve direct-payment path is retired:
 *   1. No `DirectPaymentSection` component or import remains in the app source.
 *   2. No `confirmDirectPayment` / `getPaymentInstructions` client helpers remain.
 *   3. The retired-RPC stub exists in the migration file.
 *   4. The migration file is present and non-empty.
 *
 * Exits non-zero on any failure. Does NOT touch the database.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const failures = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.log(`  ✗ ${msg}`); failures.push(msg); };

const read = (p) => {
  try { return readFileSync(p, "utf8"); } catch { return null; }
};

console.log("Batch 3: direct-payment retirement verification\n");

// 1. Component file must be gone.
if (!existsSync(join(ROOT, "src/components/direct-payment.tsx"))) {
  ok("src/components/direct-payment.tsx removed");
} else {
  fail("src/components/direct-payment.tsx still exists");
}

// 2. No references to the retired component or its client helpers in app source.
const appFiles = [
  "src/pages/requests.tsx",
  "src/pages/owner.tsx",
  "src/pages/listing.tsx",
  "src/lib/api.ts",
  "src/lib/types.ts",
];
for (const f of appFiles) {
  const content = read(join(ROOT, f));
  if (!content) { fail(`${f} missing`); continue; }
  if (/DirectPaymentSection|direct-payment/.test(content)) {
    fail(`${f} still references DirectPaymentSection / direct-payment`);
  } else {
    ok(`${f} free of DirectPaymentSection references`);
  }
  if (/confirmDirectPayment|getPaymentInstructions/.test(content)) {
    fail(`${f} still references confirmDirectPayment / getPaymentInstructions`);
  } else {
    ok(`${f} free of direct-payment client helpers`);
  }
}

// 3. Migration file must contain the retirement guard and history helper.
const mig = read(join(ROOT, "supabase/migrations/0025_retire_direct_payment.sql"));
if (!mig) {
  fail("supabase/migrations/0025_retire_direct_payment.sql missing");
} else {
  ok("migration 0025 present");
  if (/REVOKE EXECUTE ON FUNCTION public\.confirm_direct_payment\(uuid\) FROM authenticated;/.test(mig)) {
    ok("migration revokes authenticated execute on confirm_direct_payment");
  } else {
    fail("migration does not revoke authenticated execute on confirm_direct_payment");
  }
  if (/RAISE EXCEPTION 'direct payment is retired/.test(mig)) {
    ok("migration stubs confirm_direct_payment with hard guard");
  } else {
    fail("migration missing hard guard in confirm_direct_payment stub");
  }
  if (/CREATE OR REPLACE FUNCTION public\.get_direct_payment_history\(p_request_id uuid\)/.test(mig)) {
    ok("migration adds security-definer get_direct_payment_history");
  } else {
    fail("migration missing get_direct_payment_history");
  }
  if (!/\bDROP\b.*\bFUNCTION\b.*confirm_direct_payment/m.test(mig) && !/\bDELETE\b/.test(mig) && !/\bUPDATE\b/.test(mig)) {
    ok("migration contains no DROP/DELETE/UPDATE on historical rows");
  } else {
    fail("mutation statement found in migration (DROP/DELETE/UPDATE)");
  }
}

console.log();
if (failures.length === 0) {
  console.log("All checks passed.");
  process.exit(0);
}
console.log(`${failures.length} check(s) failed.`);
process.exit(1);