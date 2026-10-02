// tests/harness.js - Loads the Apps Script server files into a Node vm context
// with in-memory fakes for the Google services they call. Test-only; excluded
// from clasp push by .claspignore.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function displayOf(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v);
}

class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = (rows || []).map(r => r.slice()); }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows || 1, numCols || 1); }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() { return this; }
  _cell(r, c) {
    const row = this.rows[r - 1];
    const v = row ? row[c - 1] : undefined;
    return v === undefined ? '' : v;
  }
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c - 1) row.push('');
    row[c - 1] = v;
  }
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.numRows; i++) {
      const r = [];
      for (let j = 0; j < this.numCols; j++) r.push(this.sheet._cell(this.row + i, this.col + j));
      out.push(r);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map(r => r.map(displayOf)); }
  setValues(values) {
    values.forEach((r, i) => r.forEach((v, j) => this.sheet._set(this.row + i, this.col + j, v)));
    return this;
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
}

class FakeSpreadsheet {
  constructor(sheets) {
    this.sheets = {};
    Object.keys(sheets || {}).forEach(n => { this.sheets[n] = new FakeSheet(n, sheets[n]); });
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { this.sheets[name] = new FakeSheet(name, []); return this.sheets[name]; }
}

// Asia/Shanghai (UTC+8, no DST) — the time zone in appsscript.json.
function formatShanghai(d, fmt) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  const date = p(t.getUTCMonth() + 1) + '/' + p(t.getUTCDate()) + '/' + t.getUTCFullYear();
  if (fmt === 'MM/dd/yyyy') return date;
  return date + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
}

// Objects from the vm realm have a different Object.prototype; copy them so
// assert.deepStrictEqual compares plain data.
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// Every backend/**/*.js file, sorted by path (Apps Script shares one global scope).
function serverFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? serverFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  }).sort();
}

function loadApp(data) {
  data = data || {};
  let uuidSeq = 0;
  const cache = new Map();
  const lock = { waits: 0, releases: 0, held: false };
  const cacheExpiry = new Map();
  const cacheTTLs = new Map();
  let cacheTime = 0;
  const logs = [];
  const books = {};
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    Logger: { log: m => { logs.push(String(m)); } },
    LockService: {
      getScriptLock: () => ({
        waitLock() { if (lock.held) throw new Error('Nested script lock'); lock.waits++; lock.held = true; },
        tryLock() { if (lock.held) return false; lock.waits++; lock.held = true; return true; },
        releaseLock() { lock.releases++; lock.held = false; },
        hasLock: () => lock.held
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => {
          if (cacheExpiry.has(k) && cacheExpiry.get(k) <= cacheTime) cache.delete(k);
          return cache.has(k) ? cache.get(k) : null;
        },
        put: (k, v, ttl) => { cache.set(k, String(v)); cacheExpiry.set(k, cacheTime + ttl); cacheTTLs.set(k, ttl); },
        remove: k => { cache.delete(k); }
      })
    },
    Utilities: {
      getUuid: () => 'uuid-' + (++uuidSeq),
      formatDate: (d, tz, fmt) => formatShanghai(d, fmt)
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Shanghai',
      getActiveUser: () => ({ getEmail: () => '' })
    },
    SpreadsheetApp: {
      openById: id => {
        if (!books[id]) throw new Error('Unknown spreadsheet: ' + id);
        return books[id];
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => {
        const content = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
        return { getContent: () => content };
      },
      createTemplateFromFile: name => {
        const content = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
        return {
          evaluate: () => {
            const out = {
              setTitle: () => out, setXFrameOptionsMode: () => out, addMetaTag: () => out,
              getContent: () => content
            };
            return out;
          }
        };
      }
    },
  };
  vm.createContext(context);
  serverFiles(path.join(ROOT, 'backend')).forEach(f => {
    vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: path.relative(ROOT, f) });
  });

  const ids = vm.runInContext('({ main: spreadsheetId, users: userSheetId, mc: MC_INVENTORY_SPREADSHEET_ID })', context);
  books[ids.main] = new FakeSpreadsheet(data.main);
  books[ids.users] = new FakeSpreadsheet(data.users);
  books[ids.mc] = new FakeSpreadsheet(data.mc);
  const byKey = { main: books[ids.main], users: books[ids.users], mc: books[ids.mc] };

  return {
    fn: name => vm.runInContext(name, context),
    run: (name, ...args) => plain(vm.runInContext(name, context)(...args)),
    get: expr => plain(vm.runInContext(expr, context)),
    rows: (bookKey, sheetName) => {
      const s = byKey[bookKey].getSheetByName(sheetName);
      return s ? plain(s.rows) : null;
    },
    book: bookKey => byKey[bookKey],
    cache: cache,
    cacheTTLs: cacheTTLs,
    advanceTime: seconds => { cacheTime += seconds; },
    lock: lock,
    logs: logs
  };
}

module.exports = { loadApp, plain };
