// utils.js — pure utility functions shared by the app and the test suite.
// No DOM access, no fetch calls, no app-state mutations in this file.

// ---------------------------------------------------------------------------
// Profile key namespacing
// ---------------------------------------------------------------------------
let currentProfile = null;

// Namespace all storage keys by profile
function sk(key) { return `${key}_${currentProfile}`; }

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Excel serial days from 1899-12-30 → Unix epoch (1970-01-01)
const EXCEL_EPOCH_OFFSET = 25569;

function isValidExpenseDate(d) {
  return d instanceof Date && !isNaN(d.getTime()) &&
    d.getFullYear() >= 1972 && d.getFullYear() <= 2100;
}

// Calendar date in local timezone (noon avoids DST edge cases)
function toLocalCalendarDate(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day, 12, 0, 0, 0);
  return isValidExpenseDate(d) ? d : null;
}

function formatExpenseDateStorage(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function excelSerialToDate(serial) {
  const utcMs = Math.round((serial - EXCEL_EPOCH_OFFSET) * 86400 * 1000);
  const utc = new Date(utcMs);
  return toLocalCalendarDate(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

// Handles YYYY-MM-DD, ISO datetimes, US date strings, and Excel serial numbers
function parseExpenseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return isValidExpenseDate(value)
      ? toLocalCalendarDate(value.getFullYear(), value.getMonth(), value.getDate())
      : null;
  }
  if (typeof value === 'number' && !isNaN(value)) {
    if (value > 10000) return excelSerialToDate(value);
    return null;
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = parseFloat(str);
    if (n > 10000) return excelSerialToDate(n);
  }
  const isoDate = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return toLocalCalendarDate(
      parseInt(isoDate[1], 10),
      parseInt(isoDate[2], 10) - 1,
      parseInt(isoDate[3], 10)
    );
  }
  const d = new Date(str);
  if (!isValidExpenseDate(d)) return null;
  return toLocalCalendarDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function getExpenseDate(expense) {
  return parseExpenseDate(expense.date);
}

// ---------------------------------------------------------------------------
// Currency constants
// ---------------------------------------------------------------------------
const CURRENCIES = [
  { code:'USD', name:'US Dollar'           },
  { code:'EUR', name:'Euro'                },
  { code:'GBP', name:'British Pound'       },
  { code:'MXN', name:'Mexican Peso'        },
  { code:'JPY', name:'Japanese Yen'        },
  { code:'CAD', name:'Canadian Dollar'     },
  { code:'AUD', name:'Australian Dollar'   },
  { code:'BRL', name:'Brazilian Real'      },
  { code:'ARS', name:'Argentine Peso'      },
  { code:'CLP', name:'Chilean Peso'        },
  { code:'COP', name:'Colombian Peso'      },
  { code:'PEN', name:'Peruvian Sol'        },
  { code:'CHF', name:'Swiss Franc'         },
  { code:'INR', name:'Indian Rupee'        },
  { code:'KRW', name:'South Korean Won'    },
  { code:'CNY', name:'Chinese Yuan'        },
  { code:'ZAR', name:'South African Rand'  },
  { code:'DKK', name:'Danish Krone'        },
  { code:'NOK', name:'Norwegian Krone'     },
  { code:'SEK', name:'Swedish Krona'       },
  { code:'PLN', name:'Polish Zloty'        },
  { code:'CZK', name:'Czech Koruna'        },
  { code:'HUF', name:'Hungarian Forint'    },
  { code:'TRY', name:'Turkish Lira'        },
  { code:'THB', name:'Thai Baht'           },
  { code:'NIO', name:'Nicaraguan Córdoba'  },
];

// Currency symbol detection order matters (multi-char first)
const CURRENCY_SYMBOL_MAP = [
  { sym: 'R$',  code: 'BRL' },
  { sym: 'MX$', code: 'MXN' },
  { sym: 'C$',  code: 'NIO' },
  { sym: 'A$',  code: 'AUD' },
  { sym: 'S/',  code: 'PEN' },
  { sym: '€',   code: 'EUR' },
  { sym: '£',   code: 'GBP' },
  { sym: '¥',   code: 'JPY' },
  { sym: '₩',   code: 'KRW' },
  { sym: '₹',   code: 'INR' },
  { sym: '₪',   code: 'ILS' },
  { sym: 'Fr',  code: 'CHF' },
];

const CURRENCY_CODE_RE = /\b(USD|EUR|GBP|JPY|MXN|CAD|AUD|BRL|CHF|KRW|INR|ILS|ARS|CLP|COP|PEN|CNY|ZAR|DKK|NOK|SEK|PLN|CZK|HUF|TRY|THB|NIO)\b/i;

const BASE_CURRENCY = 'USD';
const CONVERTED_USD_COLUMN_HEADER = 'Converted to USD';

// ---------------------------------------------------------------------------
// Exchange rates (localStorage-backed)
// ---------------------------------------------------------------------------
function getExchangeRates() {
  try {
    const settings = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
    if (settings.exchangeRates && Object.keys(settings.exchangeRates).length > 0) {
      return settings.exchangeRates;
    }
    return JSON.parse(localStorage.getItem('et_exchange_rates') || '{}');
  } catch(e) { return {}; }
}

function saveExchangeRates(rates) {
  localStorage.setItem('et_exchange_rates', JSON.stringify(rates));
  try {
    const settings = JSON.parse(localStorage.getItem(sk('et_settings')) || '{}');
    settings.exchangeRates = rates;
    localStorage.setItem(sk('et_settings'), JSON.stringify(settings));
  } catch(e) { /* ignore */ }
}

// Rates: { NIO: 36.5 } means 1 USD = 36.5 NIO → amountUsd = amount / rate
function convertToUSD(amount, fromCurrency) {
  if (!fromCurrency || fromCurrency === BASE_CURRENCY) return amount;
  const rates = getExchangeRates();
  const rate = rates[fromCurrency];
  if (!rate || rate <= 0) return null;
  return amount / rate;
}

function getExpenseAmountUSD(e) {
  const cur = e.currency || BASE_CURRENCY;
  const usd = convertToUSD(e.amount, cur);
  if (usd != null) return usd;
  return cur === BASE_CURRENCY ? e.amount : 0;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
function formatAmount(amount, currencyCode) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode || 'USD' }).format(amount);
  } catch(e) {
    return '$' + amount.toFixed(2);
  }
}

function getCurrencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD' }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value || code;
  } catch(e) { return code || '$'; }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
let CATEGORIES = [
  { key:'food',          name:'Food',          emoji:'🥗', budget:300, spent:0, isDefault:true },
  { key:'transport',     name:'Transport',      emoji:'🚗', budget:150, spent:0, isDefault:true },
  { key:'entertainment', name:'Entertainment',  emoji:'🎬', budget:100, spent:0, isDefault:true },
  { key:'health',        name:'Health',         emoji:'❤️',  budget:200, spent:0, isDefault:true },
  { key:'shopping',      name:'Shopping',       emoji:'🛍️', budget:250, spent:0, isDefault:true },
  { key:'other',         name:'Other',          emoji:'📦', budget:100, spent:0, isDefault:true },
];

const CAT_KEYWORDS = {
  food:['food','lunch','dinner','breakfast','coffee','restaurant','cafe','eat','groceries','snack','pizza','burger','taco','sushi'],
  transport:['transport','uber','taxi','bus','gas','fuel','metro','ride','lyft','parking','toll','car','train'],
  entertainment:['entertainment','netflix','spotify','movie','cinema','game','concert','show','hulu','disney','steam','ticket'],
  health:['health','pharmacy','doctor','gym','medicine','workout','clinic','dental','vitamin','hospital'],
  shopping:['shopping','clothes','amazon','store','shoes','mall','order','buy','purchase'],
};

// ---------------------------------------------------------------------------
// Natural language parser
// ---------------------------------------------------------------------------
function detectCurrency(text) {
  // Multi-char symbols first (order matters)
  for (const { sym, code } of CURRENCY_SYMBOL_MAP) {
    if (text.includes(sym)) return code;
  }
  // ISO currency codes (e.g. "150 EUR", "MXN 150")
  const m = text.match(CURRENCY_CODE_RE);
  if (m) return m[1].toUpperCase();
  return null;
}

function parseExpense(text) {
  const currency = detectCurrency(text) || BASE_CURRENCY;

  // Strip all known currency symbols/codes to isolate the number
  let cleaned = text;
  for (const { sym } of CURRENCY_SYMBOL_MAP) {
    cleaned = cleaned.split(sym).join(' ');
  }
  cleaned = cleaned.replace(CURRENCY_CODE_RE, ' ').replace(/\$/g, ' ');

  const amountMatch = cleaned.match(/[\d]+(?:[.,]\d{1,2})?/);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[0].replace(',', '.'));
  if (!amount || amount <= 0) return null;

  const lower = text.toLowerCase();
  let category = 'other';
  for (const [cat, keys] of Object.entries(CAT_KEYWORDS)) {
    if (keys.some(k => lower.includes(k))) { category = cat; break; }
  }

  // Build description by removing amount, currency markers, and category name
  let description = cleaned.replace(/[\d]+(?:[.,]\d{1,2})?/, '').trim();
  const catObj = CATEGORIES.find(c => c.key === category);
  if (catObj) description = description.replace(new RegExp(catObj.name, 'gi'), '').trim();
  description = description.replace(/,\s*$/, '').replace(/\s+/g, ' ').trim();
  if (description.length < 2) description = text.trim();

  const amountUsd = convertToUSD(amount, currency) ?? (currency === BASE_CURRENCY ? amount : null);
  return { description, amount, currency, amountUsd, category, date: formatExpenseDateStorage(new Date()) };
}

// ---------------------------------------------------------------------------
// Sheet header check
// ---------------------------------------------------------------------------

// Returns true only when the sheet is completely empty and headers must be written.
// Headers are never written over existing data — even if row 1 lacks a "Date" cell.
function shouldWriteHeader(rowCount, existingFirstRow) {
  return !rowCount || rowCount === 0;
}
