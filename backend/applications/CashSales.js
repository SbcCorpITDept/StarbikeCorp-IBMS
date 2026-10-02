// CashSales.js - Cash sale records and cash sales template rendering.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// CASH — Cash Sales
// getCashData(branch)
//   branch : string  — user's assigned branch
//            'ALL'   — no restriction (Area Manager / Admin)
//
// Filters rows where "Store Branch:" column matches the user's branch.
// Image fields (id, stencil, crImg, rciImg, popImg, signature) are
// converted from AppSheet file paths → Google Drive thumbnail URLs.
// =============================================
function getCashData(branch) {
  try {
    console.log('getCashData() called — branch:', branch);

    const ss    = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetNameCash);

    if (!sheet) {
      console.error('Cash-Sales_Database sheet not found:', sheetNameCash);
      return [];
    }

    const data        = sheet.getDataRange().getValues();
    const displayData = sheet.getDataRange().getDisplayValues();

    if (data.length < 2) return [];

    const headers = data[0];

    // ── COLUMN MAP ──────────────────────────────────────────────────────────
    // Frontend table reads: csid, buyerName, salesType, contact, email, storeBranch
    // Everything else is extra data carried for the modal / PDF view.
    const COLUMN_CONFIG = {
      // FILING / TABLE DISPLAY
      csid:         { header: 'CSID',          useDisplay: false },
      refID:        { header: 'Repo Ref No.',  useDisplay: true  },
      storeBranch:  { header: 'Store Branch:' },                   // ← BRANCH FILTER KEY
      storeArea:    { header: 'Region\\Area' },
      salesDate:    { header: 'Date of Sales', useDisplay: true  },
      salesType:    { header: 'Sales Type' },

      // BUYER'S INFORMATION
      buyerName:    { header: 'BFN' },
      address:      { header: 'Address' },
      contact:      { header: 'Contact No.' },                     // frontend reads `cash.contact`
      email:        { header: 'Email' },

      // BUYER'S ID
      id:           { header: 'Uploaded ID' },                     // ← IMAGE
      idType:       { header: 'ID Type' },
      idNo:         { header: 'ID Number' },
      idExpiry:     { header: 'ID Expired',    useDisplay: true  },

      // MOTORCYCLE DETAILS
      brandModel:   { header: 'Brand/Model' },
      engineNo:     { header: 'Engine No.' },
      chassisNo:    { header: 'Chassis' },
      color:        { header: 'Color' },
      plateNo:      { header: 'Plate No.' },

      stencil:      { header: 'UploadStencil' },                   // ← IMAGE

      // PAYMENT DETAILS
      sellingPrice: { header: 'SP (Cash)' },
      paymentType:  { header: 'Mode of Payment' },

      // COLLECTION RECEIPT
      crImg:        { header: 'CR Img' },                          // ← IMAGE
      crNo:         { header: 'CR No.' },
      crDate:       { header: 'CR Date',       useDisplay: true  },

      // REPO-CASH INVOICE
      rciImg:       { header: 'RCI Img' },                         // ← IMAGE
      rciNo:        { header: 'RCI No.' },
      rciDate:      { header: 'RCI Date',      useDisplay: true  },

      // PROOF OF PURCHASE
      popImg:       { header: 'Upload Image' },                    // ← IMAGE

      // CONFIRMATION OF PURCHASE
      signature:    { header: "Buyer's Signature" },               // ← IMAGE
      signDate:     { header: 'Date',          useDisplay: true  }
    };
    // ── END COLUMN MAP ───────────────────────────────────────────────────────

    // Build column index lookup
    const colIndex = {};
    Object.keys(COLUMN_CONFIG).forEach(key => {
      colIndex[key] = headers.indexOf(COLUMN_CONFIG[key].header);
    });

    // ── BUILD DRIVE FILE CACHE ONCE for this execution ────────────────────
    // Same helper used by getSheetData() and getCIRData().
    const driveCache = buildDriveFileCache();

    const storeBranchIdx = colIndex['storeBranch'];
    // Keys whose cell values are AppSheet image paths → convert to Drive URLs.
    // Added popImg (was missing); kept the rest.
    const IMAGE_KEYS = new Set(['id', 'stencil', 'crImg', 'rciImg', 'popImg', 'signature']);
    const rows = [];

    for (let i = 1; i < data.length; i++) {
      const row        = data[i];
      const displayRow = displayData[i];

      // ── BRANCH FILTER (server-side) ──────────────────────────────────────
      if (!_matchesBranch(storeBranchIdx >= 0 ? row[storeBranchIdx] : '', branch)) continue;

      const rowData = {};

      Object.keys(COLUMN_CONFIG).forEach(key => {
        const cfg = COLUMN_CONFIG[key];
        const idx = colIndex[key];

        let value = (idx === -1)
          ? ''
          : (cfg.useDisplay ? displayRow[idx] : row[idx]) || '';

        // Convert AppSheet image path → Drive thumbnail URL.
        // This must run INSIDE the forEach where `key` and `value` exist.
        if (IMAGE_KEYS.has(key)) {
          value = pathToImageUrl(value, driveCache);
        }

        rowData[key] = value;
      });

      // Only include rows with meaningful data
      if (rowData.csid || rowData.buyerName || rowData.salesType) {
        rows.push(rowData);
      }
    }

    console.log('getCashData(): returned', rows.length, 'rows for branch:', branch);
    return rows;

  } catch (error) {
    console.error('getCashData() error:', error.toString());
    return [];
  }
}


// =============================================
// CASH — render PDF template (optional, for future)
// =============================================
function getCashSalesForm(cash) {
  const template = HtmlService.createTemplateFromFile('frontend/print/CashSalesForm');
  template.cash = cash;
  return template.evaluate().getContent();
}


