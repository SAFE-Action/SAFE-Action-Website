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
        // No demo pledges — real pledges come from the Google Sheet
        return [];
    }
};
