// ============================================
// SAFE Action - Google Apps Script
// ============================================
//
// SETUP INSTRUCTIONS:
//
// 1. Create a new Google Sheet with these TABS (sheet tabs at the bottom):
//
//    TAB 1: "Candidates" (default/first sheet) - Column headers (Row 1):
//      A: Timestamp | B: First Name | C: Last Name | D: Email | E: Phone
//      F: Party | G: Office | H: Position | I: District | J: City
//      K: Vaccine Support | L: Question 1 | M: Question 2 | N: Question 3
//
//    TAB 2: "Legislation" - Column headers (Row 1):
//      A: Bill ID | B: State | C: Level | D: Bill Number | E: Title
//      F: Summary | G: Status | H: Is Active | I: Chamber | J: Committee
//      K: Stance | L: Impact | M: Last Action Date | N: Last Action
//      O: Full Text URL | P: SAFE Notes | Q: Date Added
//
//    TAB 3: "Representatives" - Column headers (Row 1):
//      A: State | B: Level | C: Chamber | D: District | E: Name
//      F: Party | G: Phone | H: Email | I: Committee Assignments | J: Notes
//
//    TAB 4: "Action Templates" - Column headers (Row 1):
//      A: Template ID | B: Type | C: Stance | D: Subject | E: Body | F: Category
//
//    TAB 5: "Email Signups" - Column headers (Row 1):
//      A: Timestamp | B: Email | C: State | D: Source
//
// 2. Go to Extensions > Apps Script
// 3. Delete any existing code and paste this entire file
// 4. Click Deploy > New Deployment
//    - Select "Web app"
//    - Execute as: "Me"
//    - Who has access: "Anyone"
//    - Click Deploy
// 5. Copy the Web App URL
// 6. Paste into js/config.js and set IS_CONFIGURED to true
//
// ============================================

// --- Helper ---

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- GET Handler ---

function doGet(e) {
  try {
    var action = e.parameter.action || 'getCandidates';

    if (action === 'getCandidates') return getCandidates();
    if (action === 'getLegislation') return getLegislation(e.parameter.state);
    if (action === 'getRepresentatives') return getRepresentatives(e.parameter.state);
    if (action === 'getTemplates') return getTemplates(e.parameter.stance);

    return jsonResponse({ error: 'Unknown action' });
  } catch (error) {
    return jsonResponse({ error: error.message });
  }
}

// --- POST Handler ---

function doPost(e) {
  try {
    var params = e.parameter;
    var action = params.action || 'submitPledge';

    if (action === 'submitPledge') return submitPledge(params);
    if (action === 'emailSignup') return emailSignup(params);

    return jsonResponse({ error: 'Unknown action' });
  } catch (error) {
    return jsonResponse({ error: error.message });
  }
}

// --- Candidates ---

function getCandidates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Candidates')
              || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  if (data.length <= 1) return jsonResponse({ candidates: [] });

  var candidates = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1] && !row[2]) continue;
    candidates.push({
      id: 'row-' + i,
      timestamp: row[0] || '',
      firstName: row[1] || '', lastName: row[2] || '',
      email: row[3] || '', phone: row[4] || '',
      party: row[5] || '', office: row[6] || '',
      position: row[7] || '', district: row[8] || '',
      city: row[9] || '', vaccineSupport: row[10] || '',
      question1: row[11] || '', question2: row[12] || '',
      question3: row[13] || ''
    });
  }
  return jsonResponse({ candidates: candidates });
}

function submitPledge(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Candidates')
              || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow([
    new Date().toISOString(),
    params.firstName || '', params.lastName || '',
    params.email || '', params.phone || '',
    params.party || '', params.office || '',
    params.position || '', params.district || '',
    params.city || '', params.vaccineSupport || '',
    params.question1 || '', params.question2 || '',
    params.question3 || ''
  ]);
  return jsonResponse({ success: true, message: 'Pledge submitted successfully.' });
}

// --- Legislation ---

function getLegislation(state) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Legislation');
  if (!sheet) return jsonResponse({ bills: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ bills: [] });

  var bills = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    // Include bill if: no state filter, matches state, or is federal (US)
    if (state && row[1] !== state && row[1] !== 'US') continue;
    bills.push({
      billId: row[0] || '', state: row[1] || '', level: row[2] || '',
      billNumber: row[3] || '', title: row[4] || '', summary: row[5] || '',
      status: row[6] || '', isActive: row[7] || '', chamber: row[8] || '',
      committee: row[9] || '', stance: row[10] || '', impact: row[11] || '',
      lastActionDate: row[12] || '', lastAction: row[13] || '',
      fullTextUrl: row[14] || '', notes: row[15] || '', dateAdded: row[16] || ''
    });
  }
  return jsonResponse({ bills: bills });
}

// --- Representatives ---

function getRepresentatives(state) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Representatives');
  if (!sheet) return jsonResponse({ representatives: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ representatives: [] });

  var reps = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    if (state && row[0] !== state) continue;
    reps.push({
      state: row[0] || '', level: row[1] || '', chamber: row[2] || '',
      district: row[3] || '', name: row[4] || '', party: row[5] || '',
      phone: row[6] || '', email: row[7] || '',
      committees: row[8] || '', notes: row[9] || ''
    });
  }
  return jsonResponse({ representatives: reps });
}

// --- Action Templates ---

function getTemplates(stance) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Action Templates');
  if (!sheet) return jsonResponse({ templates: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ templates: [] });

  var templates = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    if (stance && row[2] !== stance) continue;
    templates.push({
      templateId: row[0] || '', type: row[1] || '', stance: row[2] || '',
      subject: row[3] || '', body: row[4] || '', category: row[5] || ''
    });
  }
  return jsonResponse({ templates: templates });
}

// --- Email Signups ---

function emailSignup(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Email Signups');
  if (!sheet) {
    // Create the tab if it doesn't exist
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Email Signups');
    sheet.appendRow(['Timestamp', 'Email', 'State', 'Source']);
  }
  sheet.appendRow([
    new Date().toISOString(),
    params.email || '',
    params.state || '',
    params.source || ''
  ]);
  return jsonResponse({ success: true, message: 'Signed up successfully.' });
}
