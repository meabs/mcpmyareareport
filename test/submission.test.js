import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const submission = JSON.parse(fs.readFileSync(new URL("../chatgpt-app-submission.json", import.meta.url), "utf8"));

test("submission defines exactly five positive review test cases", () => {
  assert.equal(submission.test_cases.length, 5);
  assert.deepEqual(
    submission.test_cases.map(testCase => testCase.user_prompt),
    [
      "Show me an area report for 10001.",
      "Are there any flood or severe weather alerts near Miami, FL?",
      "What is crime like around Austin, TX?",
      "What are house prices like around 90210?",
      "Show me an area report for Chester.",
    ],
  );
});

test("submission describes UK and USA scope and caveats", () => {
  assert.match(submission.app_info.subtitle, /UK and USA/);
  assert.match(submission.app_info.description, /USA results/);
  assert.match(submission.app_info.description, /street-level parity/);
  assert.ok(submission.negative_test_cases.some(testCase => testCase.user_prompt.includes("Paris")));
});
