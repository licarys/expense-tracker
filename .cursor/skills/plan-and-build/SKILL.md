---
name: plan-and-build
description: >-
  Full development workflow for the expense tracker: runs the senior-developer
  skill to produce a plan, pauses for user approval, then runs the
  implement-plan skill to execute it. Loops if the user requests changes to the
  plan. Use when the user says "plan and build X", "build feature Y end to
  end", "full workflow for Z", or "plan-and-build".
---

# Plan and Build

Orchestrates the full cycle: **Plan → Approve → Implement**. Loops on revision. No code is written until the plan is approved.

---

## Phase 1 — Plan (senior-developer)

Read and follow `.cursor/skills/senior-developer/SKILL.md` in full.

Produce the complete plan: summary, affected files, unit tests to write first, implementation steps, edge cases, out of scope.

Do not write any code. Do not edit any file.

---

## Phase 2 — Approval gate

After producing the plan, use `AskQuestion` with exactly these options:

```
prompt: "Plan ready. What do you want to do?"
options:
  - "Implement it — looks good"
  - "Revise the plan — I'll tell you what to change"
  - "Cancel"
```

### If "Implement it":
Proceed to Phase 3.

### If "Revise the plan":
Ask the user what to change (one focused question or free text). Update the plan. Return to Phase 2.

### If "Cancel":
Stop. Do not modify any file.

---

## Phase 3 — Implement (implement-plan)

Read and follow `.cursor/skills/implement-plan/SKILL.md` in full.

Execute each step in the order defined in the approved plan:

1. Write failing tests in `tests.html` for every `utils.js` change (Red)
2. Implement minimal code to pass them (Green)
3. Refactor without breaking tests
4. Run `ReadLints` after every file edit
5. Ask the user to verify DOM/`app.js` changes in the browser

---

## Phase 4 — Done report

When all steps are complete, output:

```
✅ Done
──────────────────────────────
Files changed:   [list]
Tests added:     [count] — all passing
Linter errors:   none
──────────────────────────────
Verify at: http://localhost:8080/tests.html
```

If anything in the done checklist failed, list it explicitly instead of marking it ✅.
