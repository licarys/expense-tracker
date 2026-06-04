const APP_VERSION = 'v1.0.1';

const CLIENT_ID = '96029ed9-a4f6-4eed-97e8-a5f1e2e58adc';
const SCOPES = 'Files.ReadWrite offline_access';
const REDIRECT_URI = window.location.origin + window.location.pathname;

const PROFILES = {
  personal: { label: 'Personal', emoji: '👤', defaultFile: 'expenses.xlsx' },
  couple:   { label: 'Pareja',   emoji: '💑', defaultFile: 'expenses-pareja.xlsx' },
};

// currentProfile, sk() and MONTH_NAMES are declared in utils.js
let coupleRole = null;       // 'owner' | 'partner' (only for couple profile)
let sharedFileHandle = null; // { driveId, itemId } for partner's shared file
let accessToken = null;
let expenses = [];
let selectedMonth = new Date().getMonth();
let selectedYear  = new Date().getFullYear();

// MONTH_NAMES, EXCEL_EPOCH_OFFSET, date utilities, and getExpenseDate are in utils.js

function normalizeSelectedMonth() {
  if (!Number.isFinite(selectedYear) || selectedYear < 1972 || selectedYear > 2100 ||
      !Number.isFinite(selectedMonth) || selectedMonth < 0 || selectedMonth > 11) {
    const now = new Date();
    selectedMonth = now.getMonth();
    selectedYear = now.getFullYear();
  }
}

function jumpToLatestExpenseMonthIfNeeded() {
  const currentHasData = expenses.some(e => {
    const d = getExpenseDate(e);
    return d && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });
  if (currentHasData || expenses.length === 0) {
    normalizeSelectedMonth();
    return;
  }
  let latest = null;
  expenses.forEach(e => {
    const d = getExpenseDate(e);
    if (d && (!latest || d > latest)) latest = d;
  });
  if (latest) {
    selectedMonth = latest.getMonth();
    selectedYear = latest.getFullYear();
  }
  normalizeSelectedMonth();
}

// CURRENCIES, CURRENCY_SYMBOL_MAP, CURRENCY_CODE_RE, BASE_CURRENCY,
// CONVERTED_USD_COLUMN_HEADER, getExchangeRates, saveExchangeRates,
// convertToUSD, and getExpenseAmountUSD are in utils.js

function recalculateAllAmountUsd() {
  expenses.forEach(e => {
    if (e.amountUsd != null) return; // preserve rate frozen at entry time
    const cur = e.currency || BASE_CURRENCY;
    const usd = convertToUSD(e.amount, cur);
    e.amountUsd = usd != null ? usd : (cur === BASE_CURRENCY ? e.amount : null);
  });
}

async function syncAmountUsdColumnToExcel() {
  if (!accessToken) return;
  try {
    const wbBase = await getWorkbookBase();
    if (!wbBase) return;
    const rangeRes = await apiFetch(`${wbBase}/worksheets/Sheet1/usedRange`);
    if (!rangeRes || !rangeRes.ok) return;
    const rows = (await rangeRes.json()).values || [];
    const patchPromises = [];
    if (rows.length > 0 && rows[0][0] === 'Date' && rows[0][5] !== CONVERTED_USD_COLUMN_HEADER) {
      patchPromises.push(
        apiFetch(`${wbBase}/worksheets/Sheet1/range(address='F1:F1')`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[CONVERTED_USD_COLUMN_HEADER]] })
        })
      );
    }
    rows.forEach((row, idx) => {
      if (idx === 0) return;
      const amount = parseFloat(row[2]) || 0;
      const currency = (row[4] && typeof row[4] === 'string' && row[4].trim())
        ? row[4].trim().toUpperCase()
        : BASE_CURRENCY;
      const amountUsd = convertToUSD(amount, currency);
      if (amountUsd == null) return;
      const excelRow = idx + 1;
      patchPromises.push(
        apiFetch(`${wbBase}/worksheets/Sheet1/range(address='F${excelRow}:F${excelRow}')`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[amountUsd]] })
        })
      );
    });
    await Promise.all(patchPromises);
  } catch (err) {
    console.error('syncAmountUsdColumnToExcel error:', err);
  }
}

// formatAmount and getCurrencySymbol are in utils.js

function renderExchangeRateRows() {
  const section = document.getElementById('exchange-rates-section');
  const container = document.getElementById('exchange-rate-rows');
  if (!section || !container) return;

  const foreign = [...new Set(expenses.map(e => e.currency).filter(c => c && c !== BASE_CURRENCY))];
  if (foreign.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const rates = getExchangeRates();
  container.innerHTML = '';
  foreign.forEach(code => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    row.innerHTML = `
      <span style="font-size:13px;color:var(--muted);min-width:56px;font-family:var(--font-mono)">1 USD =</span>
      <input id="rate-input-${code}" type="number" min="0.0001" step="any"
        value="${rates[code] || ''}"
        placeholder="e.g. 36.5"
        style="flex:1;padding:10px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:10px;color:var(--text);font-family:var(--font-mono);font-size:14px;">
      <span style="font-size:13px;font-family:var(--font-mono);min-width:36px">${code}</span>`;
    container.appendChild(row);
  });
}

// One-time: fix expenses saved as USD when description still has foreign currency markers
async function migrateMislabeledExpensesOnLoad() {
  const flagKey = sk('et_currency_fix_v3');
  if (localStorage.getItem(flagKey)) return;

  const toPatch = [];
  expenses.forEach(e => {
    const current = (e.currency || BASE_CURRENCY).toUpperCase();
    if (current !== BASE_CURRENCY) return;
    const detected = detectCurrency(e.description || '');
    if (detected && detected !== BASE_CURRENCY) {
      e.currency = detected;
      e.amountUsd = convertToUSD(e.amount, detected);
      toPatch.push(e);
    }
  });

  if (toPatch.length > 0) {
    localStorage.setItem(sk('et_expenses_cache'), JSON.stringify(expenses));
    renderOverview();
    renderLog();
    renderExchangeRateRows();
  }

  if (accessToken) {
    try {
      const wbBase = await getWorkbookBase();
      const rangeRes = await apiFetch(`${wbBase}/worksheets/Sheet1/usedRange`);
      if (rangeRes && rangeRes.ok) {
        const rows = (await rangeRes.json()).values || [];
        const patchPromises = [];

        toPatch.forEach(exp => {
          const rowIdx = rows.findIndex((row, idx) => idx > 0 &&
            row[1] === exp.description &&
            parseFloat(row[2]) === exp.amount);
          if (rowIdx < 0) return;
          const excelRow = rowIdx + 1;
          patchPromises.push(
            apiFetch(`${wbBase}/worksheets/Sheet1/range(address='E${excelRow}:F${excelRow}')`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [[exp.currency, exp.amountUsd]] })
            })
          );
        });

        // Backfill or fix column F (e.g. 150 NIO wrongly stored as 150 USD)
        rows.forEach((row, idx) => {
          if (idx === 0) return;
          const currency = (row[4] && typeof row[4] === 'string' && row[4].trim())
            ? row[4].trim().toUpperCase()
            : BASE_CURRENCY;
          const amount = parseFloat(row[2]) || 0;
          const existingF = row[5] != null && row[5] !== '' ? parseFloat(row[5]) : null;
          const amountUsd = convertToUSD(amount, currency);
          if (amountUsd == null) return;
          const looksUnconverted = currency !== BASE_CURRENCY &&
            existingF != null && Math.abs(existingF - amount) < 0.01;
          const needsPatch = existingF == null || isNaN(existingF) || looksUnconverted;
          if (!needsPatch) return;
          const excelRow = idx + 1;
          const patchE = !row[4] || !String(row[4]).trim();
          const range = patchE ? `E${excelRow}:F${excelRow}` : `F${excelRow}:F${excelRow}`;
          const values = patchE ? [[currency, amountUsd]] : [[amountUsd]];
          patchPromises.push(
            apiFetch(`${wbBase}/worksheets/Sheet1/range(address='${range}')`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ values })
            })
          );
        });

        await Promise.all(patchPromises);
      }
    } catch (err) {
      console.error('Currency fix Excel error:', err);
    }
  }

  localStorage.setItem(flagKey, '1');
}

