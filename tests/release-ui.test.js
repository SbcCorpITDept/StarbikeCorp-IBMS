'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadUI } = require('./ui/harness');
const A = 'CTS-NAG - Naga', B = 'CTS-CAT - Cataingan';
function open(scope) {
  const ui = loadUI(scope);
  ui.window.openCreateSale(); ui.flush();
  return ui;
}
function choose(ui, mcid = 'MC-1') {
  ui.window.selectUrUnit(mcid); ui.window.urContinue(); ui.flush();
}
function review(ui) {
  ui.window.selectUrCustomer('CID-2');
  ui.el('urAccountNo').value = 'ACC-9';
  ui.el('urAtrNo').value = 'ATR-9';
  ui.el('urRciNo').value = 'RCI-9';
  ui.el('urSiNo').value = 'SI-9';
  ui.window.submitSale();
}

test('restricted user: engine filter, invalid unit, read-only fields and required documents', () => {
  const ui = open();
  assert.equal(ui.calls('getAvailableUnits')[0].args[0], A);
  assert.equal(ui.el('urBranchHead').classList.contains('hidden'), true);
  assert.doesNotMatch(ui.el('urUnitsBody').innerHTML, /ENG2001/);
  assert.match(ui.el('urUnitsBody').innerHTML, /Invalid type: Demo/);
  ui.window.selectUrUnit('MC-4');
  assert.equal(ui.el('urContinueBtn').disabled, true);
  ui.el('urEngineSearch').value = '1002'; ui.window.renderUrUnits();
  assert.match(ui.el('urUnitsBody').innerHTML, /ENG1002/);
  assert.doesNotMatch(ui.el('urUnitsBody').innerHTML, /ENG1001/);
  ui.el('urEngineSearch').value = ''; choose(ui);
  assert.equal(ui.el('urTxnId').readOnly, true);
  assert.equal(ui.el('urBranch').readOnly, true);
  assert.equal(ui.el('urBranch').value, A);
  assert.equal(ui.el('urEngine').textContent, 'ENG1001');
  assert.equal(ui.el('urRciWrap').classList.contains('hidden'), true);
  ui.window.submitSale(); assert.equal(ui.el('urError').textContent, 'Account No. is required.');
  ui.el('urAccountNo').value = 'ACC-9'; ui.window.selectUrCustomer('CID-2');
  ui.window.submitSale(); assert.equal(ui.el('urError').textContent, 'ATR No. is required.');
  ui.el('urAtrNo').value = 'ATR-9'; ui.window.submitSale();
  assert.equal(ui.el('urError').textContent, 'SI No. is required.');
});

test('customer search and change-unit preserve one form ID and same-branch customer', () => {
  const ui = open(); choose(ui);
  const id = ui.el('urTxnId').value;
  ui.el('urCustomerSearch').value = 'ana'; ui.window.urCustomerTyped();
  assert.match(ui.el('urCustomerList').innerHTML, /SANTOS, ANA/);
  assert.doesNotMatch(ui.el('urCustomerList').innerHTML, /DELA CRUZ/);
  ui.window.selectUrCustomer('CID-2');
  assert.equal(ui.el('urContact').value, '09170000002');
  assert.equal(ui.el('urAddress').value, 'PILI');
  ui.window.urCustomerTyped(); assert.equal(ui.el('urContact').value, '');
  ui.window.selectUrCustomer('CID-2'); ui.window.urBackToStep1();
  assert.match(ui.el('urUnitsBody').innerHTML, /type="radio" name="urUnit" checked/);
  choose(ui, 'MC-2');
  assert.equal(ui.el('urTxnId').value, id);
  assert.equal(ui.calls('beginUnitRelease').length, 1);
  assert.match(ui.el('urCustomerSearch').value, /SANTOS/);
  assert.equal(ui.el('urAtrWrap').classList.contains('hidden'), true);
  assert.equal(ui.el('urRciWrap').classList.contains('hidden'), false);
});

