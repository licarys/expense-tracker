# Expense Tracker

**Repo:** https://github.com/licarys/expense-tracker  
**Live app:** https://licarys.github.io/expense-tracker  
**Status:** MVP in progress

---

## What it is

A mobile-first expense tracking web app that runs entirely in the browser — no backend, no server, no subscription. You type a quick message like "Lunch with Ana $18 food" and it logs the expense directly to an Excel file in your personal OneDrive.

Designed to live as a home screen shortcut on your phone so logging an expense takes less than 10 seconds.

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Single `index.html` (HTML/CSS/JS) | No build step, works as a static file |
| Hosting | GitHub Pages | Free, permanent, no server needed |
| Storage | Microsoft OneDrive via Excel | Already have a Microsoft 365 account |
| Auth | Microsoft OAuth 2.0 (implicit flow) | No backend required |
| API | Microsoft Graph API | Read/write Excel files in OneDrive |
| Fonts | DM Sans + DM Mono (Google Fonts) | Clean, readable on mobile |

No npm. No framework. No backend. No paid services.

---

## Azure app registration

- **App name:** expense-tracker
- **Client ID:** `96029ed9-a4f6-4eed-97e8-a5f1e2e58adc`
- **Account type:** Personal Microsoft accounts only
- **Auth flow:** Single-page application (SPA), implicit token
- **Redirect URI:** `https://licarys.github.io/expense-tracker`
- **Scopes:** `Files.ReadWrite offline_access`

---

## Features (current MVP)

- Microsoft sign-in — OAuth token stored in localStorage, persists across sessions
- Chat interface — type natural language to log expenses
- Natural language parser — extracts description, amount, and category from free text (regex-based, local, no AI API)
- Budget tracking — 6 default categories with configurable monthly limits
- Progress bars — visual spending vs budget per category
- Over-budget alerts — warning when a category exceeds its limit
- Expense history — chronological list of all logged expenses
- OneDrive sync — each expense saved as a row in `expenses.xlsx` in OneDrive root
- Settings panel — adjust monthly budgets and Excel filename
- Mobile-first dark UI — safe area support, add-to-home-screen ready

---

## Expense categories

| Category | Default budget |
|---|---|
| Food | $300 |
| Transport | $150 |
| Entertainment | $100 |
| Health | $200 |
| Shopping | $250 |
| Other | $100 |

All budgets are configurable in the settings panel and saved to localStorage.

---

## Excel file structure

File: `expenses.xlsx` (OneDrive root, configurable)  
Sheet: `Sheet1`

| Column A | Column B | Column C | Column D |
|---|---|---|---|
| Date | Description | Amount | Category |

One row per expense. Header row written on first use.

---

## Known issues / next steps

- [ ] Token expiration not handled — 401 errors should redirect to sign-in
- [ ] Header row check — only write headers if sheet is empty
- [ ] Natural language parser needs improvement for edge cases (`"spent 20 on lunch"`, `"paid $8.5 uber"`)
- [ ] Summary command in chat — formatted monthly breakdown
- [ ] Test OneDrive read on session reload — verify expenses load correctly
- [ ] Monthly data scope — currently filters to current month only on load

---

## File structure

```
expense-tracker/
└── index.html   ← entire app (HTML + CSS + JS in one file)
```

---

## How to run locally

Just open `index.html` in a browser. No build step needed.

> Note: OAuth redirect won't work from `file://` — use a local server or test directly from the GitHub Pages URL.

```bash
# Quick local server (Python)
python -m http.server 8080
# Then open http://localhost:8080
```

For local dev, add `http://localhost:8080` as an additional redirect URI in the Azure Portal under App registrations → Authentication.

---

## Roadmap

### V1 (current — personal use)
- Stable OneDrive sync
- Reliable natural language parsing
- Monthly budget summaries in chat

### V2 (if habit is validated)
- Migrate to Laravel + Vue
- Proper database (MySQL)
- User accounts
- Weekly/monthly email reports
- PWA with push notifications for daily reminders

---

## Claude Code prompt

Use this to continue development in Claude Code. Attach `index.html` to the session.

```
I'm building a personal expense tracker as a single HTML file deployed on GitHub Pages.

Repo: https://github.com/licarys/expense-tracker
Live: https://licarys.github.io/expense-tracker

Stack: pure HTML/CSS/JS, Microsoft Graph API for OneDrive, no build tools, no framework.
Auth: Microsoft OAuth implicit flow, client_id 96029ed9-a4f6-4eed-97e8-a5f1e2e58adc
Storage: Excel file (expenses.xlsx) in OneDrive root via Microsoft Graph API
UI: mobile-first dark theme, DM Sans + DM Mono fonts

The full current code is in the attached index.html.

Pending tasks:
1. Handle token expiration — detect 401 errors and redirect to sign-in
2. Add header row check — only write Date/Description/Amount/Category headers if the sheet is empty
3. Improve natural language parsing for edge cases like "spent 20 on lunch" or "paid $8.5 for uber"
4. Fix summary command — show a clean formatted monthly breakdown in the chat
5. Verify expense loading on session reload works correctly

Rules:
- Single file only — keep everything in index.html
- No npm, no build step, no framework
- Must stay deployable as a static file on GitHub Pages
- Do not change the dark mobile-first UI
- Do not add any paid APIs
```
