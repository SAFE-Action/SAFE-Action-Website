// ============================================
// SAFE Action - Legislation & Representatives API
// ============================================

const LegislationAPI = {
    _billCache: null,
    _billCacheTime: 0,
    _repCache: {},
    _repCacheTime: {},
    _templateCache: null,

    // --- Legislation ---

    async getLegislation(state, forceRefresh = false) {
        const cacheKey = state || 'all';
        if (!forceRefresh && this._billCache && this._billCache[cacheKey] &&
            (Date.now() - this._billCacheTime < SAFE_CONFIG.CACHE_DURATION)) {
            return this._billCache[cacheKey];
        }

        if (!SAFE_CONFIG.IS_CONFIGURED) {
            return this._getDemoLegislation(state);
        }

        try {
            let url = SAFE_CONFIG.GOOGLE_SCRIPT_URL + '?action=getLegislation';
            if (state) url += '&state=' + encodeURIComponent(state);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (!this._billCache) this._billCache = {};
            this._billCache[cacheKey] = data.bills || [];
            this._billCacheTime = Date.now();
            return this._billCache[cacheKey];
        } catch (error) {
            console.error('Error fetching legislation:', error);
            return (this._billCache && this._billCache[cacheKey]) || [];
        }
    },

    async getBill(billId) {
        // Search all cached data first
        if (this._billCache) {
            for (const key of Object.keys(this._billCache)) {
                const found = this._billCache[key].find(b => b.billId === billId);
                if (found) return found;
            }
        }
        // Fetch all and search
        const allBills = await this.getLegislation(null, true);
        return allBills.find(b => b.billId === billId) || null;
    },

    // --- Representatives ---

    async getRepresentatives(state, forceRefresh = false) {
        if (!forceRefresh && this._repCache[state] &&
            (Date.now() - (this._repCacheTime[state] || 0) < SAFE_CONFIG.CACHE_DURATION)) {
            return this._repCache[state];
        }

        if (!SAFE_CONFIG.IS_CONFIGURED) {
            return this._getDemoRepresentatives(state);
        }

        try {
            const url = SAFE_CONFIG.GOOGLE_SCRIPT_URL + '?action=getRepresentatives&state=' + encodeURIComponent(state);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._repCache[state] = data.representatives || [];
            this._repCacheTime[state] = Date.now();
            return this._repCache[state];
        } catch (error) {
            console.error('Error fetching representatives:', error);
            return this._repCache[state] || [];
        }
    },

    // --- Action Templates ---

    async getTemplates(stance, forceRefresh = false) {
        if (!forceRefresh && this._templateCache) {
            if (stance) return this._templateCache.filter(t => t.stance === stance);
            return this._templateCache;
        }

        if (!SAFE_CONFIG.IS_CONFIGURED) {
            const demos = this._getDemoTemplates();
            this._templateCache = demos;
            if (stance) return demos.filter(t => t.stance === stance);
            return demos;
        }

        try {
            const url = SAFE_CONFIG.GOOGLE_SCRIPT_URL + '?action=getTemplates';
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._templateCache = data.templates || [];
            if (stance) return this._templateCache.filter(t => t.stance === stance);
            return this._templateCache;
        } catch (error) {
            console.error('Error fetching templates:', error);
            return this._templateCache || [];
        }
    },

    // --- Email Signup ---

    async submitEmailSignup(email, state, source) {
        if (!SAFE_CONFIG.IS_CONFIGURED) {
            return new Promise(resolve => {
                setTimeout(() => resolve({ success: true, message: 'Demo mode' }), 800);
            });
        }

        try {
            await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ action: 'emailSignup', email, state, source })
            });
            return { success: true };
        } catch (error) {
            console.error('Error submitting email signup:', error);
            throw error;
        }
    },

    // --- Victories (Stopped Bills) ---

    async getVictories() {
        const allBills = await this.getLegislation(null);
        const deadStatuses = SAFE_CONFIG.DEAD_STATUSES;
        return allBills.filter(b =>
            b.billType === 'anti' &&
            deadStatuses.includes(b.status) &&
            b.stoppedWithAction
        );
    },

    // --- Template Filling ---

    fillTemplate(template, data) {
        if (!template) return '';
        return template
            .replace(/\{REP_NAME\}/g, data.repName || '[Representative Name]')
            .replace(/\{REP_TITLE\}/g, data.repTitle || '[Title]')
            .replace(/\{BILL_NUMBER\}/g, data.billNumber || '[Bill Number]')
            .replace(/\{BILL_TITLE\}/g, data.billTitle || '[Bill Title]')
            .replace(/\{STATE\}/g, data.state || '[State]')
            .replace(/\{YOUR_NAME\}/g, data.yourName || '[Your Name]')
            .replace(/\{YOUR_CITY\}/g, data.yourCity || '[Your City]');
    },

    // --- Demo Data ---

    _getDemoLegislation(state) {
        const allBills = [
            // ===== ANTI-SCIENCE BILLS =====

            // Texas - State
            {
                billId: 'TX-HB1547', state: 'TX', level: 'State', billNumber: 'HB 1547',
                title: 'Vaccine Exemption Expansion Act',
                summary: 'Expands religious and philosophical exemptions for childhood vaccine requirements in public schools. Removes requirement for physician signature on exemption forms and prohibits schools from denying enrollment based on vaccine status.',
                status: 'In Committee', isActive: 'Yes', chamber: 'House',
                committee: 'Public Health Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-02-28', lastAction: 'Referred to Public Health Committee for hearing on March 12',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-01'
            },
            {
                billId: 'TX-SB892', state: 'TX', level: 'State', billNumber: 'SB 892',
                title: 'Medical Freedom Protection Act',
                summary: 'Prohibits state and local governments from mandating any vaccine for employment, education, or public accommodation. Establishes penalties for entities that discriminate based on vaccination status.',
                status: 'Introduced', isActive: 'Yes', chamber: 'Senate',
                committee: '', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Medical Freedom',
                lastActionDate: '2026-02-15', lastAction: 'Introduced and read first time',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-16'
            },
            // Texas - Local
            {
                billId: 'TX-LOCAL-AUS01', state: 'TX', level: 'Local', billNumber: 'Austin Ord. 2026-03',
                title: 'Austin: Opt-Out of Fluoride in Municipal Water',
                summary: 'Local ordinance to halt fluoride supplementation in Austin municipal water supply, citing disputed health concerns. Contradicts CDC recommendations for community water fluoridation.',
                status: 'Introduced', isActive: 'Yes', chamber: 'City Council',
                committee: 'Public Utilities Committee', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Environmental Health',
                lastActionDate: '2026-02-20', lastAction: 'Referred to Public Utilities Committee',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-21'
            },

            // Florida - State
            {
                billId: 'FL-HB203', state: 'FL', level: 'State', billNumber: 'HB 203',
                title: 'Ban on mRNA Vaccine Technology for Minors',
                summary: 'Bans the administration of mRNA-based vaccines to individuals under 18 years of age. Requires separate informed consent process for all novel vaccine platforms.',
                status: 'Passed Committee', isActive: 'Yes', chamber: 'House',
                committee: 'Health & Human Services', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-03-01', lastAction: 'Passed committee 7-4, moves to full House floor',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-20'
            },
            {
                billId: 'FL-SB445', state: 'FL', level: 'State', billNumber: 'SB 445',
                title: 'Parental Rights in Child Vaccination Act',
                summary: 'Establishes that parents have sole authority over vaccination decisions for their children. Eliminates school-entry vaccine requirements entirely.',
                status: 'In Committee', isActive: 'Yes', chamber: 'Senate',
                committee: 'Education Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-02-20', lastAction: 'Subcommittee hearing scheduled for March 5',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-01'
            },
            // Florida - Local
            {
                billId: 'FL-LOCAL-MIA01', state: 'FL', level: 'Local', billNumber: 'Miami-Dade Res. 2026-14',
                title: 'Miami-Dade: Ban 5G Towers Near Schools',
                summary: 'Resolution to ban installation of 5G cellular towers within 1500 feet of schools and daycare facilities, citing unsubstantiated health claims contradicted by scientific evidence.',
                status: 'Introduced', isActive: 'Yes', chamber: 'County Commission',
                committee: '', stance: 'Oppose', impact: 'Low',
                billType: 'anti', category: 'Environmental Health',
                lastActionDate: '2026-03-01', lastAction: 'Filed with county commission',
                fullTextUrl: '#', notes: '', dateAdded: '2026-03-01'
            },

            // Ohio - State
            {
                billId: 'OH-HB78', state: 'OH', level: 'State', billNumber: 'HB 78',
                title: 'Informed Consent for Immunizations Act',
                summary: 'Requires extensive disclosure documents for all vaccines administered in the state, including unproven claims about vaccine risks. Creates a state-run "vaccine injury" reporting portal.',
                status: 'Introduced', isActive: 'Yes', chamber: 'House',
                committee: '', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-03-02', lastAction: 'Introduced with 12 co-sponsors',
                fullTextUrl: '#', notes: '', dateAdded: '2026-03-02'
            },

            // Idaho - State
            {
                billId: 'ID-HB305', state: 'ID', level: 'State', billNumber: 'HB 305',
                title: 'Teaching Alternatives to Evolution Act',
                summary: 'Requires public school science classes to present "alternative theories" alongside evolution, including intelligent design. Allows teachers to use non-peer-reviewed materials.',
                status: 'In Committee', isActive: 'Yes', chamber: 'House',
                committee: 'Education Committee', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Science Education',
                lastActionDate: '2026-02-18', lastAction: 'Assigned to Education Committee',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-18'
            },

            // Missouri - State
            {
                billId: 'MO-SB211', state: 'MO', level: 'State', billNumber: 'SB 211',
                title: 'Prohibition of Gain-of-Function Research',
                summary: 'Bans all gain-of-function research at state-funded universities and research institutions. Defines gain-of-function extremely broadly, potentially affecting routine virology research.',
                status: 'Pre-filed', isActive: 'Yes', chamber: 'Senate',
                committee: '', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Research & Education',
                lastActionDate: '2026-02-10', lastAction: 'Pre-filed for 2026 session',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-10'
            },

            // California - State (dead)
            {
                billId: 'CA-AB1122', state: 'CA', level: 'State', billNumber: 'AB 1122',
                title: 'Weakening School Immunization Standards',
                summary: 'Reverses California SB 277 by reintroducing personal belief exemptions for school vaccination requirements. Allows parents to opt out of any required vaccine without medical justification.',
                status: 'Died in Committee', isActive: 'No', chamber: 'Assembly',
                committee: 'Health Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-01-30', lastAction: 'Failed to receive committee vote, died in committee',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-05'
            },

            // Federal - Anti
            {
                billId: 'US-HR4521', state: 'US', level: 'Federal', billNumber: 'H.R. 4521',
                title: 'National Vaccine Choice Act',
                summary: 'Federal bill that would prohibit any federal agency from mandating vaccines and would withhold federal funding from states that maintain vaccine requirements for school entry.',
                status: 'In Committee', isActive: 'Yes', chamber: 'House',
                committee: 'Energy and Commerce Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2026-02-25', lastAction: 'Referred to Subcommittee on Health',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-10'
            },
            {
                billId: 'US-S1287', state: 'US', level: 'Federal', billNumber: 'S. 1287',
                title: 'Defund WHO Act',
                summary: 'Permanently defunds U.S. participation in the World Health Organization and redirects funds away from global pandemic preparedness programs.',
                status: 'Introduced', isActive: 'Yes', chamber: 'Senate',
                committee: 'Foreign Relations Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Public Health Funding',
                lastActionDate: '2026-02-20', lastAction: 'Introduced with 8 co-sponsors',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-20'
            },

            // ===== PRO-SCIENCE BILLS =====

            // California - Pro Science
            {
                billId: 'CA-SB456', state: 'CA', level: 'State', billNumber: 'SB 456',
                title: 'Strengthening Science Education Standards Act',
                summary: 'Increases funding for STEM education in public schools by 15%. Mandates evidence-based science curriculum aligned with Next Generation Science Standards. Creates science literacy benchmarks.',
                status: 'Passed Committee', isActive: 'Yes', chamber: 'Senate',
                committee: 'Education Committee', stance: 'Support', impact: 'High',
                billType: 'pro', category: 'Science Education',
                lastActionDate: '2026-03-02', lastAction: 'Passed committee unanimously, headed to full Senate floor',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-15'
            },

            // New York - Pro
            {
                billId: 'NY-AB2234', state: 'NY', level: 'State', billNumber: 'AB 2234',
                title: 'Public Health Research Funding Act',
                summary: 'Establishes a $200M annual state fund for public health research, including vaccine development, epidemiology, and pandemic preparedness at state universities.',
                status: 'In Committee', isActive: 'Yes', chamber: 'Assembly',
                committee: 'Higher Education Committee', stance: 'Support', impact: 'High',
                billType: 'pro', category: 'Public Health Funding',
                lastActionDate: '2026-02-28', lastAction: 'Hearing scheduled for March 10',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-10'
            },
            {
                billId: 'NY-SB1890', state: 'NY', level: 'State', billNumber: 'SB 1890',
                title: 'Protecting School Vaccine Requirements Act',
                summary: 'Strengthens school-entry vaccine requirements by closing non-medical exemption loopholes and requiring annual review of exemption rates by county health departments.',
                status: 'Introduced', isActive: 'Yes', chamber: 'Senate',
                committee: '', stance: 'Support', impact: 'High',
                billType: 'pro', category: 'Vaccines & Immunization',
                lastActionDate: '2026-03-01', lastAction: 'Introduced with bipartisan support',
                fullTextUrl: '#', notes: '', dateAdded: '2026-03-01'
            },

            // Colorado - Pro
            {
                billId: 'CO-HB1078', state: 'CO', level: 'State', billNumber: 'HB 1078',
                title: 'Climate Science Curriculum Act',
                summary: 'Mandates that K-12 public schools include climate science education based on peer-reviewed research. Provides teacher training grants and updated curriculum materials.',
                status: 'Passed One Chamber', isActive: 'Yes', chamber: 'House',
                committee: '', stance: 'Support', impact: 'Medium',
                billType: 'pro', category: 'Science Education',
                lastActionDate: '2026-02-25', lastAction: 'Passed House 38-27, sent to Senate',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-20'
            },

            // Washington - Pro
            {
                billId: 'WA-SB5512', state: 'WA', level: 'State', billNumber: 'SB 5512',
                title: 'Biomedical Research Investment Act',
                summary: 'Creates tax incentives for biotech companies conducting vaccine and therapeutic research in Washington state. Establishes a biomedical innovation hub at University of Washington.',
                status: 'In Committee', isActive: 'Yes', chamber: 'Senate',
                committee: 'Economic Development Committee', stance: 'Support', impact: 'Medium',
                billType: 'pro', category: 'Research & Education',
                lastActionDate: '2026-02-18', lastAction: 'Referred to Economic Development Committee',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-05'
            },

            // Massachusetts - Pro + Local
            {
                billId: 'MA-HB3301', state: 'MA', level: 'State', billNumber: 'HB 3301',
                title: 'Evidence-Based Drug Policy Act',
                summary: 'Requires all state drug scheduling and treatment policy decisions to be based on peer-reviewed scientific evidence. Creates an independent scientific advisory board.',
                status: 'Introduced', isActive: 'Yes', chamber: 'House',
                committee: '', stance: 'Support', impact: 'Medium',
                billType: 'pro', category: 'Drug & Treatment Policy',
                lastActionDate: '2026-03-03', lastAction: 'Introduced and assigned to Joint Committee on Public Health',
                fullTextUrl: '#', notes: '', dateAdded: '2026-03-03'
            },

            // Local Pro - Denver
            {
                billId: 'CO-LOCAL-DEN01', state: 'CO', level: 'Local', billNumber: 'Denver Ord. 2026-08',
                title: 'Denver: Free Community Vaccination Clinics',
                summary: 'Allocates city funds for free community vaccination clinics in underserved neighborhoods. Partners with local health systems to improve childhood immunization rates.',
                status: 'Passed Both Chambers', isActive: 'Yes', chamber: 'City Council',
                committee: '', stance: 'Support', impact: 'Medium',
                billType: 'pro', category: 'Vaccines & Immunization',
                lastActionDate: '2026-02-22', lastAction: 'Approved by city council 11-2',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-30'
            },

            // Local Pro - Seattle
            {
                billId: 'WA-LOCAL-SEA01', state: 'WA', level: 'Local', billNumber: 'Seattle Res. 2026-22',
                title: 'Seattle: Science Literacy Initiative',
                summary: 'Establishes citywide science literacy program including free public lectures, library science resources, and community lab partnerships to combat misinformation.',
                status: 'Signed into Law', isActive: 'Yes', chamber: 'City Council',
                committee: '', stance: 'Support', impact: 'Low',
                billType: 'pro', category: 'Science Education',
                lastActionDate: '2026-02-10', lastAction: 'Signed by mayor, takes effect April 1',
                fullTextUrl: '#', notes: '', dateAdded: '2026-01-15'
            },

            // Federal - Pro
            {
                billId: 'US-HR3892', state: 'US', level: 'Federal', billNumber: 'H.R. 3892',
                title: 'Pandemic Preparedness and Science Trust Act',
                summary: 'Increases NIH funding by $5B over 5 years for pandemic preparedness research. Establishes a public trust office to improve transparency and public confidence in scientific institutions.',
                status: 'In Committee', isActive: 'Yes', chamber: 'House',
                committee: 'Appropriations Committee', stance: 'Support', impact: 'High',
                billType: 'pro', category: 'Public Health Funding',
                lastActionDate: '2026-03-01', lastAction: 'Markup session scheduled for March 15',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-01'
            },
            {
                billId: 'US-S2145', state: 'US', level: 'Federal', billNumber: 'S. 2145',
                title: 'Protecting Scientific Integrity in Government Act',
                summary: 'Prohibits political interference in federal scientific research. Establishes whistleblower protections for government scientists and mandates evidence-based policymaking across federal agencies.',
                status: 'Introduced', isActive: 'Yes', chamber: 'Senate',
                committee: 'Commerce, Science, and Transportation Committee', stance: 'Support', impact: 'High',
                billType: 'pro', category: 'Research & Education',
                lastActionDate: '2026-02-27', lastAction: 'Introduced with 15 bipartisan co-sponsors',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-27'
            },

            // Georgia - Anti Local
            {
                billId: 'GA-LOCAL-ATL01', state: 'GA', level: 'Local', billNumber: 'Fulton Co. Res. 2026-05',
                title: 'Fulton County: Restrict Contact Tracing Programs',
                summary: 'Resolution to defund county-level disease contact tracing programs and prohibit sharing of health data with state or federal agencies for disease surveillance.',
                status: 'In Committee', isActive: 'Yes', chamber: 'County Commission',
                committee: 'Health and Human Services Committee', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Public Health Funding',
                lastActionDate: '2026-02-15', lastAction: 'Referred to Health committee for review',
                fullTextUrl: '#', notes: '', dateAdded: '2026-02-15'
            },

            // Pennsylvania - Pro
            {
                billId: 'PA-HB1456', state: 'PA', level: 'State', billNumber: 'HB 1456',
                title: 'Clean Water Science Standards Act',
                summary: 'Requires all state water quality standards to be based on the latest peer-reviewed environmental science. Creates an independent scientific review board for water safety decisions.',
                status: 'Introduced', isActive: 'Yes', chamber: 'House',
                committee: '', stance: 'Support', impact: 'Medium',
                billType: 'pro', category: 'Environmental Health',
                lastActionDate: '2026-03-01', lastAction: 'Introduced and referred to Environmental Resources Committee',
                fullTextUrl: '#', notes: '', dateAdded: '2026-03-01'
            },

            // ===== STOPPED ANTI-SCIENCE BILLS (victories) =====

            {
                billId: 'FL-HB0312', state: 'FL', level: 'State', billNumber: 'HB 312',
                title: 'Abolish Mandatory School Vaccinations Act',
                summary: 'Would have eliminated all required vaccinations for public and private school enrollment in Florida. The bill was defeated after significant public opposition and constituent pressure.',
                status: 'Died in Committee', isActive: 'No', chamber: 'House',
                committee: 'Health & Human Services Subcommittee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Vaccines & Immunization',
                lastActionDate: '2025-12-15', lastAction: 'Failed to advance, died in committee',
                fullTextUrl: '#', notes: '', dateAdded: '2025-09-01',
                stoppedWithAction: true, actionsTaken: 142
            },
            {
                billId: 'OH-SB0188', state: 'OH', level: 'State', billNumber: 'SB 188',
                title: 'Defund State Public Health Labs Act',
                summary: 'Would have cut 60% of funding to Ohio state public health laboratories, crippling the state\'s ability to test for infectious diseases and environmental contaminants. Withdrawn after constituent outcry.',
                status: 'Withdrawn', isActive: 'No', chamber: 'Senate',
                committee: 'Health Committee', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Public Health Funding',
                lastActionDate: '2025-11-20', lastAction: 'Sponsor withdrew the bill citing constituent feedback',
                fullTextUrl: '#', notes: '', dateAdded: '2025-08-15',
                stoppedWithAction: true, actionsTaken: 87
            },
            {
                billId: 'TX-HB0922', state: 'TX', level: 'State', billNumber: 'HB 922',
                title: 'Ban Fluoride in Public Water Act',
                summary: 'Would have banned community water fluoridation in all Texas municipalities despite decades of scientific evidence supporting its safety and effectiveness. Tabled after overwhelming scientific testimony.',
                status: 'Tabled', isActive: 'No', chamber: 'House',
                committee: 'Public Health Committee', stance: 'Oppose', impact: 'Medium',
                billType: 'anti', category: 'Environmental Health',
                lastActionDate: '2026-01-10', lastAction: 'Tabled indefinitely following public hearing',
                fullTextUrl: '#', notes: '', dateAdded: '2025-10-01',
                stoppedWithAction: true, actionsTaken: 63
            },
            {
                billId: 'MO-SB0445', state: 'MO', level: 'State', billNumber: 'SB 445',
                title: 'Prohibit Evidence-Based Medicine Mandates',
                summary: 'Would have prohibited Missouri from requiring healthcare providers to follow evidence-based treatment guidelines, allowing any treatment regardless of scientific support. Vetoed by governor.',
                status: 'Vetoed', isActive: 'No', chamber: 'Senate',
                committee: '', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Drug & Treatment Policy',
                lastActionDate: '2025-10-05', lastAction: 'Vetoed by Governor citing public safety concerns',
                fullTextUrl: '#', notes: '', dateAdded: '2025-06-01',
                stoppedWithAction: true, actionsTaken: 198
            },
            {
                billId: 'ID-HB0234', state: 'ID', level: 'State', billNumber: 'HB 234',
                title: 'Eliminate State Epidemiologist Position',
                summary: 'Would have eliminated the State Epidemiologist position and defunded Idaho\'s disease surveillance programs. Died in committee after health officials and constituents objected.',
                status: 'Died in Committee', isActive: 'No', chamber: 'House',
                committee: 'Health & Welfare', stance: 'Oppose', impact: 'High',
                billType: 'anti', category: 'Public Health Funding',
                lastActionDate: '2025-11-01', lastAction: 'Failed to receive hearing, died in committee',
                fullTextUrl: '#', notes: '', dateAdded: '2025-07-15',
                stoppedWithAction: true, actionsTaken: 54
            }
        ];

        if (state) {
            return allBills.filter(b => b.state === state || b.state === 'US');
        }
        return allBills;
    },

    _getDemoRepresentatives(state) {
        const allReps = {
            'TX': [
                { state: 'TX', level: 'State', chamber: 'House', district: 'District 45',
                  name: 'Rep. Sarah Johnson', party: 'Republican', phone: '(512) 463-0574',
                  email: 'sarah.johnson@house.texas.gov', committees: 'Public Health, Education', notes: 'Chair of Public Health Committee' },
                { state: 'TX', level: 'State', chamber: 'House', district: 'District 22',
                  name: 'Rep. Michael Chen', party: 'Democrat', phone: '(512) 463-0398',
                  email: 'michael.chen@house.texas.gov', committees: 'Public Health, Appropriations', notes: '' },
                { state: 'TX', level: 'State', chamber: 'Senate', district: 'District 10',
                  name: 'Sen. Robert Williams', party: 'Republican', phone: '(512) 463-0110',
                  email: 'robert.williams@senate.texas.gov', committees: 'Health and Human Services', notes: '' },
                { state: 'TX', level: 'Federal', chamber: 'Senate', district: '',
                  name: 'Sen. John Cornyn', party: 'Republican', phone: '(202) 224-2934',
                  email: 'senator@cornyn.senate.gov', committees: 'Judiciary, Finance', notes: 'Senior Senator' }
            ],
            'FL': [
                { state: 'FL', level: 'State', chamber: 'House', district: 'District 15',
                  name: 'Rep. Ana Martinez', party: 'Republican', phone: '(850) 717-5015',
                  email: 'ana.martinez@myfloridahouse.gov', committees: 'Health & Human Services', notes: '' },
                { state: 'FL', level: 'State', chamber: 'Senate', district: 'District 8',
                  name: 'Sen. David Brown', party: 'Republican', phone: '(850) 487-5008',
                  email: 'brown.david@flsenate.gov', committees: 'Education, Health Policy', notes: '' }
            ],
            'OH': [
                { state: 'OH', level: 'State', chamber: 'House', district: 'District 3',
                  name: 'Rep. Lisa Park', party: 'Republican', phone: '(614) 466-1474',
                  email: 'rep03@ohiohouse.gov', committees: 'Health, Families and Aging', notes: '' }
            ],
            'CA': [
                { state: 'CA', level: 'State', chamber: 'Senate', district: 'District 11',
                  name: 'Sen. Maria Rodriguez', party: 'Democrat', phone: '(916) 651-4011',
                  email: 'senator.rodriguez@senate.ca.gov', committees: 'Education, Health', notes: '' }
            ],
            'NY': [
                { state: 'NY', level: 'State', chamber: 'Assembly', district: 'District 65',
                  name: 'Asm. David Kim', party: 'Democrat', phone: '(518) 455-4567',
                  email: 'kimd@nyassembly.gov', committees: 'Higher Education, Health', notes: '' },
                { state: 'NY', level: 'State', chamber: 'Senate', district: 'District 27',
                  name: 'Sen. Patricia Moore', party: 'Democrat', phone: '(518) 455-2015',
                  email: 'moore@nysenate.gov', committees: 'Health, Education', notes: '' }
            ],
            'CO': [
                { state: 'CO', level: 'State', chamber: 'House', district: 'District 9',
                  name: 'Rep. James Rivera', party: 'Democrat', phone: '(303) 866-2914',
                  email: 'james.rivera@state.co.us', committees: 'Education, Public Health', notes: '' }
            ],
            'WA': [
                { state: 'WA', level: 'State', chamber: 'Senate', district: 'District 43',
                  name: 'Sen. Emily Nakamura', party: 'Democrat', phone: '(360) 786-7636',
                  email: 'emily.nakamura@leg.wa.gov', committees: 'Economic Development, Science', notes: '' }
            ]
        };

        if (state && allReps[state]) return allReps[state];
        if (state) return [];
        return Object.values(allReps).flat();
    },

    _getDemoTemplates() {
        return [
            {
                templateId: 'oppose-email-general',
                type: 'Email',
                stance: 'Oppose',
                subject: 'Please OPPOSE {BILL_NUMBER} - {BILL_TITLE}',
                body: `Dear {REP_TITLE} {REP_NAME},

I am writing as a concerned constituent from {YOUR_CITY}, {STATE} to urge you to OPPOSE {BILL_NUMBER}, the {BILL_TITLE}.

This legislation undermines public health by weakening vaccine requirements that protect our communities, especially our children. Vaccines are one of the greatest achievements in modern medicine and have saved millions of lives.

I urge you to stand with science and protect the health of all {STATE} residents by opposing this bill.

Thank you for your time and service.

Sincerely,
{YOUR_NAME}
{YOUR_CITY}, {STATE}`,
                category: 'general'
            },
            {
                templateId: 'oppose-phone-general',
                type: 'Phone',
                stance: 'Oppose',
                subject: '',
                body: `Hello, my name is {YOUR_NAME} and I'm a constituent from {YOUR_CITY}.

I'm calling to ask {REP_TITLE} {REP_NAME} to please OPPOSE {BILL_NUMBER}, the {BILL_TITLE}.

This bill would weaken important public health protections and I believe it puts our community at risk. I urge the {REP_TITLE} to vote NO on this bill.

Thank you for taking my call.`,
                category: 'general'
            },
            {
                templateId: 'support-email-general',
                type: 'Email',
                stance: 'Support',
                subject: 'Please SUPPORT {BILL_NUMBER} - {BILL_TITLE}',
                body: `Dear {REP_TITLE} {REP_NAME},

I am writing as a concerned constituent from {YOUR_CITY}, {STATE} to urge you to SUPPORT {BILL_NUMBER}, the {BILL_TITLE}.

This legislation strengthens public health protections and advances evidence-based policy for our communities. Supporting science is essential for the well-being of all {STATE} residents.

I urge you to stand with science and vote YES on this important bill.

Thank you for your time and service.

Sincerely,
{YOUR_NAME}
{YOUR_CITY}, {STATE}`,
                category: 'general'
            },
            {
                templateId: 'support-phone-general',
                type: 'Phone',
                stance: 'Support',
                subject: '',
                body: `Hello, my name is {YOUR_NAME} and I'm a constituent from {YOUR_CITY}.

I'm calling to ask {REP_TITLE} {REP_NAME} to please SUPPORT {BILL_NUMBER}, the {BILL_TITLE}.

This bill advances evidence-based science policy and I believe it benefits our community. I urge the {REP_TITLE} to vote YES on this bill.

Thank you for taking my call.`,
                category: 'general'
            }
        ];
    }
};
