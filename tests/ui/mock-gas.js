// tests/ui/mock-gas.js - Browser stub of google.script.run so Index.html can be
// exercised outside Apps Script. UI verification only; never deployed.
(function () {
  const A = 'CTS-NAG - Naga';
  const B = 'CTS-CAT - Cataingan';
  const unit = (mcid, engineNo, branch, unitType, unitTypeRaw) => ({
    mcid: mcid, engineNo: engineNo, chassisNo: 'CH-' + engineNo, model: 'XRM125', modelCode: 'XRM-01',
    color: 'RED', currentBranch: branch, currentStatus: 'Available', unitType: unitType, unitTypeRaw: unitTypeRaw
  });
  const units = [
    unit('MC-1', 'ENG1001', A, 'Brand-New', ''),
    unit('MC-2', 'ENG1002', A, 'Repo', 'Repo'),
    unit('MC-3', 'ENG2001', B, 'Brand-New', 'Brand-New'),
    unit('MC-4', 'ENG1004', A, 'Invalid', 'Demo')
  ];
  const customers = {};
  customers[A] = [
    { cid: 'CID-1', aid: 'AID-1', name: 'DELA CRUZ, JUAN', contact: '09170000001', address: 'NAGA CITY' },
    { cid: 'CID-2', aid: 'AID-2', name: 'SANTOS, ANA', contact: '09170000002', address: 'PILI' }
  ];
  customers[B] = [
    { cid: 'CID-3', aid: 'AID-3', name: 'REYES, MARK', contact: '09170000003', address: 'CATAINGAN' }
  ];
  const sales = [];
  let seq = 0;

  window.__gasCalls = [];
  window.__gasErrors = [];
  window.__nextFailure = null; // { method: 'getSaleCustomers', message: 'Network failure' }
  window.__mockUser = {
    id: 1, name: 'Test Clerk', fullName: 'Test Clerk', email: 'clerk@sbc.test',
    role: 'Branch Manager', branch: A, branchScope: A, restricted: true
  };
  window.__nextRelease = null;   // e.g. { success:false, message:'...' } to simulate a rejection

  const handlers = {
    validateLogin: () => ({ success: true, user: window.__mockUser }),
    beginUnitRelease: () => ({ transactionId: 'mock-uuid-' + (++seq) }),
    getAvailableUnits: b => units.filter(u => u.currentStatus === 'Available' && (b === 'ALL' || u.currentBranch === b)),
    getSaleCustomers: b => (customers[b] || []).filter(c => !sales.some(s => s.cid === c.cid)),
    createUnitRelease: p => {
      if (window.__nextRelease) { const r = window.__nextRelease; window.__nextRelease = null; return r; }
      const u = units.find(x => x.mcid === p.MCID);
      const c = Object.keys(customers).map(k => customers[k]).reduce((a, b) => a.concat(b), []).find(x => x.cid === p.CID);
      u.currentStatus = 'Sold';
      sales.unshift({
        transactionNo: 'SALE-' + p.SINo, transactionId: p.TransactionID, date: p.SaleDate, customer: c.name,
        accountNo: p.AccountNo, siNo: p.SINo, engineNo: u.engineNo, unitType: u.unitType,
        branch: u.currentBranch, status: 'Completed', cid: c.cid
      });
      return { success: true, transactionId: p.TransactionID, transactionNo: 'SALE-' + p.SINo };
    },
    getSales: branch => sales.filter(s => branch === 'ALL' || s.branch === branch).map(s => Object.assign({}, s))
  };

  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return fn => runner(fn, onFailure);
        if (name === 'withFailureHandler') return fn => runner(onSuccess, fn);
        if (name === 'withUserObject') return () => runner(onSuccess, onFailure);
        return function () {
          const args = Array.prototype.slice.call(arguments);
          window.__gasCalls.push({ name: name, args: JSON.parse(JSON.stringify(args)) });
          setTimeout(function () {
            if (window.__nextFailure && window.__nextFailure.method === name) {
              const error = new Error(window.__nextFailure.message);
              window.__nextFailure = null;
              if (onFailure) onFailure(error);
              return;
            }
            const h = handlers[name];
            let res = null;
            if (h) {
              try { res = JSON.parse(JSON.stringify(h.apply(null, args))); }
              catch (e) { if (onFailure) onFailure(e); return; }
            }
            try { if (onSuccess) onSuccess(res); } catch (e) { window.__gasErrors.push({ name: name, message: String(e) }); }
          }, 120);
        };
      }
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };
})();
