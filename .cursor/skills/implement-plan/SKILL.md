---
name: implement-plan
description: >-
  Executes an implementation plan produced by the senior-developer skill.
  Follows TDD strictly: writes failing tests first, then minimal implementation,
  then refactors. Use when the user says "go", "implement the plan", "execute
  the plan", or after the senior-developer skill has produced a plan and the
  user has approved it.
---

# Implement Plan

Execute the approved plan step by step. TDD is mandatory for every `utils.js` change.

---

## Before starting

1. Read the plan from the current conversation (the senior-developer output).
2. If no plan exists, stop and ask the user to run the `senior-developer` skill first.
3. Confirm which step to start from (default: step 1).

---

## Execution loop

Repeat for each step in the plan:

### A — Write the failing test (Red) — `utils.js` changes only

Add the test cases from the plan's "Unit tests to write first" section to `tests.html`.

Run the test suite mentally or ask the user to open `http://localhost:8080/tests.html` and confirm the new test **fails** before proceeding. If it passes without implementation, the test is wrong — fix it first.

```js
// Example structure in tests.html
test('functionName returns X for input Y', () => {
  const result = functionName(input);
  assertEqual(result.field, expectedValue);
});
```

### B — Implement the minimal code (Green)

Write only the code needed to make the failing test pass. No extra logic.

- `js/utils.js` → pure functions only; no DOM, no side effects
- `js/app.js` → DOM, auth, Graph API, localStorage
- `index.html` → HTML + CSS only; no inline JS

### C — Verify the test passes

Ask the user to reload `http://localhost:8080/tests.html` and confirm:
- The new test now passes ✅
- No previously passing tests broke ✅

### D — Refactor (if needed)

Clean up without changing behavior. Re-run tests after any refactor.

### E — Lint check

After every file edit, run `ReadLints` on that file. Fix any errors before moving to the next step.

---

## For DOM / `app.js`-only steps

No `tests.html` test required. After implementing:
1. State what manual verification covers the change.
2. Ask the user to confirm the behavior in the browser.

---

## Done checklist

After all steps are complete, verify:

- [ ] Every `utils.js` function has a passing test in `tests.html`
- [ ] No existing tests broken
- [ ] No linter errors in any edited file
- [ ] `js/utils.js` functions remain pure (no DOM access, no side effects)
- [ ] No npm, no framework, no build step introduced

---

## Project constraints (always apply)

- No npm, no build step, no framework
- `js/utils.js` — pure functions only; no DOM, no side effects
- `js/app.js` — DOM + auth + Graph API
- `index.html` — HTML + CSS only; no inline JS
- Do not change the dark mobile-first UI
- Do not add paid APIs
