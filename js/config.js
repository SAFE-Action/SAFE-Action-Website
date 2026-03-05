// ============================================
// SAFE Action - Configuration
// ============================================
//
// HOW TO SET UP:
// 1. Create a Google Sheet with these column headers (Row 1):
//    Timestamp | First Name | Last Name | Email | Phone | Party | Office | Position | District | City | Vaccine Support | Question 1 | Question 2 | Question 3
//
// 2. Go to Extensions > Apps Script in your Google Sheet
// 3. Paste the code from google-apps-script.js into the script editor
// 4. Deploy as a Web App:
//    - Click Deploy > New Deployment
//    - Select "Web app"
//    - Set "Execute as" to "Me"
//    - Set "Who has access" to "Anyone"
//    - Click Deploy
//    - Copy the Web App URL
//
// 5. Paste the Web App URL below:
//
const SAFE_CONFIG = {
    // Replace this URL with your deployed Google Apps Script Web App URL
    GOOGLE_SCRIPT_URL: 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE',

    // How often to refresh data (in milliseconds) - Default: 5 minutes
    CACHE_DURATION: 5 * 60 * 1000,

    // Set to true once you've configured the Google Script URL above
    IS_CONFIGURED: false,

    // All 50 states + DC + Federal
    STATES: {
        'US': 'Federal (U.S. Congress)',
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
        'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
        'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
        'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
        'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
        'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
        'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
        'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
        'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
    },

    // Bill status progression order (for pipeline visualization)
    STATUS_ORDER: [
        'Pre-filed', 'Introduced', 'In Committee', 'Passed Committee',
        'Floor Vote Scheduled', 'Passed One Chamber', 'In Conference',
        'Passed Both Chambers', 'Sent to Governor', 'Signed into Law'
    ],

    // Dead-end statuses
    DEAD_STATUSES: ['Vetoed', 'Died in Committee', 'Tabled', 'Withdrawn'],

    // Intelligence data path (relative to site root)
    INTELLIGENCE_DATA_PATH: 'data/',

    // Persuadability categories
    PERSUADABILITY_CATEGORIES: [
        'champion', 'likely-win', 'fence-sitter', 'unlikely', 'opposed'
    ]
};
