'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assemblePage, includeNames, ROOT } = require('./assemble');

// Partial names (no extension) under frontend/<dir>, recursively.
function partials(dir) {
  const base = path.join(ROOT, 'frontend', dir);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
  return walk(base).map(f => path.relative(ROOT, f).replace(/\\/g, '/').replace(/\.html$/, ''));
}

test('every include in frontend/Index.html resolves to a partial', () => {
  const names = includeNames();
  assert.ok(names.length > 0, 'frontend/Index.html has include lines');
  for (const name of names) assert.ok(fs.existsSync(path.join(ROOT, name + '.html')), name);
});

test('every css/pages/js partial is included exactly once', () => {
  const included = includeNames();
  assert.equal(new Set(included).size, included.length, 'no partial is included twice');
  const all = ['css', 'pages', 'js'].flatMap(partials);
  assert.deepEqual([...included].sort(), all.sort());
});

test('partials contain no scriptlets and the assembled page has none left', () => {
  for (const name of includeNames()) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8'), /<\?/, name);
  }
  assert.doesNotMatch(assemblePage(), /<\?/);
});

test('no new duplicate element ids in the page markup', () => {
  const markup = assemblePage().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  // Pre-existing: the CAS/CIR/Cash table headers share these two ids (out of scope).
  assert.deepEqual(dupes, ['pageHeaderSubtitle', 'pageHeaderTitle']);
});
