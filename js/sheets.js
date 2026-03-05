// ============================================
// SAFE Action - Google Sheets Integration
// ============================================

const SheetsAPI = {
    _cache: null,
    _cacheTime: 0,

    /**
     * Fetch all candidates from the Google Sheet
     */
    async getCandidates(forceRefresh = false) {
        // Return cached data if fresh enough
        if (!forceRefresh && this._cache && (Date.now() - this._cacheTime < SAFE_CONFIG.CACHE_DURATION)) {
            return this._cache;
        }

        if (!SAFE_CONFIG.IS_CONFIGURED) {
            console.warn('SAFE Action: Google Sheets not configured. Using demo data.');
            return this._getDemoData();
        }

        try {
            const response = await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL + '?action=getCandidates');
            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();

            if (data.error) throw new Error(data.error);

            this._cache = data.candidates || [];
            this._cacheTime = Date.now();
            return this._cache;
        } catch (error) {
            console.error('Error fetching candidates:', error);
            // Return cached data if available, otherwise empty
            return this._cache || [];
        }
    },

    /**
     * Get a single candidate by row index
     */
    async getCandidate(id) {
        const candidates = await this.getCandidates();
        return candidates.find(c => c.id === id) || null;
    },

    /**
     * Submit a new pledge form
     */
    async submitPledge(formData) {
        if (!SAFE_CONFIG.IS_CONFIGURED) {
            console.warn('SAFE Action: Google Sheets not configured. Simulating submission.');
            return new Promise(resolve => {
                setTimeout(() => resolve({ success: true, message: 'Demo mode - not actually saved.' }), 1500);
            });
        }

        try {
            const response = await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'submitPledge',
                    ...formData
                })
            });

            // no-cors means we can't read the response, but if it didn't throw, it likely worked
            return { success: true };
        } catch (error) {
            console.error('Error submitting pledge:', error);
            throw error;
        }
    },

    /**
     * Demo data for testing before Google Sheets is connected
     */
    _getDemoData() {
        return [
            {
                id: 'demo-1',
                firstName: 'Jane',
                lastName: 'Smith',
                email: 'jane.smith@example.com',
                phone: '(555) 123-4567',
                party: 'Republican',
                office: 'U.S. Senate',
                position: 'Senator',
                district: '',
                city: 'Austin',
                state: 'TX',
                vaccineSupport: 'It depends / Nuanced position',
                question1: 'I believe in individual liberty and the right of every American to make their own medical decisions. As a strong advocate for informed consent, I support transparency in vaccine research and oppose any government mandates that force medical procedures on unwilling citizens.',
                question2: 'I plan to introduce legislation that protects the right to medical choice and ensures that no American faces discrimination based on their personal health decisions.',
                question3: 'My campaign is focused on liberty, transparency, and putting the power back in the hands of the people.',
                timestamp: '2026-03-01T10:00:00Z'
            },
            {
                id: 'demo-2',
                firstName: 'John',
                lastName: 'Davis',
                email: 'john.davis@example.com',
                phone: '(555) 987-6543',
                party: 'Libertarian',
                office: 'State Representative',
                position: 'Representative',
                district: 'District 12',
                city: 'Denver',
                state: 'CO',
                vaccineSupport: 'No',
                question1: 'Medical freedom is a fundamental right. The government should never have the authority to mandate what goes into your body. I oppose all vaccine mandates at every level of government.',
                question2: 'I will work to repeal any existing mandates and ensure robust religious and philosophical exemptions are protected by law.',
                question3: '',
                timestamp: '2026-03-02T14:30:00Z'
            },
            {
                id: 'demo-3',
                firstName: 'Maria',
                lastName: 'Gonzalez',
                email: 'maria.gonzalez@example.com',
                phone: '(555) 456-7890',
                party: 'Independent',
                office: 'City Council',
                position: 'Council Member',
                district: 'Ward 5',
                city: 'Phoenix',
                state: 'AZ',
                vaccineSupport: 'Yes',
                question1: 'While I support vaccines as a public health tool, I firmly believe in informed consent and parental choice. No one should be forced to take any medical treatment against their will.',
                question2: '',
                question3: 'I bring 15 years of community organizing experience and am committed to representing ALL residents regardless of their personal health choices.',
                timestamp: '2026-03-03T09:15:00Z'
            }
        ];
    }
};