function prevMonth() {
  selectedMonth--;
  if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
  renderOverview();
  renderLog();
}

function nextMonth() {
  const now = new Date();
  if (selectedYear === now.getFullYear() && selectedMonth === now.getMonth()) return;
  selectedMonth++;
  if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
  renderOverview();
  renderLog();
}

async function syncFromOneDrive() {
  const btn = document.getElementById('sync-btn');
  if (!btn) return;
  btn.classList.add('spinning');
  btn.disabled = true;
  await loadExpensesFromSheet();
  btn.classList.remove('spinning');
  btn.disabled = false;
}

// sk() is in utils.js

function selectProfile(profile) {
  currentProfile = profile;
  sessionStorage.setItem('et_active_profile', profile);

  // Mark cards with active session indicator
  Object.keys(PROFILES).forEach(p => {
    const card = document.getElementById('profile-card-' + p);
    if (card) card.classList.toggle('has-session', !!localStorage.getItem(`et_token_${p}`));
  });

  document.getElementById('profile-screen').style.display = 'none';

  // Update profile badge and auth screen
  const info = PROFILES[profile];
  document.getElementById('profile-badge-label').textContent = info.label;
  document.getElementById('auth-logo').textContent = info.emoji;
  document.getElementById('auth-profile-sub').innerHTML =
    `Signing in for <strong>${info.label}</strong>.<br>Data saved to your OneDrive.`;

  if (profile === 'couple') {
    const savedRole = localStorage.getItem(sk('et_couple_role'));
    if (savedRole) {
      coupleRole = savedRole;
      if (savedRole === 'partner') {
        const savedHandle = localStorage.getItem(sk('et_shared_handle'));
        if (savedHandle) sharedFileHandle = JSON.parse(savedHandle);
      }
      handleAuth();
      return;
    }
    // No role saved → show couple setup
    document.getElementById('couple-setup-screen').style.display = 'flex';
    return;
  }

  coupleRole = null;
  handleAuth();
}

function switchProfile() {
  accessToken = null;
  coupleRole = null;
  sharedFileHandle = null;
  currentProfile = null;
  sessionStorage.removeItem('et_active_profile');
  expenses = [];

  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('couple-setup-screen').style.display = 'none';

  // Reset couple setup to step 1
  document.getElementById('couple-step-role').style.display = 'flex';

  // Refresh session indicators on cards
  Object.keys(PROFILES).forEach(p => {
    const card = document.getElementById('profile-card-' + p);
    if (card) card.classList.toggle('has-session', !!localStorage.getItem(`et_token_${p}`));
  });

  document.getElementById('profile-screen').style.display = 'flex';
}

function signOut() {
  if (!currentProfile) return;
  localStorage.removeItem(sk('et_token'));
  localStorage.removeItem(sk('et_refresh_token'));
  localStorage.removeItem(sk('et_token_expiry'));
  localStorage.removeItem(sk('et_couple_role'));
  localStorage.removeItem(sk('et_couple_share_url'));
  localStorage.removeItem(sk('et_shared_handle'));
  localStorage.removeItem(sk('et_partner_email'));
  localStorage.removeItem(sk('et_expenses_cache'));
  accessToken = null;
  coupleRole = null;
  sharedFileHandle = null;
  expenses = [];
  closeSettings();
  switchProfile();
}

// ── Couple setup ─────────────────────────────────────────────────────────────
function preSelectCoupleRole(role) {
  // Partner goes straight to auth — file is discovered automatically after sign-in
  const setupEl = document.getElementById('couple-setup-screen');
  const authEl  = document.getElementById('auth-screen');
  if (role === 'partner') {
    coupleRole = 'partner';
    localStorage.setItem(sk('et_couple_role'), 'partner');
    setupEl.style.display = 'none';
    authEl.style.display  = 'flex';
    return;
  }
  // owner
  coupleRole = 'owner';
  localStorage.setItem(sk('et_couple_role'), 'owner');
  setupEl.style.display = 'none';
  authEl.style.display  = 'flex';
}

function disconnectPartner() {
  localStorage.removeItem(sk('et_couple_role'));
  localStorage.removeItem(sk('et_couple_share_url'));
  localStorage.removeItem(sk('et_shared_handle'));
  localStorage.removeItem(sk('et_partner_email'));
  coupleRole = null;
  sharedFileHandle = null;
  closeSettings();
  switchProfile();
}

// ── Partner access: invite + discovery ───────────────────────────────────────

/**
 * Owner: invites the partner's Microsoft account email to the shared expense file.
 * Uses the Graph API invite endpoint (requireSignIn: true) so only the specific
 * partner account can access — no anonymous links.
 */
async function grantPartnerAccess() {
  const emailEl = document.getElementById('partner-email-input');
  const statusEl = document.getElementById('invite-status');
  const btn = document.getElementById('invite-partner-btn');
  const email = emailEl?.value?.trim();

  if (!email || !email.includes('@')) {
    statusEl.textContent = 'Ingresa un email válido.';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Invitando…';
  statusEl.textContent = '';

  try {
    const defaultFile = PROFILES.couple.defaultFile;
    const filename = document.getElementById('setting-filename').value || defaultFile;

    // Ensure file exists
    let fileRes = await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}`);
    if (!fileRes) { btn.disabled = false; btn.textContent = 'Invitar a mi pareja'; return; }
    if (!fileRes.ok) {
      const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}:/content`, {
        method: 'PUT',
        headers: { 'Content-Type': xlsxMime },
        body: base64ToBlob(EMPTY_XLSX_B64, xlsxMime)
      });
      fileRes = await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}`);
      if (!fileRes || !fileRes.ok) {
        statusEl.textContent = '⚠ No se pudo crear el archivo. Intenta de nuevo.';
        statusEl.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = 'Invitar a mi pareja';
        return;
      }
    }
    const itemId = (await fileRes.json()).id;

    const inviteRes = await apiFetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/invite`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requireSignIn: true,
          sendInvitation: true,
          roles: ['write'],
          message: 'Te invito a acceder a nuestro archivo de gastos compartidos en Expense Tracker.',
          recipients: [{ email }],
        }),
      }
    );

    if (!inviteRes) { btn.disabled = false; btn.textContent = 'Invitar a mi pareja'; return; }

    if (inviteRes.ok) {
      localStorage.setItem(sk('et_partner_email'), email);
      statusEl.innerHTML = `✓ Invitación enviada a <strong>${email}</strong>.<br><span style="font-size:11px;color:var(--muted)">Tu pareja recibirá un email. Pídele que abra la app y seleccione "Soy el/la partner".</span>`;
      statusEl.style.color = 'var(--accent)';
      btn.textContent = 'Reinvitar';
    } else {
      const err = await inviteRes.json().catch(() => ({}));
      statusEl.textContent = `⚠ ${err?.error?.message || 'Error al enviar invitación. Verifica el email e inténtalo de nuevo.'}`;
      statusEl.style.color = 'var(--danger)';
      btn.textContent = 'Invitar a mi pareja';
    }
  } catch(e) {
    statusEl.textContent = '⚠ Error inesperado. Verifica tu conexión.';
    statusEl.style.color = 'var(--danger)';
    btn.textContent = 'Invitar a mi pareja';
    console.error('grantPartnerAccess error:', e);
  }
  btn.disabled = false;
}

/**
 * Partner: discovers the shared expense file via GET /me/drive/sharedWithMe.
 * Stores the resolved { driveId, itemId } handle in memory and localStorage.
 * Returns true if found, false otherwise.
 */
async function discoverSharedFile() {
  if (!accessToken) return false;
  const defaultFile = PROFILES.couple.defaultFile;
  const filename = document.getElementById('setting-filename')?.value || defaultFile;

  setOverviewSyncStatus('Buscando archivo compartido…');
  try {
    const res = await apiFetch('https://graph.microsoft.com/v1.0/me/drive/sharedWithMe');
    if (!res) return false; // auth expired
    if (!res.ok) {
      setOverviewSyncStatus('⚠ No se pudo acceder a los archivos compartidos', true);
      return false;
    }
    const items = (await res.json()).value || [];
    const handle = findSharedExpenseFile(items, filename);
    if (handle) {
      sharedFileHandle = handle;
      localStorage.setItem(sk('et_shared_handle'), JSON.stringify(handle));
      setOverviewSyncStatus('');
      return true;
    }
    setOverviewSyncStatus(`⚠ "${filename}" no encontrado. Pide a tu pareja que te invite desde sus Settings.`, true);
    return false;
  } catch(e) {
    console.error('discoverSharedFile error:', e);
    setOverviewSyncStatus('⚠ Error al buscar el archivo compartido', true);
    return false;
  }
}

