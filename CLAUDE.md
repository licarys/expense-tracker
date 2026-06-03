# Expense Tracker — Project Rules

## What this is

Mobile-first expense tracker that runs entirely in the browser. No backend, no build step, no npm.

**Live:** https://licarys.github.io/expense-tracker  
**Full spec:** see `PROJECT.md`

## Tech constraints (non-negotiable)

- `index.html` is the app shell (HTML + CSS only — no inline JS)
- DOM logic, auth, and Graph API calls live in `js/app.js`
- Pure functions extracted to `js/utils.js` (no DOM access, no side effects)
- No npm, no framework, no build step
- Must remain deployable as a static file on GitHub Pages
- Do not change the dark mobile-first UI
- Do not add any paid APIs

## File structure

| File | Role |
|---|---|
| `index.html` | App shell: HTML + CSS only (loads `js/utils.js` then `js/app.js`) |
| `js/app.js` | DOM logic + auth + Graph API calls |
| `js/utils.js` | Pure utility functions (parser, dates, currency, categories) |
| `tests.html` | Browser-based unit test suite (imports `js/utils.js`) |

## TDD — mandatory

Every new function or behavior change must follow Red → Green → Refactor:

1. **Red** — write a failing test in `tests.html` first.
2. **Green** — write the minimal code in `utils.js` to make it pass.
3. **Refactor** — clean up without breaking tests.

Never write implementation code without a failing test first.

Run tests at: `http://localhost:8080/tests.html`

### Adding a test

```js
test('parseExpense handles "spent 20 on lunch"', () => {
  const result = parseExpense('spent 20 on lunch');
  assertEqual(result.amount, 20);
  assertEqual(result.category, 'food');
});
```

Available helpers: `test`, `assertEqual`, `assertContains`, `assertTruthy`, `assertFalsy`.

### Done checklist

- [ ] Test written and was failing before implementation
- [ ] Test passes now
- [ ] No existing tests broken
- [ ] `js/utils.js` functions remain pure

## After every git commit or push

Review `PROJECT.md` and update if needed:
- Mark completed roadmap items with ✅
- Add new features or fixes to the Features section
- Update Known issues
- Refresh the Cursor prompt block if the architecture changed

Only update if something actually changed — no trivial edits.
