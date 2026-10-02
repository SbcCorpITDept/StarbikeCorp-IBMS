// tests/assemble.js - Rebuilds the page HtmlService serves: every
// `<?!= include('name'); ?>` line in frontend/Index.html is replaced by that
// partial's full content (partials contain no scriptlets).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INCLUDE_LINE = /^[ \t]*<\?!= include\('([^']+)'\); \?>\r?\n/gm;

function readPartial(root, name) {
  return fs.readFileSync(path.join(root, name + '.html'), 'utf8');
}

function includeNames(root = ROOT) {
  return [...readPartial(root, 'frontend/Index').matchAll(INCLUDE_LINE)].map(m => m[1]);
}

function assemblePage(root = ROOT) {
  return readPartial(root, 'frontend/Index').replace(INCLUDE_LINE, (line, name) => readPartial(root, name));
}

module.exports = { assemblePage, includeNames, ROOT };
