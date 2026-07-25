import assert from "node:assert/strict";
import { test } from "node:test";

import { isLoginTrigger } from "../hooks/login-trigger.mjs";

test("isLoginTrigger fires only when the WHOLE prompt is the login trigger", () => {
  for (const yes of ["crustdata login", "  crustdata login  ", "Crustdata Login", "CRUSTDATA   LOGIN"]) {
    assert.equal(isLoginTrigger(yes), true, `should match: "${yes}"`);
  }
  // Must NOT fire on prompts that merely mention it, partials, or non-strings.
  for (const no of ["how do I do crustdata login?", "crustdata", "login", "crustdata login now", "log in to crustdata", "", null, undefined]) {
    assert.equal(isLoginTrigger(no), false, `should NOT match: ${JSON.stringify(no)}`);
  }
});
