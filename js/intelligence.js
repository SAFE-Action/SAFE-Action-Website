// ============================================
// SAFE Action - Intelligence Data Module
// Loads crawler JSON output and provides it
// to all pages that need legislator intelligence.
// ============================================

const IntelligenceAPI = {
    _cache: {},
    _cacheTime: {},
    CACHE_TTL: 10 * 60 * 1000, // 10 minutes

    DATA_FILES: {
        legislators: 'data/legislators.json',
        news: 'data/news.json',
        analysis: 'data/analysis.json',
        pivotal: 'data/pivotal.json',
    },

    // ── Data Fetchers ────────────────────────────────

    async _fetchJSON(key) {
        if (this._cache[key] && (Date.now() - (this._cacheTime[key] || 0) < this.CACHE_TTL)) {
            return this._cache[key];
        }
        try {
            const resp = await fetch(this.DATA_FILES[key]);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._cache[key] = data;
            this._cacheTime[key] = Date.now();
            return data;
        } catch (e) {
            console.warn(`IntelligenceAPI: Could not load ${key}`, e);
            return null;
        }
    },

    async getLegislators(state) {
        const data = await this._fetchJSON('legislators');
        if (!data || !data.legislators) return [];
        if (state) return data.legislators.filter(l => l.state === state);
        return data.legislators;
    },

    async getLegislator(legislatorId) {
        const all = await this.getLegislators();
        return all.find(l => l.legislator_id === legislatorId) || null;
    },

    async getLegislatorsByState(state) {
        const legs = await this.getLegislators(state);
        return legs.sort((a, b) => {
            const sA = a.persuadability ? a.persuadability.score : 5;
            const sB = b.persuadability ? b.persuadability.score : 5;
            const pA = (sA >= 4 && sA <= 6) ? 0 : (sA >= 7 ? 1 : 2);
            const pB = (sB >= 4 && sB <= 6) ? 0 : (sB >= 7 ? 1 : 2);
            return pA - pB || sB - sA;
        });
    },

    async getPivotalTargets(state) {
        const data = await this._fetchJSON('pivotal');
        if (!data || !data.targets) return [];
        if (state) return data.targets.filter(t => t.state === state);
        return data.targets;
    },

    async getNews(filters = {}) {
        const data = await this._fetchJSON('news');
        if (!data || !data.articles) return [];
        let articles = data.articles;

        if (filters.legislator_id) {
            articles = articles.filter(a =>
                a.legislator_ids && a.legislator_ids.includes(filters.legislator_id)
            );
        }
        if (filters.state) {
            const stateLegislators = await this.getLegislators(filters.state);
            const ids = new Set(stateLegislators.map(l => l.legislator_id));
            articles = articles.filter(a =>
                a.legislator_ids && a.legislator_ids.some(id => ids.has(id))
            );
        }
        if (filters.sentiment) {
            articles = articles.filter(a => a.sentiment === filters.sentiment);
        }

        return articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    },

    async getAnalysisSummary() {
        return await this._fetchJSON('analysis');
    },

    async isAvailable() {
        try {
            const resp = await fetch(this.DATA_FILES.analysis, { method: 'HEAD' });
            return resp.ok;
        } catch {
            return false;
        }
    },

    // ── UI Helpers ───────────────────────────────────

    getCategoryBadgeClass(category) {
        return {
            'champion': 'badge-champion',
            'likely-win': 'badge-likely-win',
            'fence-sitter': 'badge-fence-sitter',
            'unlikely': 'badge-unlikely',
            'opposed': 'badge-opposed',
        }[category] || '';
    },

    getCategoryLabel(category) {
        return {
            'champion': 'Champion',
            'likely-win': 'Likely Win',
            'fence-sitter': 'Fence-Sitter',
            'unlikely': 'Unlikely',
            'opposed': 'Opposed',
        }[category] || category || 'Unknown';
    },

    getCategoryIcon(category) {
        return {
            'champion': '&#9733;',       // star
            'likely-win': '&#10003;',     // checkmark
            'fence-sitter': '&#8646;',    // left-right arrows
            'unlikely': '&#10007;',       // X
            'opposed': '&#9888;',         // warning
        }[category] || '&#8226;';
    },

    getScoreColor(score) {
        if (score >= 7) return '#065F46';   // green
        if (score >= 4) return '#92400E';   // amber
        return '#991B1B';                    // red
    },

    getPriorityLabel(priority) {
        return {
            1: 'Critical',
            2: 'High',
            3: 'Medium',
            4: 'Low',
            5: 'Minimal',
        }[priority] || 'Unknown';
    },

    getPriorityClass(priority) {
        return {
            1: 'priority-critical',
            2: 'priority-high',
            3: 'priority-medium',
            4: 'priority-low',
        }[priority] || 'priority-low';
    },
};
