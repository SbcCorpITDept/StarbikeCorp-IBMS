// tests/fixtures.js - Sheet data builders for tests/harness.js.
'use strict';

const BRANCH_A = 'CTS-NAG - Naga';
const BRANCH_B = 'CTS-CAT - Cataingan';

const MASTER_HEADERS = ['MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode', 'Color',
  'CurrentBranch', 'CurrentStatus', 'OriginalRR', 'DateReceived', 'LastUpdated'];
const TX_HEADER = ['TransactionID', 'TransactionNo', 'TransactionType', 'SourceLocation',
  'DestinationLocation', 'TransactionDate', 'CreatedBy', 'Status', 'Remarks', 'LinkedTransactionNo'];
const TX_DETAILS = ['TransactionID', 'TransactionNo', 'MCID', 'EngineNo', 'ChassisNo', 'Model', 'ModelCode'];
const MOVEMENTS = ['MovementID', 'MCID', 'TransactionNo', 'TransactionType', 'FromLocation',
  'ToLocation', 'MovementDate', 'PerformedBy', 'Remarks'];
const SALES_HEADERS = ['TransactionID', 'AccountNo', 'CID', 'AID', 'CustomerName', 'ContactNo',
  'Address', 'UnitType', 'ATRNo', 'SINo', 'RCINo'];
const CIR_HEADERS = ['CID', 'ToWhom', 'Applicant', 'Type of Applicant:', 'Status / Condition:',
  'Store Branch:', 'ApplicantName', 'ACellNo.', 'Pres Address'];

function unitRow(u, withUnitType) {
  const row = [u.mcid, u.engineNo, u.chassisNo || 'CH-' + u.engineNo, u.model || 'XRM125',
    u.modelCode || 'XRM-01', u.color || 'RED', u.branch === undefined ? BRANCH_A : u.branch,
    u.status || 'Available', u.rr || 'RR-1', '09/01/2026', '09/01/2026 08:00:00'];
  if (withUnitType) row.push(u.unitType || '');
  return row;
}

function cirRow(c) {
  return [c.cid, c.aid === undefined ? 'AID-' + c.cid : c.aid, c.applicant || 'Maker',
    c.channel || 'Walk-in', c.status || 'Approved', c.branch === undefined ? BRANCH_A : c.branch,
    c.name || 'DELA CRUZ, JUAN', c.contact || '09170000000', c.address || 'NAGA CITY'];
}

function saleRow(s) {
  return [s.transactionId, s.accountNo || 'ACC-OLD', s.cid, s.aid || '', s.name || 'OLD CUSTOMER',
    '', '', s.unitType || 'Brand-New', s.atrNo || 'ATR-OLD', s.siNo, s.rciNo || ''];
}

function makeData(opts) {
  opts = opts || {};
  const withUnitType = opts.withUnitType !== false;
  const mc = {
    MC_MASTER: [withUnitType ? MASTER_HEADERS.concat(['UnitType']) : MASTER_HEADERS.slice()]
      .concat((opts.units || []).map(u => unitRow(u, withUnitType))),
    TRANSACTION_HEADER: [TX_HEADER.slice()].concat(opts.headers || []),
    TRANSACTION_DETAILS: [TX_DETAILS.slice()].concat(opts.details || []),
    MC_MOVEMENTS: [MOVEMENTS.slice()]
  };
  if (opts.withSalesSheet !== false) {
    mc.SALES = [SALES_HEADERS.slice()].concat((opts.sales || []).map(saleRow));
  }
  return {
    main: {
      CIR_Database: [CIR_HEADERS.slice()].concat((opts.customers || []).map(cirRow)),
      Applicant_Database: [['AID', 'ApplicantName', 'Store Branch:']],
      'Cash-Sales_Database': [['CSID']]
    },
    users: {},
    mc: mc
  };
}

module.exports = {
  BRANCH_A, BRANCH_B, MASTER_HEADERS, TX_HEADER, TX_DETAILS, MOVEMENTS, SALES_HEADERS, CIR_HEADERS,
  makeData
};
