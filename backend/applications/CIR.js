// CIR.js - Credit investigation records and report template rendering.
// Apps Script server files share one global scope; no imports are required.

// =============================================
// CIR — Credit Investigation Report
// getCIRData(branch)
//   branch : string  — user's assigned branch
//            'ALL'   — no restriction
//
// Filters rows where "Store Branch:" column matches the user's branch.
//
// FIX: cir_toWhom stores an AID (from Applicant_Database), NOT a CID.
// So the maker lookup must read from the CAS sheet, not CIR itself.
// _buildCASMakerLookup() handles this with a separate targeted read.
// =============================================
function getCIRData(branch) {
  try {
    console.log('getCIRData() called — branch:', branch);

    const ss    = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetNameCIR);

    if (!sheet) {
      console.error('CIR_Database sheet not found:', sheetNameCIR);
      return [];
    }

    const data        = sheet.getDataRange().getValues();
    const displayData = sheet.getDataRange().getDisplayValues();

    if (data.length < 2) return [];

    const headers = data[0];

    // ── COLUMN MAP ──────────────────────────────────────────────────────────
    const COLUMN_CONFIG = {
      // FILING DETAILS
      cid:                    { header: 'CID',               useDisplay: false },
      applicant:              { header: 'Applicant' },
      cir_toWhom:             { header: 'ToWhom' },          // raw AID → resolved to CAS maker name below
      applicantStatus:        { header: 'Status / Condition:' },
      typeOfApplicant:        { header: 'Type of Applicant:' },
      storeBranch:            { header: 'Store Branch:' },   // ← BRANCH FILTER KEY
      storeArea:              { header: 'Region\\Area' },
      collector:              { header: 'Assigned CI:' }, // ← future Area Manager filter
      agentName:              { header: 'Name of Agent:' },

      // MAKER DETAILS
      applicantName:          { header: 'ApplicantName',     useDisplay: false },
      lastName:               { header: 'LastName'},
      firstName:              { header: 'FirstName'},
      middleName:             { header: 'MiddleName'},
      suffix:                 { header: 'Suffix',            useDisplay: false },
      alias:                  { header: 'Alias',             useDisplay: false },

      cir_Birthdate:          { header: 'BirthDate',         useDisplay: true  },
      cir_Age:                { header: 'Age' },
      cir_PlaceOfBirth:       { header: 'Place of Birth' },
      cir_PhoneNo:            { header: 'ACellNo.' },
      cir_Religion:           { header: 'Religion' },
      cir_Nationality:        { header: 'Nationality' },

      // MAKER ADDRESS
      cir_PresAdd:            { header: 'Pres Address' },
      cir_YOS1:               { header: 'YearofStay1' },
      cir_ProvAdd:            { header: 'ProvAdd' },
      cir_YOS2:               { header: 'YearOfstay2' },
      cir_PrevAdd:            { header: 'PrevAdd' },
      cir_YOS3:               { header: 'YearOfStay3' },
      cir_WhyLeave:           { header: 'Reason for Moving' },
      cir_CivilStatus:        { header: 'Civil Status' },
      cir_WidowYears:         { header: 'WidowYears' },
      cir_EducationAttain:    { header: 'EducationAttain' },
      cir_Course:             { header: 'Course' },
      cir_RWAS:               { header: 'RWAS' },
      cir_Name:               { header: 'Name' },

      // MAKER EMPLOYMENT
      cir_EmpBusiName:        { header: 'A E/BN' },
      cir_EmpBusiAdd:         { header: 'E/BN Add' },
      cir_NetIncome:          { header: 'NetIncome' },
      cir_Position:           { header: 'Position' },
      cir_WorkService:        { header: 'Length of Ser.' },
      cir_WorkPhone:          { header: 'Contact No.' },

      // CO-SIGNEE DETAILS
      circos_ApplicantName:   { header: 'ApplicantName-' },
      circos_lastName:        { header: 'LastName-'},
      circos_firstName:       { header: 'FirstName-'},
      circos_middleName:      { header: 'MiddleName-'},
      circos_Suffix:          { header: 'Suffix-' },
      circos_Alias:           { header: 'Alias-' },

      circos_Birthdate:       { header: 'BirthDate-',        useDisplay: true },
      circos_Age:             { header: 'Age-' },
      circos_PlaceOfBirth:    { header: 'Place of Birth-' },
      circos_PhoneNo:         { header: 'SCellNo.-' },
      circos_Landline:        { header: 'Landline' },
      circos_Religion:        { header: 'Religion-' },
      circos_Nationality:     { header: 'Nationality-' },

      // CO-SIGNEE ADDRESS
      circos_PresAdd:         { header: 'Pres Address-' },
      circos_YOS1:            { header: 'YearofStay-1' },
      circos_ProvAdd:         { header: 'ProvAdd-' },
      circos_YOS2:            { header: 'YearOfstay-2' },
      circos_PrevAdd:         { header: 'PrevAdd-' },
      circos_YOS3:            { header: 'YearOfStay-3' },
      circos_WhyLeave:        { header: 'Reason for Moving-' },
      circos_CivilStatus:     { header: 'Civil Status-' },
      circos_WidowYears:      { header: 'WidowYears-' },
      circos_EducationAttain: { header: 'EducationAttain-' },
      circos_Course:          { header: 'Course-' },
      circos_HouseMember:     { header: 'No.OfHH-' },
      circos_DependentNo:     { header: 'No.OfDep-' },

      // CO-SIGNEE EMPLOYMENT
      circos_EmpBusiName:     { header: 'S E/BN' },
      circos_EmpBusiAdd:      { header: 'E/BN Add-' },
      circos_NetIncome:       { header: 'Net Income' },
      circos_Position:        { header: 'Position-' },
      circos_WorkService:     { header: 'Length of Ser.-' },
      circos_WorkPhone:       { header: 'Contact No.-' },

      // DEPENDENTS
      cirdep_First:           { header: 'First:' },
      cirdep_FAge:            { header: 'FAge:' },
      cirdep_FSchool:         { header: 'FSchool:' },
      cirdep_FSchoolAdd:      { header: 'FSA:' },
      cirdep_Second:          { header: 'Second:' },
      cirdep_SAge:            { header: 'SAge:' },
      cirdep_SSchool:         { header: 'SSchool:' },
      cirdep_SSchoolAdd:      { header: 'SSA' },
      cirdep_Third:           { header: 'Third:' },
      cirdep_TAge:            { header: 'TAge:' },
      cirdep_TSchool:         { header: 'TSchool:' },
      cirdep_TSchoolAdd:      { header: 'TSA' },

      cir_IDShown:            { header: 'ID Shown:' },

      // SOURCE OF INCOME
      cir_TOI1:               { header: 'TOI1' },
      cir_Net1:               { header: 'NET1' },
      cir_TOI2:               { header: 'TOI2' },
      cir_Net2:               { header: 'NET2' },
      cir_TOI3:               { header: 'TOI3' },
      cir_Net3:               { header: 'NET3' },
      cir_Total:              { header: 'Total Net' },

      // DEBT BURDEN RATIO
      dbr_MI:                 { header: 'MI' },
      dbr_NI:                 { header: 'DBR Net Income' },
      dbr_TotalDepExp:        { header: 'Total Expense' },
      dbr_TotalLoanAmount:    { header: 'Total Amnt of Loans' },
      dbr_TotalNI:            { header: 'Total Net Income' },
      dbr_DebtBurdenRatio:    { header: 'DBR Ratio' },
      dbr_NoOfDependents:     { header: 'No.OfDepen' },
      dbr_TotalExpenses:      { header: 'Total Expenses' },
      dbr_TotalLoans:         { header: 'Total Loans' },
      dbr_Loan1:              { header: 'Loan1' },
      dbr_Loan2:              { header: 'Loan2' },
      dbr_Loan3:              { header: 'Loan3' },

      // INCOME STATUS
      is_Class:               { header: 'TypeOfIncome' },

      // EXPENSES
      exp_Rent:               { header: 'Rent:' },
      exp_CarLoan:            { header: 'Car Loan' },
      exp_CreditCard:         { header: 'Credit Card' },
      exp_HousingLoan:        { header: 'Housing Loan' },
      exp_Others:             { header: 'Others' },

      // RESIDENCE DESCRIPTION
      tor_TypeOfRes:          { header: 'Type Of Res.' },
      tor_Owner:              { header: 'Owner:' },
      tor_MonthlyRent:        { header: 'Per Month:' },
      tor_LandLord:           { header: "Landlord's" },
      tor_OthersSpecify:      { header: 'Specify' },
      tor_ResidenceStatus:    { header: 'Residence Status:' },
      tor_HousingType:        { header: 'Housing Type:' },
      tor_HouseTypeOthers:    { header: 'HT Specify' },
      tor_ResidenceLoc:       { header: 'Residence Location:' },
      tor_ResiLocOthers:      { header: 'RL Specify' },
      tor_MadeOf:             { header: 'RMO:' },
      tor_MadeOfOthers:       { header: 'RMO Specify' },
      tor_Access:             { header: 'Accessibility:' },
      tor_Parking:            { header: 'Parking:' },
      tor_ParkingLoc:         { header: 'Parking Location:' },
      tor_LandMarkName:       { header: 'Landmark Name' },
      tor_LandMarkDistance:   { header: 'Distance from LMark' },

      // COLLATERAL
      tor_Items:              { header: 'items:' },
      tor_ColMCValue:         { header: 'MC Value:' },
      tor_ColCarValue:        { header: 'Car Value:' },
      tor_ColOthers:          { header: 'COL Specify:' },

      // ASSESSMENTS
      tor_CreditBG:           { header: 'Credit Background:' },
      tor_CharacterAssess:    { header: 'Assessment:' },

      // PRE-CONFIRMATION
      precon_Info1:           { header: 'PreC1:' },
      precon_Informant1:      { header: 'Informant 1:' },
      precon_InformantNo1:    { header: 'Contact 1:' },
      precon_Info2:           { header: 'PreC2:' },
      precon_Informant2:      { header: 'Informant 2:' },
      precon_InformantNo2:    { header: 'Contact 2:' },
      precon_Info3:           { header: 'PreC3:' },
      precon_Informant3:      { header: 'Informant 3:' },
      precon_InformantNo3:    { header: 'Contact 3:' },

      // POST-CONFIRMATION
      postcon_Info1:          { header: 'PostC1:' },
      postcon_Informant1:     { header: 'PInformant 1:' },
      postcon_InformantNo1:   { header: 'PContact 1:' },
      postcon_Info2:          { header: 'PostC2:' },
      postcon_Informant2:     { header: 'PInformant 2:' },
      postcon_InformantNo2:   { header: 'PContact 2:' },
      postcon_Info3:          { header: 'PostC3:' },
      postcon_Informant3:     { header: 'PInformant 2:' },
      postcon_InformantNo3:   { header: 'PContact 3:' },

      // RECOMMENDATION & FINANCING
      recommendation:         { header: 'Recommendation:' },
      cirfin_Brand:           { header: 'Brand' },
      cirfin_Unit:            { header: 'Unit:' },
      cirfin_DP:              { header: 'DP' },
      cirfin_Terms:           { header: 'TERMS' },
      cirfin_MI:              { header: 'Monthly Ins' },
      cirfin_DBR:             { header: 'DBR Ratio' },
      cirfin_User:            { header: 'User:' },
      cirfin_Purpose:         { header: 'Purpose:' },

      // SKETCH MAP (AppSheet → Drive thumbnail URL)
      cirSketch_Address:      { header: 'Sketch:' }
    };
    // ── END COLUMN MAP ───────────────────────────────────────────────────────

    // Build column index lookup
    const colIndex = {};
    Object.keys(COLUMN_CONFIG).forEach(key => {
      colIndex[key] = headers.indexOf(COLUMN_CONFIG[key].header);
    });

    // ── MAKER LOOKUP: reads CAS sheet for AID → ApplicantName ─────────────
    // FIX: cir_toWhom stores an AID from Applicant_Database, not a CID.
    // We must look up names from the CAS sheet — not from CIR itself.
    const makerLookup = _buildCASMakerLookup(ss);

    // ── DRIVE FILE CACHE — built once for this execution ──────────────────
    const driveCache     = buildDriveFileCache();
    const storeBranchIdx = colIndex['storeBranch'];
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

        // Resolve cir_toWhom AID → CAS Maker Name
        if (key === 'cir_toWhom' && value) {
          rowData.toWhomId = value;   // preserve raw ID if template needs it
          value = makerLookup[String(value).trim()] || value;
        }

        // Convert AppSheet image path → Drive thumbnail URL
        if (key === 'cirSketch_Address') {
          value = pathToImageUrl(value, driveCache);
        }

        rowData[key] = value;
      });

      // Expense checkbox helpers
      rowData.isRent        = Math.sign(Number(rowData.exp_Rent        || 0)) === 1;
      rowData.isCarLoan     = Math.sign(Number(rowData.exp_CarLoan     || 0)) === 1;
      rowData.isCreditCard  = Math.sign(Number(rowData.exp_CreditCard  || 0)) === 1;
      rowData.isHousingLoan = Math.sign(Number(rowData.exp_HousingLoan || 0)) === 1;
      rowData.isOthers      = Math.sign(Number(rowData.exp_Others      || 0)) === 1;

      if (rowData.cid || rowData.applicantName || rowData.alias ||
          rowData.applicant || rowData.typeOfApplicant || rowData.applicantStatus) {
        rows.push(rowData);
      }
    }

    console.log('getCIRData(): returned', rows.length, 'rows for branch:', branch);
    return rows;

  } catch (error) {
    console.error('getCIRData() error:', error.toString());
    return [];
  }
}


// =============================================
// CIR — render PDF template
// =============================================
function getCIRForm(cir) {
  const template = HtmlService.createTemplateFromFile('frontend/print/CIRForm');
  template.cir = cir;
  return template.evaluate().getContent();
}

