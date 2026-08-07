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
            // NEVER fabricate pledges. Inventing politicians who "took the pledge"
            // is a false public claim about real offices. Return empty and let the
            // directory show its honest empty state until the backend is wired.
            console.warn('SAFE Action: pledge backend not configured; showing no pledges.');
            return [];
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
     * Generate a URL-friendly slug from a candidate name
     */
    getSlug(candidate) {
        var first = (candidate.firstName || '').toLowerCase().trim();
        var last = (candidate.lastName || '').toLowerCase().trim();
        return (first + '-' + last)
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    },

    /**
     * Get a single candidate by ID
     */
    async getCandidate(id) {
        const candidates = await this.getCandidates();
        return candidates.find(c => c.id === id) || null;
    },

    /**
     * Get a single candidate by name slug (e.g. "sarah-mitchell")
     */
    async getCandidateBySlug(slug) {
        if (!slug) return null;
        var candidates = await this.getCandidates();
        var normalized = slug.toLowerCase().trim();
        return candidates.find(function(c) {
            var candidateSlug = SheetsAPI.getSlug(c);
            return candidateSlug === normalized;
        }) || null;
    },

    /**
     * Submit a new pledge form
     */
    async submitPledge(formData) {
        if (!SAFE_CONFIG.IS_CONFIGURED) {
            // Fail loudly rather than silently discarding a real candidate's pledge
            // behind a success message.
            console.error('SAFE Action: pledge backend not configured; submission refused.');
            throw new Error('Pledge submissions are temporarily unavailable. Please email greg@scienceandfreedom.com and we will record your pledge directly.');
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
    }

};
