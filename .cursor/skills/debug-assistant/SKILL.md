---
name: debug-assistant
description: Guides the agent through debugging bugs in the expense tracker app. Use when the user reports a bug, error, unexpected behavior, or something "not working". If the description is vague, ask triage questions before touching any code.
---

# Debug Assistant — Expense Tracker

## When to activate

Use this skill when the user:
- Reports a bug, error, or unexpected behavior
- Says "it doesn't work", "it's broken", "I have a problem", "something failed"
- Mentions a console error, a wrong value, or an unexpected screen

---

## Step 1 — Triage (ask questions if the description is vague)

If the report does not include at least **what happened** and **where**, ask these questions before touching the code. Don't ask all at once — start with the most relevant ones for the context:

### Triage questions

**What did you see that shouldn't have happened?** (or: what did you expect to happen that didn't?)
> Example: "I typed '20 lunch' and the amount shows as 0"

**Which part of the app did it happen in?**
- Chat / expense input
- Expense history
- Summary
- Settings
- Login / Microsoft authentication
- Profile or profile switch (Personal / Pareja)
- OneDrive / Excel sync

**What did you do just before it happened?**
> Example: "I typed the expense, tapped send, and the chat went blank"

**Is there any error message?**
- On the screen (toast, chat message)
- In the browser console (F12 → Console)
- In the Network tab (F12 → Network) — red request

**What device / browser did it happen on?**
- Phone (iOS Safari / Android Chrome) or desktop
- Always happens, or only sometimes

**Did it happen after a recent change?** (new commit, code edit)

---

## Step 2 — Classify the bug

Once you have the description, map it to the affected area:

| Symptom | Likely area | File |
|---------|-------------|------|
| Parser doesn't extract amount, category, or description | `parseExpense`, `parsePaidBy` | `js/utils.js` |
| Wrong date or unusual format | `formatDate`, `toLocalISODate` | `js/utils.js` |
| Category not detected or misassigned | `detectCategory` | `js/utils.js` |
| Summary shows incorrect totals | `buildSummary`, `formatCurrency` | `js/utils.js` |
| Error saving to OneDrive / Excel | Graph API call, expired token | `js/app.js` |
| Login fails or token doesn't refresh | PKCE flow, `refreshToken` | `js/app.js` |
| UI doesn't show expense after submitting | DOM update, `renderHistory` | `js/app.js` |
| Profile or settings don't persist | `localStorage`, active profile | `js/app.js` |
| Pareja / sharing not working | `invitePartner`, `discoverSharedFile` | `js/app.js` |

---

## Step 3 — Investigate

### For pure logic bugs (utils.js)

1. Read the suspected function in `js/utils.js`
2. Find or write a test in `tests.html` that reproduces the bug
3. Confirm the test fails (Red)
4. Fix the minimum code needed (Green)
5. Verify no existing tests break

```js
// Regression test example
test('parseExpense with empty input does not throw', () => {
  const result = parseExpense('');
  assertFalsy(result);
});
```

### For DOM / API bugs (app.js)

1. Ask the user for the exact console error if they don't have it
2. Read the affected function in `js/app.js`
3. Identify whether it is: network error, expired token, state issue, or render bug
4. For Graph API errors, check the HTTP status and error body in the Network tab
5. Propose the minimal fix

### For auth / OneDrive bugs

Ask:
- Did the token expire? (401 error in Network tab)
- Does the Excel file exist in OneDrive with the correct name set in Settings?
- Does the profile have the right permissions (Files.ReadWrite)?

---

## Step 4 — Verify the fix

- If the bug was logic-based: tests at `http://localhost:8080/tests.html` must pass
- If it was DOM/API: the user confirms correct behavior in the browser
- Check that no new linter errors were introduced

---

## App constraints (do not violate)

- `js/utils.js` — pure functions only, no DOM access, no side effects
- `js/app.js` — DOM + auth + Graph API
- No npm, no build step, no frameworks
- Do not change the dark mobile-first UI
- TDD required for any changes to `utils.js`

---

## Response to the user

When the debug is done, report:
1. **Root cause** — what was failing and why
2. **Fix applied** — what changed (function, line)
3. **How to verify** — concrete steps to confirm it's resolved
4. **Test added** — if applicable, mention the new test in `tests.html`
