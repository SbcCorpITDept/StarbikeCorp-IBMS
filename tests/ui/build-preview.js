// tests/ui/build-preview.js - Writes tests/ui/preview.html (the assembled frontend/ page with the
// google.script.run stub loaded first) for browser checks. Output is gitignored.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = require('../assemble').assemblePage(root);
const out = html.replace(/<head([^>]*)>/i, m => m + '\n<script src="mock-gas.js"></script>');
if (out === html) throw new Error('No <head> tag found in the assembled page');
const target = path.join(__dirname, 'preview.html');
fs.writeFileSync(target, out);
console.log('Wrote ' + target);
