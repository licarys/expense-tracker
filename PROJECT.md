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
| Auth | Microsoft OAuth 2.0 — **PKCE flow** | Secure, no backend or client secret required |
| API | Microsoft Graph API | Read/write Excel files in OneDrive |
| Fonts | DM Sans + DM Mono (Google Fonts) | Clean, readable on mobile |

No npm. No framework. No backend. No paid services.

---

## Azure app registration

- **App name:** expense-tracker
- **Client ID:** `96029ed9-a4f6-4eed-97e8-a5f1e2e58adc`
- **Account type:** Personal Microsoft accounts only
- **Auth flow:** Authorization Code + PKCE (implicit flow disabled)
- **Redirect URI:** `https://licarys.github.io/expense-tracker/` ← trailing slash required
- **Scopes:** `Files.ReadWrite offline_access`
- **Public client:** Enabled (required for PKCE without a client secret)

---

## Features (current)

- **Multi-profile support** — Personal and Pareja profiles, each with its own Microsoft account, tokens, settings, and OneDrive file
- **Couple sharing** — Pareja owner generates an OneDrive sharing link; partner logs in with their own Microsoft account and uses the link to access the same shared file
- **PKCE auth** — Secure OAuth 2.0 authorization code flow with PKCE; refresh tokens handled automatically
- **Sign out** — Per-profile sign out from Settings; returns to profile selector
- **Profile badge** — Visible in header, tap to switch profiles
- Chat interface — type natural language to log expenses
- Natural language parser — extracts description, amount, and category from free text (regex-based, local, no AI API)
- Budget tracking — 6 default categories with configurable monthly limits per profile
- Progress bars — visual spending vs budget per category
- Over-budget alerts — warning when a category exceeds its limit
- Expense history — chronological list of all logged expenses
- OneDrive sync — each expense saved as a row in the profile's Excel file in OneDrive
- Settings panel — adjust monthly budgets and Excel filename; partner link generator for couple owners
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

| Profile | Default file | Location |
|---|---|---|
| Personal | `expenses.xlsx` | Owner's OneDrive root |
| Pareja | `expenses-pareja.xlsx` | Owner's OneDrive root (partner accesses via sharing link) |

Sheet: `Sheet1`

| Column A | Column B | Column C | Column D | Column E | Column F |
|---|---|---|---|---|---|
| Date | Description | Amount | Category | Currency | Amount (USD) |

- **Amount (C):** Original amount in the currency used when logging (e.g. 500 in córdobas).
- **Currency (E):** ISO code from input (`C$` → NIO, `MXN`, …) or `USD` when none detected.
- **Amount (USD) (F):** Value converted to USD at save time. Use this column in Excel for sums (`=SUM(F:F)`). The app uses the same field for budgets and overview totals.

One row per expense. Header row written on first use; older files get missing column headers patched on the next write.

---

## Currency architecture

| Piece | Role |
|---|---|
| `BASE_CURRENCY` | Always `USD` — budgets, hero total, and category spent/remaining |
| `detectCurrency(text)` | Parses symbols (`C$` → NIO, `€`, …) and ISO codes from chat input |
| `convertToUSD(amount, from)` | Divides by manual rate when `from` ≠ USD |
| `getExpenseAmountUSD(e)` | Uses stored `amountUsd` (column F) when present, else `convertToUSD` |
| `getExchangeRates()` | `et_exchange_rates` — e.g. `{ NIO: 36.5 }` means 1 USD = 36.5 NIO |

**Flow:** Log `Almuerzo C$150 food` → C=150, E=NIO, F≈4.11 USD (with rate 36.5). Overview sums column F values, not raw C when currency ≠ USD.

**Exchange rates** in Settings apply to foreign currencies only; no “default currency” picker.

**One-time fix (`migrateMislabeledExpensesOnLoad`):** Corrects mislabeled currency from description, backfills empty column F, updates Categories `SUMIF` to sum column F (flag `et_currency_fix_v3_{profile}`).

---

## Known issues / next steps

