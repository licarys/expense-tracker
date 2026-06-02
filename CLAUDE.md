# Expense Tracker — Project Rules

## What this is

Mobile-first expense tracker that runs entirely in the browser. No backend, no build step, no npm.

**Live:** https://licarys.github.io/expense-tracker  
**Full spec:** see `PROJECT.md`

## Tech constraints (non-negotiable)

- Single `index.html` — keep everything in the app shell
- Pure functions extracted to `utils.js` (no DOM access, no side effects)
- No npm, no framework, no build step
- Must remain deployable as a static file on GitHub Pages
- Do not change the dark mobile-first UI
- Do not add any paid APIs

## File structure

| File | Role |
|---|---|
| `index.html` | App shell + DOM logic + auth + Graph API calls |
| `utils.js` | Pure utility functions (parser, dates, currency, categories) |
| `tests.html` | Browser-based unit test suite |

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
- [ ] `utils.js` functions remain pure

## After every git commit or push

Review `PROJECT.md` and update if needed:
- Mark completed roadmap items with ✅
- Add new features or fixes to the Features section
- Update Known issues
- Refresh the Cursor prompt block if the architecture changed

Only update if something actually changed — no trivial edits.
