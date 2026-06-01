# Expense Tracker

A mobile-first expense tracking web app that runs entirely in the browser — **no backend, no server, no subscription**. Log expenses in seconds with natural language input.

**Live app:** https://licarys.github.io/expense-tracker

---

## Features

✨ **Natural language input** — Type `"Lunch with Ana $18 food"` and it automatically extracts the description, amount, and category.

📱 **Mobile-first design** — Add to your home screen as a shortcut and log expenses in under 10 seconds.

☁️ **OneDrive sync** — Expenses sync directly to an Excel file in your OneDrive (no backend needed).

💰 **Budget tracking** — Set monthly limits for 6 default categories and get alerts when you go over.

📊 **Expense history** — View all your logged expenses with visual progress bars.

⚙️ **Customizable** — Adjust budget limits and Excel filename in the settings panel.

🌙 **Dark UI** — Clean, readable dark theme optimized for mobile.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Single `index.html` (HTML/CSS/JS) | No build step, works as a static file |
| Hosting | GitHub Pages | Free, permanent, no server needed |
| Storage | Microsoft OneDrive + Excel | Already have Microsoft 365 |
| Auth | Microsoft OAuth 2.0 (implicit flow) | No backend required |
| API | Microsoft Graph API | Read/write Excel files in OneDrive |
| Fonts | DM Sans + DM Mono (Google Fonts) | Clean, readable on mobile |

**No npm. No framework. No backend. No paid services.**

---

## Quick Start

### Run Locally

Just open `index.html` in a browser. No build step needed.

```bash
# Or use a local server for OAuth testing
python -m http.server 8080
# Then open http://localhost:8080
```

> **Note:** OAuth redirect won't work from `file://` — use a local server or test directly from the [live app](https://licarys.github.io/expense-tracker).

For local development, add `http://localhost:8080` as a redirect URI in the Azure Portal.

---

## How It Works

1. **Sign in** with your Microsoft account (OAuth token stored in localStorage)
2. **Type naturally** — e.g., `"Lunch with Ana $18 food"` or `"Uber $15 transport"`
3. **Auto-parse** — The app extracts description, amount, and category locally (no AI API calls)
4. **Sync to OneDrive** — Expense saved as a row in `expenses.xlsx` in your OneDrive root
5. **Track budget** — See spending vs. budget with visual progress bars

---

## Budget Categories

| Category | Default Budget |
|----------|-----------------|
| Food | $300 |
| Transport | $150 |
| Entertainment | $100 |
| Health | $200 |
| Shopping | $250 |
| Other | $100 |

All budgets are customizable in the settings panel and saved to localStorage.

---

## Excel File Structure

**File:** `expenses.xlsx` (OneDrive root, configurable)  
**Sheet:** `Sheet1`

| Column | Purpose |
|--------|---------|
| A | Date |
| B | Description |
| C | Amount |
| D | Category |

One row per expense. Headers written automatically on first use.

---

## Known Issues & Next Steps

- [ ] Token expiration not handled — 401 errors should redirect to sign-in
- [ ] Header row check — only write headers if sheet is empty
- [ ] Natural language parser needs improvement for edge cases (`"spent 20 on lunch"`, `"paid $8.5 uber"`)
- [ ] Summary command in chat — formatted monthly breakdown
- [ ] Test OneDrive read on session reload — verify expenses load correctly
- [ ] Monthly data scope — currently filters to current month only on load

---

## Roadmap

### V1 (Current — Personal Use)
- Stable OneDrive sync
- Reliable natural language parsing
- Monthly budget summaries in chat

### V2 (If Habit Validated)
- Migrate to Laravel + Vue
- Proper database (MySQL)
- User accounts
- Weekly/monthly email reports
- PWA with push notifications for daily reminders

---

## Azure App Registration

- **App name:** expense-tracker
- **Client ID:** `96029ed9-a4f6-4eed-97e8-a5f1e2e58adc`
- **Account type:** Personal Microsoft accounts only
- **Auth flow:** Single-page application (SPA), implicit token
- **Redirect URI:** `https://licarys.github.io/expense-tracker`
- **Scopes:** `Files.ReadWrite offline_access`

---

## Development

This is a single-file project — all HTML, CSS, and JavaScript live in `index.html`.

**No npm, no build step, no framework.** The app must remain deployable as a static file on GitHub Pages.

See [PROJECT.md](PROJECT.md) for more technical details and the development prompt for Claude.
