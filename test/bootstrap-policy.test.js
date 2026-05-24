import test from "node:test";
import assert from "node:assert/strict";

import { shouldUseDemoFallback } from "../src/bootstrap-policy.js";

test("normal mode with no host result does not use demo fallback", () => {
  assert.equal(shouldUseDemoFallback({ bootstrapped: false, demoModeEnabled: false }), false);
});

test("demo mode with no host result can use demo fallback", () => {
  assert.equal(shouldUseDemoFallback({ bootstrapped: false, demoModeEnabled: true }), true);
});

test("host result present prevents fallback fetch", () => {
  assert.equal(shouldUseDemoFallback({ bootstrapped: true, demoModeEnabled: true }), false);
});
