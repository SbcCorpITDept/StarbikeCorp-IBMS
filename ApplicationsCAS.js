// ApplicationsCAS.js - Customer applications, maker lookup, and credit application template rendering.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// BUILD CAS MAKER LOOKUP
// Reads Applicant_Database and returns a map of AID → ApplicantName.
// Used by getCIRData() so that cir_toWhom (which stores an AID) can be
// resolved to the maker's name without a second full sheet read.
// =============================================
function _buildCASMakerLookup(ss) {
  const sheet = ss.getSheetByName(sheetNameCAS);
  if (!sheet) return {};

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const aidIdx  = headers.indexOf('AID');
  const nameIdx = headers.indexOf('ApplicantName');

  if (aidIdx === -1 || nameIdx === -1) return {};

  const lookup = {};
  for (let i = 1; i < data.length; i++) {
    const aid  = data[i][aidIdx];
    const name = data[i][nameIdx];
    if (aid) lookup[String(aid).trim()] = name || '';
  }
  return lookup;
}


// =============================================
// APPLICATION MENU
// =============================================



// =============================================
// CAS — Customer Application Sheet
// getSheetData(branch)
//   branch : string  — user's assigned branch from UserTable col F
//            'ALL'   — no branch restriction, return everything
//
// Filters rows where "Store Branch:" matches the user's branch.
// =============================================
function getSheetData(branch) {
  try {
    console.log('getSheetData() called — branch:', branch);

    const ss    = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetNameCAS);

    if (!sheet) {
      console.error('Applicant_Database sheet not found');
      return [];
    }

    const data        = sheet.getDataRange().getValues();
    const displayData = sheet.getDataRange().getDisplayValues();

    if (data.length < 2) return [];

    const headers = data[0];

    // ── COLUMN MAP ──────────────────────────────────────────────────────────
    const COLUMN_CONFIG = {
      // FILING DETAILS
      aid:                  { header: 'AID',                           useDisplay: false },
      applicant:            { header: 'Applicant' },
      toWhom:               { header: 'ToWhom' },                      // raw AID → resolved to name below
      storeBranch:          { header: 'Store Branch:' },               // ← BRANCH FILTER KEY
      storeArea:            { header: 'Region\\Area'},
      applicationDate:      { header: 'Date of Application:',          useDisplay: true },
      collector:            { header: 'Collector Code - Name' },       // ← for future Area Manager filter
      applicantStatus:      { header: 'Applicant Status:',             useDisplay: false },
      typeOfApplicant:      { header: 'Type of Applicant',             useDisplay: false },
      agentName:            { header: 'Name of Agent (If with Agent):' },

      // MAKER DETAILS
      applicantName:        { header: 'ApplicantName',                 useDisplay: false },
      lastName:             { header: 'LastName'},
      firstName:            { header: 'FirstName'},
      middleName:           { header: 'MiddleName'},
      suffix:               { header: 'Suffix',                        useDisplay: false },
      alias:                { header: 'Alias',                         useDisplay: false },

      maker_Birthdate:      { header: 'BirthDate',                     useDisplay: true  },
      maker_Age:            { header: 'Age' },
      maker_BirthPlace:     { header: 'Place of Birth' },
      maker_CellNo:         { header: 'ACellNo.' },
      maker_Religion:       { header: 'Religion' },
      maker_Nationality:    { header: 'Nationality' },

      // MAKER ADDRESS
      maker_Present:        { header: 'Pres Address' },
      maker_YOS1:           { header: 'YearofStay1' },
      maker_Province:       { header: 'ProvAdd' },
      maker_YOS2:           { header: 'YearOfstay2' },
      maker_Previous:       { header: 'PrevAdd' },
      maker_YOS3:           { header: 'YearOfStay3' },
      maker_WhyLeave:       { header: 'Reason for Moving' },
      maker_Civil:          { header: 'Civil Status' },
      maker_YearWidow:      { header: 'WidowYears' },
      maker_Education:      { header: 'EducationAttain' },
      maker_Course:         { header: 'Course' },
      maker_RWAS:           { header: 'RWAS' },
      maker_Name:           { header: 'Name' },

      // MAKER EMPLOYMENT
      maker_EmpBusiName:    { header: 'A E/BN' },
      maker_EmpBusiAdd:     { header: 'E/BN Add' },
      maker_Position:       { header: 'Position' },
      maker_WorkService:    { header: 'Length of Ser.' },
      maker_WorkContact:    { header: 'Contact No.' },

      // MAKER INCOME
      maker_TOI1:           { header: 'TOI1' },
      maker_Net1:           { header: 'NET1' },
      maker_TOI2:           { header: 'TOI2' },
      maker_Net2:           { header: 'NET2' },
      maker_TOI3:           { header: 'TOI3' },
      maker_Net3:           { header: 'NET3' },
      maker_Total:          { header: 'Total Net' },

      // CO-SIGNEE DETAILS
      cosign_lastName:      { header: 'LastName-'},
      cosign_firstName:     { header: 'FirstName-'},
      cosign_middleName:    { header: 'MiddleName-'},
      cosign_ApplicantName: { header: 'ApplicantName-' },
      cosign_Suffix:        { header: 'Suffix-' },
      cosign_Alias:         { header: 'Alias-' },

      cosign_Birthdate:     { header: 'BirthDate-',      useDisplay: true },
      cosign_Age:           { header: 'Age-' },
      cosign_BirthPlace:    { header: 'Place of Birth-' },
      cosign_CellNo:        { header: 'SCellNo.-' },
      cosign_Landline:      { header: 'Landline' },
      cosign_Religion:      { header: 'Religion-' },
      cosign_Nationality:   { header: 'Nationality-' },

      // CO-SIGNEE ADDRESS
      cosign_Present:       { header: 'Pres Address-' },
      cosign_YOS1:          { header: 'YearofStay-1' },
      cosign_Province:      { header: 'ProvAdd-' },
      cosign_YOS2:          { header: 'YearOfstay-2',    useDisplay: true },
      cosign_Previous:      { header: 'PrevAdd-' },
      cosign_YOS3:          { header: 'YearOfStay-3',    useDisplay: true },
      cosign_WhyLeave:      { header: 'Reason for Moving-' },
      cosign_Civil:         { header: 'Civil Status-' },   // fixed: removed stray extra space
      cosign_YearWidow:     { header: 'WidowYears-' },
      cosign_Education:     { header: 'EducationAttain-' },
      cosign_Course:        { header: 'Course-' },
      cosign_HouseHold:     { header: 'No.OfHH-' },
      cosign_Dependents:    { header: 'No.OfDep-' },

      // CO-SIGNEE EMPLOYMENT
      cosign_EmpBusiName:   { header: 'S E/BN' },
      cosign_EmpBusiAdd:    { header: 'E/BN Add-' },
      cosign_Position:      { header: 'Position-' },
      cosign_NetIncome:     { header: 'Net Income' },
      cosign_WorkService:   { header: 'Length of Ser.-' },
      cosign_WorkContact:   { header: 'Contact No.-' },

      // DEPENDENTS
      dep_Child1:           { header: 'First:' },
      dep_FAge:             { header: 'FAge:' },
      dep_FSchool:          { header: 'FSchool:' },
      dep_FAddress:         { header: 'FSA:' },
      dep_Child2:           { header: 'Second:' },
      dep_SAge:             { header: 'SAge:' },
      dep_SSchool:          { header: 'SSchool:' },
      dep_SAddress:         { header: 'SSA' },
      dep_Child3:           { header: 'Third:' },
      dep_TAge:             { header: 'TAge:' },
      dep_TSchool:          { header: 'TSchool:' },
      dep_TAddress:         { header: 'TSA' },

      // CREDIT PREFERENCES
      cred_Rent:            { header: 'Rent' },
      cred_HouseLoan:       { header: 'HousingLoan' },
      cred_CreditCard:      { header: 'CreditCard' },
      cred_MCLoan:          { header: 'MCLoan' },
      cred_CarLoan:         { header: 'CarLoan' },
      cred_Other:           { header: 'OtherLoans' },

      // PERSONAL REFERENCES
      pref_MotherName:      { header: "Mothe'rs Name" },
      pref_MAddress:        { header: 'M Address' },
      pref_MContact:        { header: 'M Mobile No.' },
      pref_FatherName:      { header: "Father's Name" },
      pref_FAddress:        { header: 'F Address' },
      pref_FContact:        { header: 'F Mobile No.' },
      pref_NRNLWA:          { header: 'NRNLWA' },
      pref_NAddress:        { header: 'N Address' },
      pref_NContact:        { header: 'N Mobile No.' },
      pref_FriendName:      { header: "Friend's Name" },
      pref_FRAddress:       { header: 'Fr Address' },
      pref_FRContact:       { header: 'Fr Mobile No.' },
      pref_SpouseMother:    { header: "Spouse's Mother" },
      pref_SMAddress:       { header: 'Sm Address' },
      pref_SMContact:       { header: 'Sm Mobile No.' },
      pref_SpouseFather:    { header: "Spouse's Father" },
      pref_SFAddress:       { header: 'Sf Address' },
      pref_SFContact:       { header: 'Sf Mobile No.' },

      // FINANCING DETAILS
      fd_Brand:             { header: 'Brand/Model:' },
      fd_Unit:              { header: 'Unit:' },
      fd_DP:                { header: 'DP' },
      fd_Terms:             { header: 'Terms' },
      fd_MI:                { header: 'MI' },
      fd_Purpose:           { header: 'Purpose:' },
      fd_User:              { header: 'User:' },

      // SKETCH AND SIGNATURE PATHS (AppSheet → Drive thumbnail URLs)
      idPic:                { header: '2x2Pic' },
      sketch_address:       { header: 'Img of Res. Add' },
      sketch_business:      { header: 'Img of Emp. Or Bus. Add.' },
      signDate:             { header: 'Date',             useDisplay: true },
      signature:            { header: 'Signature' }
    };
    // ── END COLUMN MAP ───────────────────────────────────────────────────────

    // Build column index lookup
    const colIndex = {};
    Object.keys(COLUMN_CONFIG).forEach(key => {
      colIndex[key] = headers.indexOf(COLUMN_CONFIG[key].header);
    });

    // ── BUILD CAS MAKER LOOKUP (AID → ApplicantName) ──────────────────────
    // Used to resolve the toWhom field (which stores an AID) to a human name.
    // Built from the same sheet data we already have — no extra read needed.
    const makerLookup = {};
    for (let i = 1; i < data.length; i++) {
      const aid  = data[i][colIndex['aid']];
      const name = data[i][colIndex['applicantName']];
      if (aid) makerLookup[String(aid).trim()] = name || '';
    }

    // ── BUILD DRIVE FILE CACHE ONCE for this execution ────────────────────
    const driveCache = buildDriveFileCache();

    const storeBranchIdx = colIndex['storeBranch'];
    const IMAGE_KEYS     = new Set(['idPic', 'sketch_address', 'sketch_business', 'signature']);
    const rows           = [];

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

        // Resolve toWhom AID → Maker Name
        if (key === 'toWhom' && value) {
          rowData.toWhomId = value;   // preserve raw ID if needed by a template
          value = makerLookup[String(value).trim()] || value;
        }

        // Convert AppSheet image path → Drive thumbnail URL
        if (IMAGE_KEYS.has(key)) {
          value = pathToImageUrl(value, driveCache);
        }

        rowData[key] = value;
      });

      // Only include rows with meaningful data
      if (rowData.aid || rowData.applicantName || rowData.alias || rowData.applicant) {
        rows.push(rowData);
      }
    }

    console.log('getSheetData(): returned', rows.length, 'rows for branch:', branch);
    return rows;

  } catch (error) {
    console.error('getSheetData() error:', error.toString());
    return [];
  }
}


// =============================================
// CAS — render PDF template
// =============================================
function getCasApplicationForm(applicant) {
  const template = HtmlService.createTemplateFromFile('CASFormTemplate');
  template.applicant = applicant;
  return template.evaluate().getContent();
}