// Returns the Graph API workbook base URL for the current profile/role
async function getWorkbookBase() {
  if (coupleRole === 'partner') {
    // If no handle stored, auto-discover via sharedWithMe
    if (!sharedFileHandle) {
      await discoverSharedFile();
    }
    if (!sharedFileHandle) return null;
    return `https://graph.microsoft.com/v1.0/drives/${sharedFileHandle.driveId}/items/${sharedFileHandle.itemId}/workbook`;
  }
  const filename = document.getElementById('setting-filename').value ||
    (PROFILES[currentProfile] || PROFILES.personal).defaultFile;
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${filename}:/workbook`;
}

// CATEGORIES (initial declaration) and CAT_KEYWORDS are in utils.js

// ---------------------------------------------------------------------------
// Payer helpers (Pareja profile)
// ---------------------------------------------------------------------------

// Returns alias list for parsePaidBy based on the names stored in settings.
function getPayerAliases() {
  const s = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
  const myName = (s.myName || '').trim().toLowerCase();
  const partnerName = (s.partnerName || '').trim().toLowerCase();
  return [
    { key: 'yo',      names: ['yo'].concat(myName ? [myName] : []) },
    { key: 'partner', names: ['él', 'ella'].concat(partnerName ? [partnerName] : []) },
  ];
}

// Resolves a payer key ('yo' | 'partner') to the configured display name.
function getPayerLabel(key) {
  const s = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
  if (key === 'yo')      return (s.myName      && s.myName.trim())      ? s.myName.trim()      : 'Yo';
  if (key === 'partner') return (s.partnerName  && s.partnerName.trim()) ? s.partnerName.trim() : 'Pareja';
  return key || '';
}

// Updates who paid for the most recently added expense (in-memory + Excel).
async function selectPayer(expDesc, expDate, excelRow, payerLabel) {
  const idx = expenses.findIndex(e => e.date === expDate && e.description === expDesc);
  if (idx >= 0) {
    expenses[idx].paidBy = payerLabel;
    localStorage.setItem(sk('et_expenses_cache'), JSON.stringify(expenses));
    renderLog();
  }
  if (accessToken && excelRow) {
    try {
      const wbBase = await getWorkbookBase();
      if (wbBase) {
        await apiFetch(`${wbBase}/worksheets/Sheet1/range(address='G${excelRow}:G${excelRow}')`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[payerLabel]] })
        });
      }
    } catch(e) { /* silent — payer will be updated on next sync */ }
  }
  const picker = document.querySelector(`.payer-picker[data-row="${excelRow}"]`);
  if (picker) {
    picker.innerHTML = `<span style="font-size:12px;color:var(--accent);font-family:var(--font-mono)">✓ Pagó ${payerLabel}</span>`;
  }
}

function loadSettings() {
  // Reset to defaults so profiles don't bleed into each other
  CATEGORIES = [
    { key:'food',          name:'Food',          emoji:'🥗', budget:300, spent:0, isDefault:true },
    { key:'transport',     name:'Transport',      emoji:'🚗', budget:150, spent:0, isDefault:true },
    { key:'entertainment', name:'Entertainment',  emoji:'🎬', budget:100, spent:0, isDefault:true },
    { key:'health',        name:'Health',         emoji:'❤️',  budget:200, spent:0, isDefault:true },
    { key:'shopping',      name:'Shopping',       emoji:'🛍️', budget:250, spent:0, isDefault:true },
    { key:'other',         name:'Other',          emoji:'📦', budget:100, spent:0, isDefault:true },
  ];

  // Load global custom categories (shared across all sessions)
  const savedCustom = localStorage.getItem('et_custom_categories');
  if (savedCustom) {
    JSON.parse(savedCustom).forEach(c => {
      if (!CATEGORIES.find(x => x.key === c.key)) {
        CATEGORIES.push({ ...c, spent: 0 });
        CAT_KEYWORDS[c.key] = [c.name.toLowerCase()];
      }
    });
  }

  const defaultFile = (PROFILES[currentProfile] || PROFILES.personal).defaultFile;
  document.getElementById('setting-filename').value = defaultFile;
  const saved = localStorage.getItem(sk('et_settings'));
  if (saved) {
    const s = JSON.parse(saved);
    if (s.budgets) CATEGORIES.forEach(c => { if (s.budgets[c.key]) c.budget = s.budgets[c.key]; });
    if (s.filename) document.getElementById('setting-filename').value = s.filename;
    if (s.exchangeRates) saveExchangeRates(s.exchangeRates);
  }
  renderExchangeRateRows();
}

async function saveSettings() {
  const budgets = {};
  CATEGORIES.forEach(c => {
    const inp = document.getElementById('cat-budget-' + c.key);
    if (inp) { c.budget = parseFloat(inp.value) || c.budget; budgets[c.key] = c.budget; }
  });
  const defaultFile = (PROFILES[currentProfile] || PROFILES.personal).defaultFile;
  const filename = document.getElementById('setting-filename').value || defaultFile;

  // Save custom categories globally (shared across all sessions)
  const customCategories = CATEGORIES.filter(c => !c.isDefault).map(({ key, name, emoji, budget }) => ({ key, name, emoji, budget }));
  localStorage.setItem('et_custom_categories', JSON.stringify(customCategories));

  const rates = getExchangeRates();
  document.querySelectorAll('[id^="rate-input-"]').forEach(inp => {
    const code = inp.id.replace('rate-input-', '');
    const val = parseFloat(inp.value);
    if (val > 0) rates[code] = val;
    else delete rates[code];
  });
  saveExchangeRates(rates);
  recalculateAllAmountUsd();
  localStorage.setItem(sk('et_expenses_cache'), JSON.stringify(expenses));

  const existing = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
  const newSettings = { ...existing, budgets, filename, exchangeRates: rates };
  if (currentProfile === 'couple') {
    const myNameEl      = document.getElementById('setting-my-name');
    const partnerNameEl = document.getElementById('setting-partner-name');
    if (myNameEl)      newSettings.myName      = myNameEl.value.trim();
    if (partnerNameEl) newSettings.partnerName = partnerNameEl.value.trim();
  }
  localStorage.setItem(sk('et_settings'), JSON.stringify(newSettings));

  await syncAmountUsdColumnToExcel();
  await saveCategoriesToSheet();

  renderOverview();
  document.getElementById('sync-status').textContent = '✓ Settings saved';
  document.getElementById('sync-status').className = 'sync-status ok';
  setTimeout(() => { document.getElementById('sync-status').textContent = ''; }, 2000);
}

function renderCatSettings() {
  const catSettings = document.getElementById('cat-settings');
  catSettings.innerHTML = '';
  CATEGORIES.forEach(c => {
    const row = document.createElement('div');
    row.className = 'cat-setting-row';
    row.dataset.catKey = c.key;
    const delBtn = c.isDefault ? '' : `<button class="cat-delete-btn" onclick="removeCategory('${c.key}')" title="Delete">×</button>`;
    row.innerHTML = `<span class="cat-setting-emoji">${c.emoji}</span><span class="cat-setting-name">${c.name}</span><input class="cat-setting-input" id="cat-budget-${c.key}" type="number" value="${c.budget}" min="0">${delBtn}`;
    catSettings.appendChild(row);
  });
  // Re-apply active filter after re-render
  const searchEl = document.getElementById('cat-search');
  if (searchEl) applyCatFilter(searchEl.value);
}

function applyCatFilter(query) {
  const matching = new Set(filterCategories(CATEGORIES, query).map(c => c.key));
  document.querySelectorAll('#cat-settings .cat-setting-row').forEach(row => {
    row.style.display = matching.has(row.dataset.catKey) ? '' : 'none';
  });
  const clearBtn = document.getElementById('cat-search-clear');
  if (clearBtn) clearBtn.style.display = (query && query.trim()) ? '' : 'none';
}

function clearCatSearch() {
  const el = document.getElementById('cat-search');
  if (el) { el.value = ''; el.focus(); }
  applyCatFilter('');
}

function applyOverviewFilter(query) {
  const matching = new Set(filterCategories(CATEGORIES, query).map(c => c.key));
  document.querySelectorAll('#budget-list .budget-row').forEach(row => {
    row.style.display = matching.has(row.dataset.catKey) ? '' : 'none';
  });
  const clearBtn = document.getElementById('overview-cat-search-clear');
  if (clearBtn) clearBtn.style.display = (query && query.trim()) ? '' : 'none';
}

function clearOverviewCatSearch() {
  const el = document.getElementById('overview-cat-search');
  if (el) { el.value = ''; el.focus(); }
  applyOverviewFilter('');
}

function openSettings() {
  const searchEl = document.getElementById('cat-search');
  if (searchEl) searchEl.value = '';
  // Pre-fill stored partner email (owner view)
  const emailEl = document.getElementById('partner-email-input');
  if (emailEl) emailEl.value = localStorage.getItem(sk('et_partner_email')) || '';
  // Show / populate Pareja names section
  const parejaNamesEl = document.getElementById('pareja-names-section');
  if (parejaNamesEl) {
    parejaNamesEl.style.display = currentProfile === 'couple' ? 'block' : 'none';
    if (currentProfile === 'couple') {
      const s = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
      document.getElementById('setting-my-name').value      = s.myName      || '';
      document.getElementById('setting-partner-name').value = s.partnerName || '';
    }
  }
  renderCatSettings();
  renderExchangeRateRows();
  cancelAddCategory();
  const verEl = document.getElementById('app-version-label');
  if (verEl) verEl.textContent = APP_VERSION;
  document.getElementById('settings-modal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}

function showAddCategoryForm() {
  document.getElementById('add-cat-form').classList.add('open');
  document.getElementById('add-cat-btn').style.display = 'none';
  document.getElementById('new-cat-emoji').focus();
}

function cancelAddCategory() {
  document.getElementById('add-cat-form').classList.remove('open');
  document.getElementById('add-cat-btn').style.display = '';
  document.getElementById('new-cat-emoji').value = '';
  document.getElementById('new-cat-name').value = '';
  document.getElementById('new-cat-budget').value = '';
}

function confirmAddCategory() {
  const emoji  = document.getElementById('new-cat-emoji').value.trim() || '🏷️';
  const name   = document.getElementById('new-cat-name').value.trim();
  const budget = parseFloat(document.getElementById('new-cat-budget').value) || 0;
  if (!name) { document.getElementById('new-cat-name').focus(); return; }
  const key = 'custom_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
  CATEGORIES.push({ key, name, emoji, budget, spent: 0, isDefault: false });
  CAT_KEYWORDS[key] = [name.toLowerCase()];
  saveSettings();
  renderCatSettings();
  cancelAddCategory();
}

function removeCategory(key) {
  CATEGORIES = CATEGORIES.filter(c => c.key !== key);
  delete CAT_KEYWORDS[key];
  // Update localStorage custom categories
  const lsCustom = CATEGORIES.filter(c => !c.isDefault).map(({ key: k, name, emoji, budget }) => ({ key: k, name, emoji, budget }));
  localStorage.setItem('et_custom_categories', JSON.stringify(lsCustom));
  // Persist to OneDrive sheet
  saveCategoriesToSheet();
  renderCatSettings();
}

// If a category name/key from the spreadsheet is unknown, auto-register it
// so the expense retains its original category instead of falling to "Other".
function resolveOrCreateCategory(name) {
  if (!name) return CATEGORIES[5];
  const lower = name.toLowerCase();
  // Match by name or key (case-insensitive)
  const existing = CATEGORIES.find(c =>
    c.name.toLowerCase() === lower || c.key.toLowerCase() === lower
  );
  if (existing) return existing;

  // Auto-create a new global category for the unknown name
  const key = 'custom_' + lower.replace(/\s+/g, '_');
  const newCat = { key, name: name.charAt(0).toUpperCase() + name.slice(1), emoji: '🏷️', budget: 0, spent: 0, isDefault: false };
  CATEGORIES.push(newCat);
  CAT_KEYWORDS[key] = [lower];

  // Persist globally so it survives page reloads and other sessions
  const existing_custom = JSON.parse(localStorage.getItem('et_custom_categories') || '[]');
  if (!existing_custom.find(c => c.key === key)) {
    existing_custom.push({ key: newCat.key, name: newCat.name, emoji: newCat.emoji, budget: newCat.budget });
    localStorage.setItem('et_custom_categories', JSON.stringify(existing_custom));
  }

  return newCat;
}

// ── PKCE helpers ────────────────────────────────────────────────────────────
function _b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _generateVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return _b64url(arr.buffer);
}
async function _generateChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return _b64url(digest);
}
// ────────────────────────────────────────────────────────────────────────────

async function signIn() {
  const verifier = _generateVerifier();
  const challenge = await _generateChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);
  const url = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.href = url.toString();
}

async function _exchangeCode(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  return res.json();
}

async function _refreshAccessToken() {
  const refreshToken = localStorage.getItem(sk('et_refresh_token'));
  if (!refreshToken) return false;
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    accessToken = data.access_token;
    localStorage.setItem(sk('et_token'), accessToken);
    if (data.refresh_token) localStorage.setItem(sk('et_refresh_token'), data.refresh_token);
    const expiry = Date.now() + (data.expires_in || 3600) * 1000;
    localStorage.setItem(sk('et_token_expiry'), expiry);
    return true;
  }
  return false;
}

// ── 401 / session expiry handling ────────────────────────────────────────────

/**
 * Called when a Graph API request returns 401 even after a refresh attempt.
 * Clears all stored tokens and shows the auth screen with a session-expired message.
 * Guards against being called multiple times concurrently (checks accessToken).
 */
function handleAuthExpired() {
  if (!accessToken) return; // already handled by a concurrent call
  accessToken = null;
  localStorage.removeItem(sk('et_token'));
  localStorage.removeItem(sk('et_token_expiry'));
  localStorage.removeItem(sk('et_refresh_token'));

  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  const sub = document.getElementById('auth-profile-sub');
  if (sub) sub.innerHTML = 'Your session expired.<br>Please sign in again to continue.';
}

/**
 * Drop-in replacement for fetch() for all Microsoft Graph API calls.
 * Automatically injects the current Bearer token; on 401 attempts one silent
 * refresh before falling back to handleAuthExpired().
 *
 * @param {string} url
 * @param {RequestInit} [options] - any fetch options EXCEPT Authorization header
 * @returns {Promise<Response|null>} null when auth expired and recovery failed
 */
async function apiFetch(url, options = {}) {
  const buildOpts = () => ({
    ...options,
    headers: { ...options.headers, 'Authorization': 'Bearer ' + accessToken },
  });

  let res = await fetch(url, buildOpts());

  if (res.status === 401) {
    const refreshed = await _refreshAccessToken();
    if (refreshed) {
      res = await fetch(url, buildOpts()); // buildOpts() re-reads the updated accessToken
    }
    if (!refreshed || res.status === 401) {
      handleAuthExpired();
      return null;
    }
  }

  return res;
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    window.history.replaceState({}, '', window.location.pathname);
    const data = await _exchangeCode(code);
    if (data.access_token) {
      accessToken = data.access_token;
      localStorage.setItem(sk('et_token'), accessToken);
      if (data.refresh_token) localStorage.setItem(sk('et_refresh_token'), data.refresh_token);
      const expiry = Date.now() + (data.expires_in || 3600) * 1000;
      localStorage.setItem(sk('et_token_expiry'), expiry);
      showApp();
    } else {
      console.error('Token exchange failed:', data);
      document.getElementById('auth-screen').style.display = 'flex';
    }
    return;
  }
  const stored = localStorage.getItem(sk('et_token'));
  const expiry = parseInt(localStorage.getItem(sk('et_token_expiry')) || '0');
  if (stored) {
    if (isTokenExpired(expiry)) {
      const refreshed = await _refreshAccessToken();
      if (refreshed) { showApp(); return; }
      localStorage.removeItem(sk('et_token'));
      localStorage.removeItem(sk('et_refresh_token'));
      localStorage.removeItem(sk('et_token_expiry'));
    } else {
      accessToken = stored;
      showApp();
      return;
    }
  }
  document.getElementById('auth-screen').style.display = 'flex';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  loadSettings();
  updateGreeting();
  renderOverview();

  // Show/hide couple-specific settings sections
  const coupleShareSection = document.getElementById('couple-share-section');
  const ownerSection = document.getElementById('couple-owner-section');
  const partnerSection = document.getElementById('couple-partner-section');
  if (currentProfile === 'couple') {
    coupleShareSection.style.display = 'block';
    ownerSection.style.display = coupleRole === 'owner' ? 'block' : 'none';
    partnerSection.style.display = coupleRole === 'partner' ? 'block' : 'none';
  } else {
    coupleShareSection.style.display = 'none';
  }

  // Hide filename setting for partner (they use shared file)
  const filenameSetting = document.getElementById('setting-filename')?.closest('.setting-row');
  if (filenameSetting) filenameSetting.style.display = coupleRole === 'partner' ? 'none' : '';

  // Show cached expenses instantly while OneDrive loads in background
  const cached = localStorage.getItem(sk('et_expenses_cache'));
  if (cached) {
    try {
      expenses = JSON.parse(cached);
      jumpToLatestExpenseMonthIfNeeded();
      renderOverview();
      renderLog();
      if (!accessToken) void migrateMislabeledExpensesOnLoad();
    } catch(e) { /* ignore corrupt cache */ }
  }

  loadExpensesFromSheet();
  addBotMessage("Hey! Ready to track your expenses 💸\n\nJust type something like:\n• Lunch with Ana $18 food\n• Netflix $15 entertainment\n• Uber to office $8 transport\n• Cena €20 food\n• Gasolina MXN 500 transport\n\nMultiple currencies supported — just include the symbol (€, £, ¥, R$…) or code (EUR, MXN, GBP…).\n\nType summary (or resumen) to see your monthly breakdown.");
}

function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
  document.getElementById('greeting').textContent = g;
  const now = new Date();
  document.getElementById('header-month').textContent = now.toLocaleDateString('en-US', { month:'long', year:'numeric' });
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const tabs = ['overview','chat','log'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab + '-panel').classList.add('active');
}

// detectCurrency and parseExpense are in utils.js

function renderOverview() {
  const monthExpenses = expenses.filter(e => {
    const d = getExpenseDate(e);
    return d && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });
  CATEGORIES.forEach(c => {
    c.spent = monthExpenses
      .filter(e => e.category === c.key)
      .reduce((s, e) => s + getExpenseAmountUSD(e), 0);
  });
  const total = CATEGORIES.reduce((s, c) => s + c.spent, 0);
  const totalBudget = CATEGORIES.reduce((s, c) => s + c.budget, 0);

  const navLabel = document.getElementById('hero-month-nav');
  if (navLabel) navLabel.textContent = `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;
  const nextBtn = document.getElementById('next-month-btn');
  if (nextBtn) {
    const now = new Date();
    nextBtn.disabled = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
  }

  // Update hero amount: split into currency symbol + number for styled display
  const heroParts = new Intl.NumberFormat('en-US', { style: 'currency', currency: BASE_CURRENCY }).formatToParts(total);
  const heroSym = heroParts.find(p => p.type === 'currency')?.value || '$';
  const heroNum = heroParts.filter(p => ['integer','group','decimal','fraction'].includes(p.type)).map(p => p.value).join('');
  const heroCurEl = document.getElementById('hero-currency');
  if (heroCurEl) heroCurEl.textContent = heroSym;
  document.getElementById('hero-total').textContent = heroNum;

  // Show "mixed currencies" hint if the month has expenses in multiple currencies
  const uniqueCurrencies = [...new Set(monthExpenses.map(e => e.currency || BASE_CURRENCY))];
  const isMixed = uniqueCurrencies.length > 1;
  const remaining = totalBudget - total;
  document.getElementById('hero-sub').textContent =
    `${formatAmount(remaining, BASE_CURRENCY)} remaining of ${formatAmount(totalBudget, BASE_CURRENCY)} budget` +
    (isMixed ? ' · mixed currencies' : '');

  const list = document.getElementById('budget-list');
  list.innerHTML = '';
  CATEGORIES.forEach(c => {
    const pct = Math.min((c.spent / c.budget) * 100, 100);
    const catRemaining = c.budget - c.spent;
    const over = catRemaining < 0;
    const warn = pct >= 80 && !over;
    const fillClass = over ? 'over' : warn ? 'warn' : '';
    const div = document.createElement('div');
    div.className = 'budget-row';
    div.dataset.catKey = c.key;
    div.innerHTML = `
      <div class="budget-row-top">
        <span class="budget-row-name"><span class="emoji">${c.emoji}</span>${c.name}</span>
        <span class="budget-row-amounts"><span class="spent">${formatAmount(c.spent, BASE_CURRENCY)}</span> / ${formatAmount(c.budget, BASE_CURRENCY)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${fillClass}" style="width:${pct}%"></div></div>
      <div class="budget-row-footer">
        <span class="budget-remaining ${over ? 'over' : ''}">${over ? '⚠ ' + formatAmount(Math.abs(catRemaining), BASE_CURRENCY) + ' over budget' : formatAmount(catRemaining, BASE_CURRENCY) + ' left'}</span>
        <span style="font-size:11px;font-family:var(--font-mono);color:var(--muted)">${Math.round(pct)}%</span>
      </div>
    `;
    list.appendChild(div);
  });

  const ovSearchEl = document.getElementById('overview-cat-search');
  if (ovSearchEl) applyOverviewFilter(ovSearchEl.value);
}