test('review countdown, server rejection, retry, payload, refresh, search and sold exclusions', () => {
  const ui = open(); choose(ui, 'MC-2'); review(ui);
  assert.equal(ui.el('scNo').textContent, 'SALE-SI-9');
  assert.equal(ui.el('scConfirmBtn').disabled, true);
  ui.window.confirmSaleFinal(); assert.equal(ui.calls('createUnitRelease').length, 0);
  ui.tick(5); assert.equal(ui.el('scConfirmBtn').disabled, false);
  ui.window.__nextRelease = { success: false, message: 'Duplicate SI' };
  ui.window.confirmSaleFinal(); ui.window.confirmSaleFinal(); ui.flush();
  assert.equal(ui.calls('createUnitRelease').length, 1);
  assert.equal(ui.alerts[0].message, 'Duplicate SI');
  assert.equal(ui.el('saleConfirmModal').classList.contains('hidden'), false);
  ui.window.confirmSaleFinal(); ui.flush();
  assert.equal(ui.el('saleConfirmModal').classList.contains('hidden'), true);
  assert.equal(ui.window.mcInventoryLoaded, false);
  assert.equal(ui.window.invDashLoaded, false);
  assert.match(ui.el('salesBody').innerHTML, /ACC-9/);
  const payload = ui.calls('createUnitRelease').at(-1).args[0];
  assert.deepEqual(Object.keys(payload).sort(), ['TransactionID','MCID','CID','Scope','SaleDate','AccountNo','ATRNo','SINo','RCINo','CreatedBy'].sort());
  assert.equal(payload.ATRNo, '');
  for (const search of ['SI-9', 'SALE-SI', 'santos', 'ACC-9', 'ENG1002']) {
    ui.el('salesSearch').value = search; ui.window.applySalesSearch();
    assert.match(ui.el('salesBody').innerHTML, /ENG1002/);
  }
  ui.el('salesSearch').value = 'zzz'; ui.window.applySalesSearch();
  assert.match(ui.el('salesBody').innerHTML, /No unit releases/);
  ui.window.openCreateSale(); ui.flush();
  assert.equal(ui.el('urTxnId').value, 'mock-uuid-2');
  assert.doesNotMatch(ui.el('urUnitsBody').innerHTML, /ENG1002/);
  choose(ui); ui.window.renderUrCustomers();
  assert.doesNotMatch(ui.el('urCustomerList').innerHTML, /SANTOS/);
});

test('ALL user customers follow the selected branch and clear on a branch change', () => {
  const ui = open('ALL');
  assert.equal(ui.el('urBranchHead').classList.contains('hidden'), false);
  choose(ui, 'MC-3');
  assert.equal(ui.el('urBranch').value, B);
  ui.window.renderUrCustomers(); assert.match(ui.el('urCustomerList').innerHTML, /REYES/);
  assert.doesNotMatch(ui.el('urCustomerList').innerHTML, /SANTOS/);
  ui.window.selectUrCustomer('CID-3'); ui.window.urBackToStep1(); choose(ui);
  assert.equal(ui.el('urCustomerSearch').value, '');
  assert.equal(ui.el('urContact').value, '');
  ui.window.renderUrCustomers(); assert.match(ui.el('urCustomerList').innerHTML, /SANTOS/);
});

test('late issuance from a previous form cannot replace the new form ID', () => {
  const ui = loadUI();
  ui.window.openCreateSale(); ui.window.openCreateSale();
  ui.flushOne(2); ui.flushOne(2);
  const current = ui.el('urTxnId').value;
  ui.flush();
  assert.equal(ui.el('urTxnId').value, current);
});

test('closing a review clears its pending payload so a stale confirm cannot submit', () => {
  const ui = open(); choose(ui); review(ui); ui.tick(5);
  ui.window.closeSaleReview(); ui.window.confirmSaleFinal();
  assert.equal(ui.calls('createUnitRelease').length, 0);
});

