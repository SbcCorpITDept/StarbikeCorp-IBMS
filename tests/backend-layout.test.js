'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness');
const { makeData } = require('./fixtures');

const ROOT = path.join(__dirname, '..');

test('no server files are left at the project root', () => {
  assert.deepEqual(fs.readdirSync(ROOT).filter(f => f.endsWith('.js')), []);
});

test('doGet serves frontend/Index', () => {
  const app = loadApp(makeData());
  const out = app.fn('doGet')({});
  assert.match(out.getContent(), /<\?!= include\('frontend\/css\/Base'\); \?>/);
});

test('include returns a frontend partial', () => {
  const app = loadApp(makeData());
  assert.match(app.run('include', 'frontend/css/Base'), /<!-- GLOBAL STYLING -->/);
});

test('print templates resolve', () => {
  const app = loadApp(makeData());
  for (const fn of ['getCasApplicationForm', 'getCIRForm', 'getCashSalesForm']) {
    assert.equal(typeof app.fn(fn)({}), 'string', fn);
  }
});

test('all literal HtmlService file references resolve beneath frontend', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const references = [];
  for (const file of walk(path.join(ROOT, 'backend')).filter(f => f.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/HtmlService\.create(?:Template|HtmlOutput)FromFile\(['"]([^'"]+)['"]\)/g)) {
      references.push(match[1]);
      assert.ok(match[1].startsWith('frontend/'), file);
      assert.ok(fs.existsSync(path.join(ROOT, match[1] + '.html')), match[1]);
    }
  }
  assert.deepEqual(references.sort(), [
    'frontend/Index', 'frontend/print/CASForm', 'frontend/print/CIRForm',
    'frontend/print/CashSalesForm'
  ].sort());
});