function renderLog() {
  const list = document.getElementById('log-list');
  const monthExpenses = expenses.filter(e => {
    const d = getExpenseDate(e);
    return d && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });
  if (monthExpenses.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>No expenses for ${MONTH_NAMES[selectedMonth]} ${selectedYear}.</div>`;
    return;
  }
  const sorted = [...monthExpenses].sort((a, b) => {
    const da = getExpenseDate(a)?.getTime() || 0;
    const db = getExpenseDate(b)?.getTime() || 0;
    return db - da;
  });
  list.innerHTML = '';
  sorted.forEach(e => {
    const cat = CATEGORIES.find(c => c.key === e.category) || CATEGORIES[5];
    const d = getExpenseDate(e) || new Date();
    const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' · ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const div = document.createElement('div');
    div.className = 'log-item';
    const expCur = e.currency || BASE_CURRENCY;
    const isForeign = expCur !== BASE_CURRENCY;
    const convertedAmt = isForeign && convertToUSD(e.amount, expCur) != null ? getExpenseAmountUSD(e) : null;
    const payerTag = (currentProfile === 'couple' && e.paidBy)
      ? `<span class="payer-tag">${e.paidBy}</span>`
      : '';
    div.innerHTML = `
      <div class="log-emoji">${cat.emoji}</div>
      <div class="log-info">
        <div class="log-desc">${e.description}${payerTag}</div>
        <div class="log-meta">${cat.name} · ${dateStr}</div>
      </div>
      <div class="log-amount-col">
        <div class="log-amount">${formatAmount(e.amount, expCur)}</div>
        ${isForeign && convertedAmt !== null ? `<div class="log-converted">≈ ${formatAmount(convertedAmt, BASE_CURRENCY)}</div>` : ''}
      </div>
    `;
    list.appendChild(div);
  });
}

function formatSummaryMessage(summary) {
  const totalPct = summary.totalBudget > 0
    ? Math.round((summary.total / summary.totalBudget) * 100)
    : 0;

  const expWord = summary.expenseCount === 1 ? 'expense' : 'expenses';
  const lines = [];

  lines.push(`📅 ${summary.monthLabel} — ${summary.expenseCount} ${expWord}`);
  lines.push('');
  lines.push(`💰 Spent:  ${formatAmount(summary.total, BASE_CURRENCY)}  (${totalPct}% of budget)`);

  const remLabel = summary.remaining < 0
    ? `⚠️ Over budget by ${formatAmount(Math.abs(summary.remaining), BASE_CURRENCY)}`
    : `✅ ${formatAmount(summary.remaining, BASE_CURRENCY)} remaining`;
  lines.push(remLabel);

  lines.push('');

  summary.categories.forEach(c => {
    const catPct = c.budget > 0 ? Math.round((c.spent / c.budget) * 100) : 0;
    const over = c.spent > c.budget;
    const flag = over ? ' ⚠️' : '';
    lines.push(`${c.emoji} ${c.name}: ${formatAmount(c.spent, BASE_CURRENCY)} / ${formatAmount(c.budget, BASE_CURRENCY)} (${catPct}%)${flag}`);
  });

  return lines.join('\n');
}

function addBotMessage(text, expenseData, alertMsg, saved) {
  const msgs = document.getElementById('messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'msg bot';
  const now = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  wrapper.innerHTML = `<div class="bubble">${text.replace(/\n/g,'<br>')}</div><span class="msg-time">${now}</span>`;
  if (expenseData) {
    const cat = CATEGORIES.find(c => c.key === expenseData.category) || CATEGORIES[5];
    const remaining = cat.budget - cat.spent;
    const pill = document.createElement('div');
    pill.className = 'expense-pill';
    const expCurrency = expenseData.currency || BASE_CURRENCY;
    const payerRow = expenseData.paidBy
      ? `<span class="pill-label">pagó</span><span class="pill-val" style="color:var(--accent)">${expenseData.paidBy}</span>`
      : '';
    pill.innerHTML = `
      <span class="pill-label">desc</span><span class="pill-val">${expenseData.description}</span>
      <span class="pill-label">amount</span><span class="pill-val green">${formatAmount(expenseData.amount, expCurrency)}</span>
      <span class="pill-label">category</span><span class="pill-val">${cat.emoji} ${cat.name}</span>
      <span class="pill-label">remaining</span><span class="pill-val ${remaining < 0 ? 'red' : ''}">${formatAmount(Math.abs(remaining), BASE_CURRENCY)}${remaining < 0 ? ' over' : ' left'}</span>
      ${payerRow}
    `;
    wrapper.appendChild(pill);

    // ¿Quién pagó? picker — shown in Pareja mode when payer was not auto-detected
    if (currentProfile === 'couple' && !expenseData.paidBy) {
      const picker = document.createElement('div');
      picker.className = 'payer-picker';
      picker.setAttribute('data-row', expenseData._excelRow || '');
      const myLabel      = getPayerLabel('yo');
      const partnerLabel = getPayerLabel('partner');
      const excelRow     = expenseData._excelRow;
      const desc         = expenseData.description;
      const date         = expenseData.date;
      picker.innerHTML = `<span class="payer-picker-label">¿Quién pagó?</span>`;
      const btnMe = document.createElement('button');
      btnMe.className = 'payer-btn';
      btnMe.textContent = myLabel;
      btnMe.addEventListener('click', () => selectPayer(desc, date, excelRow, myLabel));
      const btnPartner = document.createElement('button');
      btnPartner.className = 'payer-btn';
      btnPartner.textContent = partnerLabel;
      btnPartner.addEventListener('click', () => selectPayer(desc, date, excelRow, partnerLabel));
      picker.appendChild(btnMe);
      picker.appendChild(btnPartner);
      wrapper.appendChild(picker);
    }
  }
  if (alertMsg) {
    const alert = document.createElement('div');
    alert.className = 'alert-pill';
    alert.innerHTML = `⚠️ ${alertMsg}`;
    wrapper.appendChild(alert);
  }
  if (saved === true) {
    const badge = document.createElement('div');
    badge.className = 'saved-badge';
    badge.innerHTML = `✓ Saved to OneDrive`;
    wrapper.appendChild(badge);
  } else if (saved === false) {
    const badge = document.createElement('div');
    badge.className = 'saved-badge';
    badge.style.cssText = 'background:var(--danger-dim);border-color:var(--danger);color:var(--danger)';
    badge.innerHTML = `⚠ Not saved to OneDrive — check console for details`;
    wrapper.appendChild(badge);
  }
  msgs.appendChild(wrapper);
  msgs.scrollTop = msgs.scrollHeight;
}

function addUserMessage(text) {
  const msgs = document.getElementById('messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'msg user';
  const now = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  wrapper.innerHTML = `<div class="bubble">${text}</div><span class="msg-time">${now}</span>`;
  msgs.appendChild(wrapper);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('messages');
  const el = document.createElement('div');
  el.className = 'msg bot'; el.id = 'typing';
  el.innerHTML = `<div class="bubble typing-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing'); if (el) el.remove();
}

async function handleSend() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; input.style.height = 'auto';
  addUserMessage(text);
  showTyping();
  await new Promise(r => setTimeout(r, 500 + Math.random() * 400));
  removeTyping();

  const lower = text.toLowerCase();
  if (lower === 'summary' || lower === 'resumen' || lower.includes('how much') || lower.includes('budget')) {
    const summary = buildMonthlySummary(expenses, CATEGORIES, selectedMonth, selectedYear);
    let msg = formatSummaryMessage(summary);
    if (currentProfile === 'couple') {
      const payerTotals = buildPayerSummary(expenses, selectedMonth, selectedYear);
      if (Object.keys(payerTotals).length > 0) {
        msg += '\n\n👥 Por persona:';
        Object.entries(payerTotals).forEach(([name, total]) => {
          msg += `\n  ${name}: ${formatAmount(total, BASE_CURRENCY)}`;
        });
      }
    }
    addBotMessage(msg);
    return;
  }
  if (lower === 'help') {
    addBotMessage('Examples:\n• Lunch $12 food\n• Netflix $15 entertainment\n• Uber $8 transport\n• Gym $40 health\n• Cena €20 food\n• Gasolina MXN 500 transport\n• Coffee £3.50 food\n\nMultiple currencies: use the symbol (€ £ ¥ R$…) or code (EUR MXN GBP…).\n\nType summary or resumen for a monthly breakdown.');
    return;
  }

  const parsed = parseExpense(text);
  if (!parsed) {
    addBotMessage("I didn't catch an amount. Try: \"Lunch $12 food\" — include a number and I'll handle the rest.");
    return;
  }

  // Auto-detect payer from text (only in Pareja profile)
  if (currentProfile === 'couple') {
    const payerKey = parsePaidBy(text, getPayerAliases());
    parsed.paidBy = payerKey ? getPayerLabel(payerKey) : null;
  }

  expenses.push(parsed);
  localStorage.setItem(sk('et_expenses_cache'), JSON.stringify(expenses));
  renderOverview();
  renderLog();

  const cat = CATEGORIES.find(c => c.key === parsed.category) || CATEGORIES[5];
  const over = cat.spent > cat.budget;
  const alertMsg = over ? `You're ${formatAmount(cat.spent - cat.budget, BASE_CURRENCY)} over your ${cat.name} budget.` : null;

  const savedResult = await saveExpenseToSheet(parsed);
  const saved = savedResult && savedResult.ok;
  if (savedResult && savedResult.row) parsed._excelRow = savedResult.row;
  addBotMessage('Got it!', parsed, alertMsg, saved);
}

