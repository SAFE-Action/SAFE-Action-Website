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

    async _getDemoLegislation(state) {
        // Load from static bill data file (populated by crawler)
        try {
            const resp = await fetch('data/bills.json');
            if (!resp.ok) return [];
            const data = await resp.json();
            const bills = data.bills || [];
            if (!state || state === 'ALL') return bills;
            return bills.filter(b => b.state === state);
        } catch (e) {
            console.warn('No bill data available yet');
            return [];
        }
    },

    async _getDemoRepresentatives(state) {
        // Load from static legislator data file (populated by crawler)
        try {
            const resp = await fetch('data/legislators.json');
            if (!resp.ok) return [];
            const data = await resp.json();
            const legislators = data.legislators || [];
            if (!state) return legislators;
            const filtered = legislators.filter(l => l.state === state);
            // Transform to the rep format the tracker expects
            return filtered.map(l => ({
                name: l.name,
                title: l.chamber === 'Senate' ? 'Sen.' : 'Rep.',
                party: l.party,
                phone: (l.contact || {}).phone || '',
                email: (l.contact || {}).email || '',
                office: l.office,
                district: l.district,
                state: l.state
            }));
        } catch (e) {
            console.warn('No legislator data available yet');
            return [];
        }
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
