'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('all inline dashboard scripts parse and new release element IDs are unique', () => {
  const html = fs.readFileSync(path.join(__dirname, '../Index.html'), 'utf8');
  let count = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    new vm.Script(m[2], { filename: 'Index.html inline script ' + (++count) });
  }
  assert.equal(count, 17);
  const ids = [...html.matchAll(/\bid="((?:ur|sc)[A-Z][^"]*)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('urCustomerSearch'));
  assert.doesNotMatch(html, /\.createSale\(/);
});