- [ ] Header row check — only write Date/Description/Amount/Category headers if the sheet is empty
- [ ] Natural language parser needs improvement for edge cases (`"spent 20 on lunch"`, `"paid $8.5 uber"`)
- [ ] Summary command in chat — formatted monthly breakdown
- [ ] 401 handling — detect expired token mid-session and trigger refresh or re-login
- [ ] Partner sharing link scope — currently uses `anonymous` edit link; evaluate whether `organization` scope is more appropriate
- [ ] Monthly data scope — currently filters to current month only on load
- [ ] **Pareja — quién pagó:** registrar qué persona pagó cada gasto (útil tanto para parejas como para usuarios individuales que quieran rastrear el pagador)
- [ ] **Separar JS del HTML:** extraer el `<script>` a un archivo `app.js` independiente para mejorar mantenibilidad
- [ ] **Búsqueda de categorías:** agregar un campo de búsqueda/filtro al selector de categorías, ya que la lista crece con categorías personalizadas
- [ ] **Bug — fecha "Dec 1969":** algunas fechas se parsean incorrectamente como epoch 0; investigar y corregir el manejo de fechas en `loadExpensesFromSheet`
- [x] **Conversión de monedas:** tasas manuales en Settings, totales convertidos en overview, columna F en Excel, migración automática de gastos viejos mal etiquetados como USD (ver Currency architecture)

---

## File structure

```
expense-tracker/
├── index.html          ← entire app (HTML + CSS + JS in one file)
└── .cursor/
    ├── hooks.json      ← Cursor hook definitions
    └── hooks/
        └── update-plan.sh  ← fires after git commit/push to remind agent to update PROJECT.md
```

---

## Cursor tooling (hooks & skills)

### Current hook: `update-plan`

- **Trigger:** `afterShellExecution` matching `git (commit|push)`
- **Behavior:** Injects an `agent_message` reminding the active agent to review and update `PROJECT.md`
- **Works with:** Any model running inside Cursor (Claude, Codex, Cursor default)

### Pending: make hooks & skills model-agnostic

Goal: hooks and skills should work regardless of which AI model is active — Claude, Codex (GPT), or Cursor's own model.

Guidelines to follow when adding future hooks/skills:

- **No model-specific syntax.** Do not use Claude XML tags (`<parameter name="thinking">`, `<result>`) or OpenAI-specific prompt patterns in hook scripts or skill prompts.
- **Plain `agent_message` / `user_message` only.** These fields are model-neutral; all models receive them the same way.
- **Behavior described, not format prescribed.** Write hook prompts that describe *what to do*, not *how to format the response* — formatting varies by model.
- **No hardcoded model names in hook scripts.** Hook scripts should not branch on model identity; let Cursor route to whichever model is active.
- **Skill prompts: imperative, tool-agnostic language.** Avoid "as Claude..." or "use your XML output format"; prefer "review the file and update the relevant sections".

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

### V1 (current)
- ✅ Multi-profile (Personal + Pareja)
- ✅ PKCE auth with refresh tokens
- ✅ Couple sharing via OneDrive sharing links
- ✅ Cursor hook: auto-update PROJECT.md on commit/push
- Make hooks & skills model-agnostic (Claude / Codex / Cursor)
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

## Cursor / Claude Code prompt

Use this to continue development. Attach `index.html` to the session.

```
I'm building a personal expense tracker as a single HTML file deployed on GitHub Pages.

Repo: https://github.com/licarys/expense-tracker
Live: https://licarys.github.io/expense-tracker/

Stack: pure HTML/CSS/JS, Microsoft Graph API for OneDrive, no build tools, no framework.
Auth: Microsoft OAuth 2.0 — Authorization Code + PKCE flow (no implicit, no client secret)
  Client ID: 96029ed9-a4f6-4eed-97e8-a5f1e2e58adc
  Redirect URI: https://licarys.github.io/expense-tracker/
  Scopes: Files.ReadWrite offline_access
Storage: Excel files in OneDrive root via Microsoft Graph API
UI: mobile-first dark theme, DM Sans + DM Mono fonts

Profiles:
- Personal: single Microsoft account, saves to expenses.xlsx
- Pareja: 2 separate Microsoft accounts sharing a file
  - Owner: logs in normally, generates OneDrive sharing link via Graph createLink API
  - Partner: logs in with own account, enters sharing link, accesses file via /shares/{encoded} endpoint
- All localStorage keys are namespaced per profile (e.g. et_token_personal, et_token_couple)

The full current code is in the attached index.html.

Pending tasks:
1. Header row check — only write Date/Description/Amount/Category headers if the sheet is empty
2. Improve natural language parsing for edge cases like "spent 20 on lunch" or "paid $8.5 for uber"
3. Summary command — show a clean formatted monthly breakdown in the chat
4. 401 handling — detect expired token mid-session and trigger refresh or re-login

Rules:
- Single file only — keep everything in index.html
- No npm, no build step, no framework
- Must stay deployable as a static file on GitHub Pages
- Do not change the dark mobile-first UI
- Do not add any paid APIs
```