test('a saving review cannot be dismissed or replaced by a new form', () => {
  const ui = open(); choose(ui); review(ui); ui.tick(5); ui.window.confirmSaleFinal();
  const id = ui.el('urTxnId').value;
  ui.window.closeSaleReview(); ui.window.openCreateSale();
  assert.equal(ui.el('saleConfirmModal').classList.contains('hidden'), false);
  assert.equal(ui.el('urTxnId').value, id);
  assert.equal(ui.calls('beginUnitRelease').length, 1);
  ui.flush();
});

test('customer picker supports keyboard selection and Escape dismissal', () => {
  const ui = open(); choose(ui);
  ui.el('urCustomerSearch').value = 'ana';
  ui.window.urCustomerTyped();
  const event = key => ({ key, preventDefault() {} });
  ui.window.urCustomerKeydown(event('ArrowDown'));
  assert.equal(ui.el('urCustomerSearch').attributes['aria-activedescendant'], 'urCustomerOption0');
  ui.window.urCustomerKeydown(event('Enter'));
  assert.match(ui.el('urCustomerSearch').value, /SANTOS/);
  assert.equal(ui.el('urContact').value, '09170000002');
  assert.equal(ui.el('urCustomerSearch').attributes['aria-expanded'], 'false');
  ui.window.renderUrCustomers();
  ui.window.urCustomerKeydown(event('Escape'));
  assert.equal(ui.el('urCustomerList').classList.contains('hidden'), true);
});

test('customer-load and save transport failures are recoverable without discarding the form', () => {
  const ui = open();
  ui.window.__nextFailure = { method: 'getSaleCustomers', message: 'Network unavailable' };
  choose(ui);
  assert.match(ui.el('urCustomerStatus').textContent, /Failed to load/);
  ui.window.urBackToStep1(); choose(ui);
  ui.window.renderUrCustomers(); assert.match(ui.el('urCustomerList').innerHTML, /SANTOS/);
  review(ui); ui.tick(5);
  const id = ui.el('urTxnId').value;
  ui.window.__nextFailure = { method: 'createUnitRelease', message: 'Connection lost' };
  ui.window.confirmSaleFinal(); ui.flush();
  assert.match(ui.alerts.at(-1).message, /Connection lost/);
  assert.equal(ui.el('scConfirmBtn').disabled, false);
  assert.equal(ui.el('urTxnId').value, id);
  assert.equal(ui.el('urAccountNo').value, 'ACC-9');
  ui.window.confirmSaleFinal(); ui.flush();
  assert.match(ui.el('salesBody').innerHTML, /SALE-SI-9/);
  assert.equal(ui.window.__gasErrors.length, 0);
});

test('late customer responses from another branch cannot replace the current picker', () => {
  const ui = open('ALL');
  ui.window.selectUrUnit('MC-3'); ui.window.urContinue();
  ui.window.urBackToStep1(); ui.window.selectUrUnit('MC-1'); ui.window.urContinue();
  ui.flushOne(1); ui.flush();
  ui.window.renderUrCustomers();
  assert.match(ui.el('urCustomerList').innerHTML, /SANTOS/);
  assert.doesNotMatch(ui.el('urCustomerList').innerHTML, /REYES/);
  assert.equal(ui.calls('beginUnitRelease').length, 1);
});


test('customer picker ArrowUp starts at the last option and visibly highlights it', () => {
  const ui = open(); choose(ui);
  ui.window.renderUrCustomers();
  ui.window.urCustomerKeydown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(ui.el('urCustomerSearch').attributes['aria-activedescendant'], 'urCustomerOption1');
  const selected = ui.el('urCustomerList').innerHTML.match(/<button[^>]*aria-selected="true"[^>]*>/);
  assert.ok(selected);
  assert.match(selected[0], /bg-orange-50/);
  ui.window.urCustomerKeydown({ key: 'Enter', preventDefault() {} });
  assert.match(ui.el('urCustomerSearch').value, /SANTOS/);
});
