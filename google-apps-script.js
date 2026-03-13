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
//      F: Party | G: Office | H: Position | I: District | J: City | K: State
//      L: Vaccine Support | M: Question 1 | N: Question 2 | O: Question 3
//      P: Photo URL | Q: Verified | R: Verification Token
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

// --- Configuration ---

// Replace with your deployed Web App URL (needed for verification links)
var WEBAPP_URL = 'YOUR_DEPLOYED_WEBAPP_URL_HERE';

// Replace with your site URL (for the "View your pledge" link in emails)
var SITE_URL = 'https://scienceandfreedom.com';

// --- Helper ---

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Generate a random verification token
function generateToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// --- GET Handler ---

function doGet(e) {
  try {
    var action = e.parameter.action || 'getCandidates';

    if (action === 'getCandidates') return getCandidates();
    if (action === 'getLegislation') return getLegislation(e.parameter.state);
    if (action === 'getRepresentatives') return getRepresentatives(e.parameter.state);
    if (action === 'getTemplates') return getTemplates(e.parameter.stance);
    if (action === 'verify') return verifyEmail(e.parameter.token);

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

    // Column Q (index 16) = Verified status. Only return verified candidates.
    var verified = String(row[16] || '').toLowerCase();
    if (verified !== 'true' && verified !== 'yes') continue;

    candidates.push({
      id: 'row-' + i,
      timestamp: row[0] || '',
      firstName: row[1] || '', lastName: row[2] || '',
      email: row[3] || '', phone: row[4] || '',
      party: row[5] || '', office: row[6] || '',
      position: row[7] || '', district: row[8] || '',
      city: row[9] || '', state: row[10] || '',
      vaccineSupport: row[11] || '',
      question1: row[12] || '', question2: row[13] || '',
      question3: row[14] || '',
      photoUrl: row[15] || ''
    });
  }
  return jsonResponse({ candidates: candidates });
}

function submitPledge(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Candidates')
              || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var token = generateToken();
  var email = params.email || '';
  var firstName = params.firstName || '';
  var lastName = params.lastName || '';

  // Handle photo: if base64 data URL provided, save to Google Drive and get a public URL
  var photoUrl = '';
  if (params.photoData && params.photoData.indexOf('data:image') === 0) {
    try {
      photoUrl = savePhotoToDrive(params.photoData, firstName + '_' + lastName);
    } catch (err) {
      Logger.log('Photo save error: ' + err.message);
    }
  }

  // Append row with Verified = false and token
  // Columns: A-R (Timestamp, FirstName, LastName, Email, Phone, Party, Office,
  //   Position, District, City, State, VaccineSupport, Q1, Q2, Q3, PhotoURL, Verified, Token)
  sheet.appendRow([
    new Date().toISOString(),
    firstName, lastName,
    email, params.phone || '',
    params.party || '', params.office || '',
    params.position || '', params.district || '',
    params.city || '', params.state || '',
    params.vaccineSupport || '',
    params.question1 || '', params.question2 || '',
    params.question3 || '',
    photoUrl,
    'false',   // Not verified yet
    token
  ]);

  // Send verification email
  if (email) {
    sendVerificationEmail(email, firstName, lastName, token);
  }

  return jsonResponse({ success: true, message: 'Pledge submitted. Verification email sent.' });
}

