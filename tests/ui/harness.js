// Executes the real sales script with a minimal DOM and the browser GAS fake.
// This verifies state/callback behavior; it does not replace rendered browser QA.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = require('../assemble').assemblePage();
function loadUI(scope = 'CTS-NAG - Naga') {
  const elements = new Map();
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const classes = new Set((m[2].match(/\bclass="([^"]*)"/) || [null, ''])[1].split(/\s+/));
    elements.set(m[3], {
      value: '', textContent: '', innerHTML: '', disabled: /\bdisabled\b/.test(m[2]),
      readOnly: /\breadonly\b/.test(m[2]), style: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: name => classes.has(name),
        toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      }
    });
  }
  const timers = [];
  const intervals = new Map();
  const alerts = [], toasts = [], pages = [];
  let timerId = 0;
  const context = {
    console, Date,
    document: {
      body: { style: {} }, activeElement: null,
      getElementById(id) { if (!elements.has(id)) throw new Error('Missing element: ' + id); return elements.get(id); }
    },
    setTimeout(fn) { timers.push(fn); return ++timerId; },
    clearTimeout() {},
    setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    _userBranch: scope, _userEmail: 'clerk@sbc.test',
    mcEscape: value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    mcSkelRows() {}, renderPagination() {}, paginateRows: rows => rows.slice(0, 10),
    mcAlert: (message, options) => alerts.push({ message, options }),
    mcToast: message => toasts.push(message),
    showPage: id => { pages.push(id); if (id === 'salesPage') context.loadSales(); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'mock-gas.js'), 'utf8'), context);
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m => m[1].includes('let salesData = [];'));
  if (!script) throw new Error('Sales script not found');
  vm.runInContext(script[1], context, { filename: 'frontend/js/Inventory.html sales script' });
  return {
    window: context, el: id => context.document.getElementById(id), alerts, toasts, pages,
    flushOne(index = 0) { const callback = timers.splice(index, 1)[0]; if (!callback) throw new Error('No callback'); callback(); },
    flush() { let remaining = 100; while (timers.length && remaining--) timers.shift()(); if (timers.length) throw new Error('Timer loop'); },
    tick(n = 1) { for (let i = 0; i < n; i++) [...intervals.values()].forEach(fn => fn()); },
    calls: name => context.__gasCalls.filter(call => call.name === name)
  };
}
module.exports = { loadUI };
