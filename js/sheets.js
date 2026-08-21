// ============================================
// SAFE Action - Candidate Pledge API
// Talks to the Firebase pledge backend (functions/pledges.js).
// The public list contains VERIFIED pledges only and never includes
// email or phone. Kept under the SheetsAPI name because directory.js,
// quiz.js, and candidate.html all bind to it.
// ============================================

const SheetsAPI = {
    _cache: null,
    _cacheTime: 0,

    /**
     * Fetch all verified pledges.
     */
    async getCandidates(forceRefresh = false) {
        if (!forceRefresh && this._cache && (Date.now() - this._cacheTime < SAFE_CONFIG.CACHE_DURATION)) {
            return this._cache;
        }
        try {
            const response = await fetch('/api/pledges/list');
            if (!response.ok) throw new Error('Pledge list HTTP ' + response.status);
            const data = await response.json();
            this._cache = data.candidates || [];
            this._cacheTime = Date.now();
            return this._cache;
        } catch (error) {
            console.error('Error fetching pledges:', error);
            // Stale cache beats a blank page; empty beats fabrication.
            return this._cache || [];
        }
    },

    getSlug(candidate) {
        var first = (candidate.firstName || '').toLowerCase().trim();
        var last = (candidate.lastName || '').toLowerCase().trim();
        return (first + '-' + last)
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    },

    async getCandidateById(id) {
        if (!id) return null;
        const candidates = await this.getCandidates();
        var wanted = String(id).toLowerCase();
        return candidates.find(c => c.id === id || SheetsAPI.getSlug(c) === wanted) || null;
    },

    // Legacy name kept: candidate.html?id=... calls this.
    async getCandidate(id) {
        return this.getCandidateById(id);
    },

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
     * Submit a pledge. The backend sends a verification email; the pledge
     * becomes public only after the candidate clicks the link in it.
     */
    async submitPledge(formData) {
        const payload = { ...formData, website: '' }; // honeypot: present and empty
        delete payload.photoData; // no photo storage in this version
        const response = await fetch('/api/pledges/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = {};
        try { data = await response.json(); } catch (e) { /* non-JSON error body */ }
        if (!response.ok) {
            throw new Error(data.error || 'Submission failed. Please try again.');
        }
        return { success: true, message: data.message };
    }

};