// Save base64 photo to Google Drive and return public URL
function savePhotoToDrive(dataUrl, name) {
  // Parse the base64 data
  var parts = dataUrl.split(',');
  var mimeMatch = parts[0].match(/data:(image\/\w+);base64/);
  var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var ext = mime === 'image/png' ? '.png' : '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, name + ext);

  // Save to a "Candidate Photos" folder (create if needed)
  var folders = DriveApp.getFoldersByName('SAFE Action Candidate Photos');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('SAFE Action Candidate Photos');

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Return a direct image URL
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

// Send verification email with confirmation link
function sendVerificationEmail(email, firstName, lastName, token) {
  var verifyUrl = WEBAPP_URL + '?action=verify&token=' + token;
  var fullName = firstName + ' ' + lastName;

  var subject = 'Verify Your SAFE Action Pledge';

  var htmlBody = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; max-width: 600px; margin: 0 auto;">'
    + '<div style="background: #3C3B6E; padding: 24px; text-align: center;">'
    + '  <span style="color: #DAA520; font-size: 24px;">&#9733;</span>'
    + '  <span style="color: white; font-size: 22px; font-weight: bold; margin-left: 8px;">SAFE Action</span>'
    + '</div>'
    + '<div style="padding: 32px 24px; background: #FDFBF7;">'
    + '  <h2 style="color: #1a1a2e; margin-top: 0;">Thank you, ' + firstName + '!</h2>'
    + '  <p style="color: #444; font-size: 16px; line-height: 1.6;">'
    + '    We received your SAFE Action pledge. To make your pledge public and visible '
    + '    to voters, please verify your email address by clicking the button below.'
    + '  </p>'
    + '  <div style="text-align: center; margin: 32px 0;">'
    + '    <a href="' + verifyUrl + '" style="display: inline-block; background: #3C3B6E; color: white; '
    + '      padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">'
    + '      &#10003; Verify My Pledge'
    + '    </a>'
    + '  </div>'
    + '  <p style="color: #666; font-size: 14px; line-height: 1.5;">'
    + '    Once verified, your pledge will appear in the '
    + '    <a href="' + SITE_URL + '/directory.html" style="color: #3C3B6E;">SAFE Action Candidate Directory</a>.'
    + '  </p>'
    + '  <p style="color: #999; font-size: 12px; margin-top: 24px;">'
    + '    If you didn\'t submit this pledge, you can safely ignore this email.'
    + '  </p>'
    + '</div>'
    + '<div style="background: #f0f0f0; padding: 16px; text-align: center; font-size: 12px; color: #888;">'
    + '  Science and Freedom for Everyone Action Fund'
    + '</div>'
    + '</div>';

  var textBody = 'Thank you, ' + firstName + '!\n\n'
    + 'We received your SAFE Action pledge. To verify your email and make your pledge public, '
    + 'please visit this link:\n\n' + verifyUrl + '\n\n'
    + 'Once verified, your pledge will appear in the SAFE Action Candidate Directory.\n\n'
    + 'If you didn\'t submit this pledge, you can safely ignore this email.\n\n'
    + '- Science and Freedom for Everyone Action Fund';

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: textBody,
    htmlBody: htmlBody,
    name: 'SAFE Action'
  });
}

// Handle email verification (called via GET with ?action=verify&token=xxx)
function verifyEmail(token) {
  if (!token) {
    return HtmlService.createHtmlOutput(
      '<h2>Invalid verification link</h2><p>No token provided.</p>'
    );
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Candidates')
              || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  // Find the row with the matching token (column R = index 17)
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][17]) === token) {
      // Mark as verified (column Q = column 17 in 1-based = index 16)
      sheet.getRange(i + 1, 17).setValue('true');   // Column Q: Verified
      sheet.getRange(i + 1, 18).setValue('');        // Column R: Clear token

      var firstName = data[i][1];
      var lastName = data[i][2];
      var slug = (firstName + '-' + lastName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

      // Return a nice confirmation page
      return HtmlService.createHtmlOutput(
        '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; max-width: 500px; margin: 60px auto; text-align: center; padding: 40px 20px;">'
        + '<div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #10B981, #059669); '
        + '  color: white; font-size: 40px; line-height: 80px; margin: 0 auto 24px;">&#10003;</div>'
        + '<h1 style="color: #1a1a2e;">Email Verified!</h1>'
        + '<p style="color: #444; font-size: 18px;">Thank you, ' + firstName + '. Your SAFE Action pledge is now live.</p>'
        + '<a href="' + SITE_URL + '/candidates/' + slug + '" '
        + '  style="display: inline-block; margin-top: 24px; background: #3C3B6E; color: white; '
        + '  padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">'
        + '  View Your Pledge</a>'
        + '<p style="margin-top: 16px;"><a href="' + SITE_URL + '/directory.html" style="color: #3C3B6E;">View All Pledges</a></p>'
        + '</div>'
      ).setTitle('Email Verified - SAFE Action');
    }
  }

  return HtmlService.createHtmlOutput(
    '<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 60px auto; text-align: center; padding: 40px;">'
    + '<h2 style="color: #1a1a2e;">Verification Link Expired</h2>'
    + '<p style="color: #666;">This verification link has already been used or is invalid.</p>'
    + '<a href="' + SITE_URL + '/directory.html" style="color: #3C3B6E;">Visit SAFE Action</a>'
    + '</div>'
  ).setTitle('Verification - SAFE Action');
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
