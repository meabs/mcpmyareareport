import test from "node:test";
import assert from "node:assert/strict";

import { classifyInputType } from "../src/usage-analytics.js";

test("classifies lookup inputs into broad non-raw usage categories", () => {
  assert.equal(classifyInputType("SW1A 2AA"), "postcode");
  assert.equal(classifyInputType("YO1"), "outcode");
  assert.equal(classifyInputType("10001"), "zip");
  assert.equal(classifyInputType("1600 Pennsylvania Ave NW, Washington, DC 20500"), "address");
  assert.equal(classifyInputType("Miami, FL"), "place");
});