async function openInOneDrive() {
  if (!accessToken) return;
  const btn = document.getElementById('open-excel-btn');
  const origText = btn.innerHTML;
  btn.innerHTML = '<span style="font-size:15px">⏳</span> Opening…';
  btn.disabled = true;
  try {
    let webUrl;
    if (coupleRole === 'partner' && sharedFileHandle) {
      const res = await apiFetch(
        `https://graph.microsoft.com/v1.0/drives/${sharedFileHandle.driveId}/items/${sharedFileHandle.itemId}`
      );
      if (res && res.ok) webUrl = (await res.json()).webUrl;
    } else {
      const defaultFile = (PROFILES[currentProfile] || PROFILES.personal).defaultFile;
      const filename = document.getElementById('setting-filename').value || defaultFile;
      const res = await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}`);
      if (res && res.ok) webUrl = (await res.json()).webUrl;
    }
    if (webUrl) {
      window.open(webUrl, '_blank');
    } else {
      btn.innerHTML = '<span style="font-size:15px">⚠️</span> File not found — log an expense first';
      setTimeout(() => { btn.innerHTML = origText; btn.disabled = false; }, 3000);
      return;
    }
  } catch (e) {
    console.error('openInOneDrive error:', e);
  }
  btn.innerHTML = origText;
  btn.disabled = false;
}

// Minimal valid empty xlsx workbook (base64). Used when creating the file for the first time.
const EMPTY_XLSX_B64 = 'UEsDBBQAAAAIAAdawVx2qvOvCQEAAKcCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2SzU7DMBCEX8XytYrdckAIJemBnyNwKA+wOJvEiv/kdUvy9jhp4YAKvfRk2Tsz32jlcjtaww4YSXtX8Y1Yc4ZO+Ua7ruLvu+fijjNK4Bow3mHFJyS+rcvdFJBY9jqqeJ9SuJeSVI8WSPiALk9aHy2kfI2dDKAG6FDerNe3UnmX0KUizRm8Lh+xhb1J7GnMz8ceEQ1x9nAUzqyKQwhGK0h5Lg+u+UUpTgSRnYuGeh1olQVcniXMk78BJ99rXkzUDbI3iOkFbFbJ0chPH4cP7wfxf8iZlr5ttcLGq73NFkEhIjTUIyZrxHIKC9qtLvMXMcnl2Fy5yE/+hR6UJoN07S0sod9kuXy0+gtQSwMEFAAAAAgAB1rBXJja64uuAAAAJwEAAAsAAABfcmVscy8ucmVsc43PwQ6CMAwG4FdZepeBB2MMg4sx4WrwAeZWBgHWZZsKb++OYjx4bPr3+9OyXuaJPdGHgayAIsuBoVWkB2sE3NrL7ggsRGm1nMiigBUD1FV5xUnGdBL6wQWWDBsE9DG6E+dB9TjLkJFDmzYd+VnGNHrDnVSjNMj3eX7g/tOArckaLcA3ugDWrg7/sanrBoVnUo8ZbfxR8ZVIsvQGo4Bl4i/y451ozBIKvCr55sHqDVBLAwQUAAAACAAHWsFcnWxDvbkAAAAbAQAADwAAAHhsL3dvcmtib29rLnhtbI1PS67CMAy8SuQ9pGWBnqq2bBASa+AAoXFpRGNXdvi82xN+e1Yz1mjGM/XqHkdzRdHA1EA5L8AgdewDnRo47DezPzCaHHk3MmED/6iwausby/nIfDbZTtrAkNJUWavdgNHpnCekrPQs0aV8ysnqJOi8DogpjnZRFEsbXSB4J1TySwb3fehwzd0lIqV3iODoUi6vQ5gU2vr1QT9oyMVcevfkZR7yxK3PO8FIFTKRrS/BtrX92ux3WfsAUEsDBBQAAAAIAAdawVyrISxuwgAAAKcBAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHOtkM0KAjEMhF+l5O5mdw8iYvUiglfRByjd7A/utqWJP/v2FkVR8ODBU5iEfDPMYnUdenWmyJ13GoosB0XO+qpzjYbDfjOZgWIxrjK9d6RhJIbVcrGj3kh64bYLrBLDsYZWJMwR2bY0GM58IJcutY+DkSRjg8HYo2kIyzyfYnxnwCdTbSsNcVsVoPZjoF/Yvq47S2tvTwM5+WKBFx+P3BJJgprYkGh4rRjvo8gSFfB7mPKfYVjGPnX5SvLQT3v8KHh5A1BLAwQUAAAACAAHWsFcnoyoToIAAACcAAAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbD2MSw7CMAwFrxJ5Tx1YIISSdIM4ARzAakxb0ThVHPG5PVEXLN+M5rn+kxbz4qJzFg/7zoJhGXKcZfRwv113JzBaSSItWdjDlxX64N65PHVirqb1oh6mWtczog4TJ9IuryzNPHJJVNssI+pamOIWpQUP1h4x0SwQ3MYuVAmDw/9z+AFQSwMEFAAAAAgAB1rBXAuLbS8oAQAAYQIAAA0AAAB4bC9zdHlsZXMueG1spZLBbsMgDIZfBXFfaSNtmqYkPVSqtHM7aVeaOAkSmAjcqtnTz4R0a0877OTfP/YHBsrt1VlxgRCNx0puVmspABvfGuwr+XHcP71KEUljq61HqOQEUW7rMtJk4TAAkGAAxkoOROObUrEZwOm48iMgr3Q+OE2chl7FMYBuY2pyVhXr9Yty2qCsy84jRdH4MxKfYTF4ky9x0ZadjVR1idpBznfamlMwyVS5cg6R+4y1P6BCZqMuR00EAfeciEUfp5GnQZ4pY+a6P6r7oKdN8XzXMAfe9+RDy3d4P0K26tJCR9wQTD+kSH5UaZHIOxat0b1HbRPy1rEIxjZg7SHd9Gf3wL52As9u7+i9rSS/WJr+JvlAi8yYnCT+PS2z/40V1+6RP6PV7++ovwFQSwECFAMUAAAACAAHWsFcdqrzrwkBAACnAgAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAAdawVyY2uuLrgAAACcBAAALAAAAAAAAAAAAAACAAToBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAAdawVydbEO9uQAAABsBAAAPAAAAAAAAAAAAAACAARECAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACAAHWsFcqyEsbsIAAACnAQAAGgAAAAAAAAAAAAAAgAH3AgAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACAAHWsFcnoyoToIAAACcAAAAGAAAAAAAAAAAAAAAgAHxAwAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsBAhQDFAAAAAgAB1rBXAuLbS8oAQAAYQIAAA0AAAAAAAAAAAAAAIABqQQAAHhsL3N0eWxlcy54bWxQSwUGAAAAAAYABgCAAQAA/AUAAAAA';

function base64ToBlob(b64, mime) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function saveExpenseToSheet(expense) {
  if (!accessToken) return false;
  try {
    // For owner/personal: ensure a valid xlsx file exists before writing
    if (coupleRole !== 'partner') {
      const defaultFile = (PROFILES[currentProfile] || PROFILES.personal).defaultFile;
      const filename = document.getElementById('setting-filename').value || defaultFile;
      const check = await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}`);
      if (!check) return false;
      if (!check.ok) {
        const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const createRes = await apiFetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${filename}:/content`, {
          method: 'PUT',
          headers: { 'Content-Type': xlsxMime },
          body: base64ToBlob(EMPTY_XLSX_B64, xlsxMime)
        });
        if (!createRes || !createRes.ok) { console.error('File create failed'); return false; }
      }
    }

    const wbBase = await getWorkbookBase();
    if (!wbBase) return false;

    const cat = CATEGORIES.find(c => c.key === expense.category) || CATEGORIES[5];
    const dateStr = formatExpenseDateStorage(parseExpenseDate(expense.date) || new Date());

    const rangeRes = await apiFetch(`${wbBase}/worksheets/Sheet1/usedRange`);
    if (!rangeRes) return false;
    let nextRow = 2;
    let existingFirstRow = [];
    let rowCount = 0;

    if (rangeRes.ok) {
      const rangeData = await rangeRes.json();
      rowCount = rangeData.rowCount || 0;
      existingFirstRow = (rangeData.values || [])[0] || [];
    }

    if (shouldWriteHeader(rowCount, existingFirstRow)) {
      // Sheet is empty — write all headers before the first expense row
      const hRes = await apiFetch(`${wbBase}/worksheets/Sheet1/range(address='A1:G1')`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [['Date', 'Description', 'Amount', 'Category', 'Currency', CONVERTED_USD_COLUMN_HEADER, 'Paid By']] })
      });
      if (!hRes || !hRes.ok) { console.error('Header write failed'); return false; }
      nextRow = 2;
    } else {
      // Sheet already has data — never overwrite row 1
      nextRow = rowCount + 1;
      // Silently patch any missing or outdated column headers for older files
      if (existingFirstRow[0] === 'Date') {
        if (existingFirstRow[4] !== 'Currency') {
          apiFetch(`${wbBase}/worksheets/Sheet1/range(address='E1:E1')`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Currency']] })
          }).catch(() => {});
        }
        if (existingFirstRow[5] !== CONVERTED_USD_COLUMN_HEADER) {
          apiFetch(`${wbBase}/worksheets/Sheet1/range(address='F1:F1')`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[CONVERTED_USD_COLUMN_HEADER]] })
          }).catch(() => {});
        }
        if (existingFirstRow[6] !== 'Paid By') {
          apiFetch(`${wbBase}/worksheets/Sheet1/range(address='G1:G1')`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Paid By']] })
          }).catch(() => {});
        }
      }
    }

    const expCurrency = expense.currency || BASE_CURRENCY;
    const convertedAmount = convertToUSD(expense.amount, expCurrency) ?? expense.amountUsd ?? expense.amount;
    const paidByLabel = expense.paidBy ? String(expense.paidBy) : '';
    const updateRes = await apiFetch(
      `${wbBase}/worksheets/Sheet1/range(address='A${nextRow}:G${nextRow}')`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[dateStr, expense.description, expense.amount, cat.name, expCurrency, convertedAmount, paidByLabel]] })
      }
    );
    if (!updateRes) return false;
    if (!updateRes.ok) console.error('Row write failed', await updateRes.text());
    return { ok: updateRes.ok, row: nextRow };
  } catch (e) {
    console.error('Sheet save error:', e);
    return false;
  }
}

function setOverviewSyncStatus(msg, isErr) {
  const el = document.getElementById('overview-sync-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
}

// ── Categories sheet (OneDrive) ──────────────────────────────────────────────

// Returns true if the Categories sheet existed and was loaded, false if it was missing.
// Source of truth for budget only — spent is always computed from Sheet1 expenses.
async function loadCategoriesFromSheet() {
  if (!accessToken) return false;
  try {
    const wbBase = await getWorkbookBase();
    if (!wbBase) return false;

    const res = await apiFetch(`${wbBase}/worksheets/Categories/usedRange`);
    if (!res || !res.ok) return false; // Sheet doesn't exist yet or auth expired

    const data = await res.json();
    const rows = (data.values || []).slice(1); // Skip header row

    rows.forEach(r => {
      const name   = (r[0] || '').toString().trim();
      const emoji  = (r[1] || '🏷️').toString().trim();
      const budget = parseFloat(r[2]) || 0;
      // Columns D (Spent) and E (Left) are informational only — never read back into app
      if (!name) return;

      const existing = CATEGORIES.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.budget = budget;
        existing.emoji  = emoji;
      } else {
        // New custom category found in sheet — register it
        const key = 'custom_' + name.toLowerCase().replace(/\s+/g, '_');
        CATEGORIES.push({ key, name, emoji, budget, spent: 0, isDefault: false });
        CAT_KEYWORDS[key] = [name.toLowerCase()];
        // Keep localStorage custom list in sync
        const lsCustom = JSON.parse(localStorage.getItem('et_custom_categories') || '[]');
        if (!lsCustom.find(c => c.key === key)) {
          lsCustom.push({ key, name, emoji, budget });
          localStorage.setItem('et_custom_categories', JSON.stringify(lsCustom));
        }
      }
    });

    // Cache budgets in localStorage so they survive cold starts before the next sync
    const budgets = {};
    CATEGORIES.forEach(c => { budgets[c.key] = c.budget; });
    const lsSettings = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
    localStorage.setItem(sk('et_settings'), JSON.stringify({ ...lsSettings, budgets }));

    return true;
  } catch(e) {
    console.error('loadCategoriesFromSheet error:', e);
    return false;
  }
}

async function saveCategoriesToSheet() {
  if (!accessToken) return;
  try {
    const wbBase = await getWorkbookBase();
    if (!wbBase) return;

    // Create the Categories sheet only if it doesn't exist yet — never delete it.
    const sheetCheck = await apiFetch(`${wbBase}/worksheets/Categories`);
    if (!sheetCheck) return;
    if (!sheetCheck.ok) {
      const createRes = await apiFetch(`${wbBase}/worksheets/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Categories' })
      });
      if (!createRes || !createRes.ok) {
        console.error('Could not create Categories sheet');
        return;
      }
    }

    // Write Name, Emoji, Budget as static values.
    // Spent and Remaining use Excel SUMIF formulas that read live from Sheet1 —
    // so any edits to Sheet1 (add/delete rows) are reflected instantly without re-sync.
    const formulas = [['Name', 'Emoji', 'Budget', 'Spent', 'Remaining']];
    CATEGORIES.forEach((c, i) => {
      const row = i + 2; // Row 1 is the header
      formulas.push([
        c.name,
        c.emoji,
        c.budget,
        `=SUMIF(Sheet1!D:D,A${row},Sheet1!F:F)`,
        `=C${row}-D${row}`
      ]);
    });

    // Pad with blank rows to erase stale data from previous writes
    const totalRows = Math.max(formulas.length + 10, 30);
    while (formulas.length < totalRows) formulas.push(['', '', '', '', '']);

    const range = `A1:E${totalRows}`;
    const patchRes = await apiFetch(`${wbBase}/worksheets/Categories/range(address='${range}')`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formulas })
    });
    if (patchRes && !patchRes.ok) {
      console.error('Categories sheet write failed:', await patchRes.text());
    }
  } catch(e) {
    console.error('saveCategoriesToSheet error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function loadExpensesFromSheet() {
  if (!accessToken) return;
  setOverviewSyncStatus('Syncing from OneDrive…');
  try {
    const wbBase = await getWorkbookBase();
    if (!wbBase) { setOverviewSyncStatus('⚠ Could not reach OneDrive', true); return; }

    // Load budgets from Categories sheet (source of truth). Spent is computed below from Sheet1.
    await loadCategoriesFromSheet();
    renderCatSettings();

    const res = await apiFetch(`${wbBase}/worksheets/Sheet1/usedRange`);
    if (!res) return; // auth expired — handleAuthExpired() already called
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const code = errData?.error?.code || '';
      if (res.status === 404 || code === 'ItemNotFound') {
        setOverviewSyncStatus('No data in OneDrive yet — log your first expense!');
      } else {
        setOverviewSyncStatus(`⚠ OneDrive error ${res.status}: ${errData?.error?.message || res.statusText}`, true);
      }
      return;
    }
    const data = await res.json();
    const rows = data.values || [];
    expenses = rows.slice(1).filter(r => r[0] && r[2]).map(r => {
      const d = parseExpenseDate(r[0]);
      if (!d) return null;
      const catObj = resolveOrCreateCategory(r[3] || '');
      const currency = (r[4] && typeof r[4] === 'string' && r[4].trim().length > 0)
        ? r[4].trim().toUpperCase()
        : BASE_CURRENCY;
      const amount = parseFloat(r[2]) || 0;
      const paidBy = (r[6] && typeof r[6] === 'string' && r[6].trim()) ? r[6].trim() : null;
      const storedUsd = parseFloat(r[5]);
      const amountUsd = isNaN(storedUsd) ? null : storedUsd;
      return { date: formatExpenseDateStorage(d), description: r[1] || '', amount, category: catObj.key, currency, amountUsd, paidBy };
    }).filter(Boolean);

    recalculateAllAmountUsd();
    localStorage.setItem(sk('et_expenses_cache'), JSON.stringify(expenses));
    await migrateMislabeledExpensesOnLoad();
    recalculateAllAmountUsd();
    if (Object.keys(getExchangeRates()).length > 0) {
      await syncAmountUsdColumnToExcel();
    }

    jumpToLatestExpenseMonthIfNeeded();

    renderOverview();
    renderLog();
    renderExchangeRateRows();

    // Persist categories with updated Spent/Left to the sheet.
    // Awaited so the sync status updates only after the write completes.
    await saveCategoriesToSheet();
    setOverviewSyncStatus(`Synced · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`);
  } catch(e) {
    console.error('Load error:', e);
    setOverviewSyncStatus('⚠ Sync failed — check your connection', true);
  }
}

document.getElementById('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
document.getElementById('msg-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});

// On load: restore active profile from session, or show profile selector
(function init() {
  // Mark profile cards that already have a saved session
  Object.keys(PROFILES).forEach(p => {
    const card = document.getElementById('profile-card-' + p);
    if (card) card.classList.toggle('has-session', !!localStorage.getItem(`et_token_${p}`));
  });

  const savedProfile = sessionStorage.getItem('et_active_profile');
  if (savedProfile && PROFILES[savedProfile]) {
    selectProfile(savedProfile);
  }
  // Otherwise profile-screen stays visible (it's the default)
})();
