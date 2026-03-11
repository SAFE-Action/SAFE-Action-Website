// ============================================
// SAFE Action - Intelligence Dashboard Page
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const summaryGrid = document.getElementById('intel-summary');
    const pivotalGrid = document.getElementById('pivotal-grid');
    const legislatorGrid = document.getElementById('legislator-grid');
    const newsFeed = document.getElementById('news-feed');
    const emptyState = document.getElementById('intel-empty');
    const countEl = document.getElementById('intel-count');

    // Filters
    const stateSelect = document.getElementById('intel-state');
    const partySelect = document.getElementById('intel-party');
    const categorySelect = document.getElementById('intel-category');
    const searchInput = document.getElementById('intel-search');

    // State
    let allLegislators = [];
    let allNews = [];
    let allPivotal = [];

    init();

    async function init() {
        // Populate state filter
        if (typeof SAFE_CONFIG !== 'undefined' && SAFE_CONFIG.STATES) {
            Object.entries(SAFE_CONFIG.STATES).forEach(([code, name]) => {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = name;
                stateSelect.appendChild(opt);
            });
        }

        // Check availability
        const available = await IntelligenceAPI.isAvailable();
        if (!available) {
            summaryGrid.innerHTML = '';
            emptyState.style.display = '';
            return;
        }

        // Load all data
        const [analysis, legislators, pivotal, news] = await Promise.all([
            IntelligenceAPI.getAnalysisSummary(),
            IntelligenceAPI.getLegislators(),
            IntelligenceAPI.getPivotalTargets(),
            IntelligenceAPI.getNews(),
        ]);

        allLegislators = legislators;
        allNews = news;
        allPivotal = pivotal;

        renderSummary(analysis);
        renderPivotalTargets(pivotal);
        renderLegislators(legislators);
        renderNews(news);

        // Bind filters
        stateSelect.addEventListener('change', applyFilters);
        partySelect.addEventListener('change', applyFilters);
        categorySelect.addEventListener('change', applyFilters);
        searchInput.addEventListener('input', debounce(applyFilters, 300));
    }

    function renderSummary(analysis) {
        if (!analysis) {
            summaryGrid.innerHTML = '';
            return;
        }
        const cats = analysis.by_category || {};
        summaryGrid.innerHTML = `
            <div class="intel-summary-card">
                <div class="intel-summary-number">${analysis.total_legislators || 0}</div>
                <div class="intel-summary-label">Legislators Analyzed</div>
            </div>
            <div class="intel-summary-card card-champion">
                <div class="intel-summary-number">${cats.champion || 0}</div>
                <div class="intel-summary-label">Champions</div>
            </div>
            <div class="intel-summary-card card-likely">
                <div class="intel-summary-number">${cats['likely-win'] || 0}</div>
                <div class="intel-summary-label">Likely Wins</div>
            </div>
            <div class="intel-summary-card card-fence">
                <div class="intel-summary-number">${cats['fence-sitter'] || 0}</div>
                <div class="intel-summary-label">Fence-Sitters</div>
            </div>
            <div class="intel-summary-card card-unlikely">
                <div class="intel-summary-number">${cats.unlikely || 0}</div>
                <div class="intel-summary-label">Unlikely</div>
            </div>
            <div class="intel-summary-card card-opposed">
                <div class="intel-summary-number">${cats.opposed || 0}</div>
                <div class="intel-summary-label">Opposed</div>
            </div>
        `;
    }

    function renderPivotalTargets(targets) {
        if (!targets || targets.length === 0) {
            pivotalGrid.innerHTML = '<p class="empty-inline">No pivotal targets identified yet.</p>';
            return;
        }
        pivotalGrid.innerHTML = targets.map(t => `
            <div class="pivotal-card ${IntelligenceAPI.getPriorityClass(t.outreach_priority)}">
                <div class="pivotal-header">
                    <div class="pivotal-name">${esc(t.name)}</div>
                    <span class="pivotal-priority-badge ${IntelligenceAPI.getPriorityClass(t.outreach_priority)}">
                        ${IntelligenceAPI.getPriorityLabel(t.outreach_priority)} Priority
                    </span>
                </div>
                <div class="pivotal-meta">
                    <span class="badge badge-party badge-${t.party?.toLowerCase()}">${esc(t.party)}</span>
                    <span>${esc(t.state)}</span>

                </div>
                <div class="pivotal-reason">${esc(t.reason)}</div>
                <div class="pivotal-approach">
                    <strong>Recommended approach:</strong> ${esc(t.recommended_approach)}
                </div>
            </div>
        `).join('');
    }

    function renderLegislators(legislators) {
        if (!legislators || legislators.length === 0) {
            legislatorGrid.innerHTML = '<p class="empty-inline">No legislators match your filters.</p>';
            countEl.textContent = '(0)';
            return;
        }
        countEl.textContent = `(${legislators.length})`;

        // Sort: fence-sitters first, then by score descending
        const sorted = [...legislators].sort((a, b) => {
            const sA = 5;
            const sB = 5;
            const pA = (sA >= 4 && sA <= 6) ? 0 : (sA >= 7 ? 1 : 2);
            const pB = (sB >= 4 && sB <= 6) ? 0 : (sB >= 7 ? 1 : 2);
            return pA - pB || sB - sA;
        });

        legislatorGrid.innerHTML = sorted.map(leg => {
            const p = {};
            const piv = leg.pivotal || {};
            const stateName = (typeof SAFE_CONFIG !== 'undefined' && SAFE_CONFIG.STATES)
                ? (SAFE_CONFIG.STATES[leg.state] || leg.state) : leg.state;

            const flags = [];
            if (piv.is_committee_chair) flags.push('&#128081; Committee Chair');
            if (piv.is_health_committee) flags.push('&#9877; Health Committee');
            if (piv.has_science_background) flags.push('&#128300; ' + (piv.background_type || 'Science Background'));
            if (piv.is_ranking_member) flags.push('&#11088; Ranking Member');

            return `
            <div class="legislator-card">
                <div class="legislator-card-header">
                    <div class="legislator-avatar">${getInitials(leg.name)}</div>
                    <div class="legislator-info">
                        <div class="legislator-name">${esc(leg.name)}</div>
                        <div class="legislator-meta">
                            <span class="badge badge-party badge-${leg.party?.toLowerCase()}">${esc(leg.party)}</span>
                            <span>${esc(leg.office)}</span>
                            ${leg.district ? `<span>District ${esc(leg.district)}</span>` : ''}
                            <span>${esc(stateName)}</span>
                        </div>
                    </div>

                </div>

                ${flags.length > 0 ? `
                <div class="legislator-flags">
                    ${flags.map(f => `<span class="legislator-flag">${f}</span>`).join('')}
                </div>` : ''}

                ${(leg.committees || []).length > 0 ? `
                <div class="legislator-committees">
                    <span class="committees-label">Committees:</span>
                    ${leg.committees.map(c => `<span class="committee-tag">${esc(c)}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }).join('');
    }

    function renderNews(articles) {
        if (!articles || articles.length === 0) {
            newsFeed.innerHTML = '<p class="empty-inline">No recent news articles found.</p>';
            return;
        }
        newsFeed.innerHTML = articles.map(a => `
            <div class="news-article-card">
                <div class="news-article-header">
                    <a href="${esc(a.url)}" target="_blank" rel="noopener" class="news-title">${esc(a.title)}</a>
                    <span class="news-sentiment ${a.sentiment}">${a.sentiment}</span>
                </div>
                <div class="news-meta">
                    <span class="news-source">${esc(a.source)}</span>
                    <span class="news-date">${formatDate(a.date)}</span>
                </div>
                <p class="news-summary">${esc(a.summary)}</p>
                ${a.topics && a.topics.length > 0 ? `
                <div class="news-topics">
                    ${a.topics.map(t => `<span class="topic-tag">${esc(t)}</span>`).join('')}
                </div>` : ''}
            </div>
        `).join('');
    }

    function applyFilters() {
        const state = stateSelect.value;
        const party = partySelect.value;
        const category = categorySelect.value;
        const search = searchInput.value.toLowerCase().trim();

        let filtered = [...allLegislators];
        if (state) filtered = filtered.filter(l => l.state === state);
        if (party) filtered = filtered.filter(l => l.party === party);
        // Category filter removed (persuadability removed)
        if (search) {
            filtered = filtered.filter(l => {
                const text = `${l.name} ${l.state} ${l.office} ${l.party} ${(l.committees || []).join(' ')} ${l.professional_background || ''}`.toLowerCase();
                return text.includes(search);
            });
        }

        // Filter pivotal targets too
        let filteredPivotal = [...allPivotal];
        if (state) filteredPivotal = filteredPivotal.filter(t => t.state === state);
        if (party) filteredPivotal = filteredPivotal.filter(t => t.party === party);
        // Category filter removed (persuadability removed)

        // Filter news
        let filteredNews = [...allNews];
        if (state) {
            const stateIds = new Set(filtered.map(l => l.legislator_id));
            filteredNews = filteredNews.filter(a =>
                a.legislator_ids?.some(id => stateIds.has(id)) || a.legislator_ids?.length === 0
            );
        }

        renderPivotalTargets(filteredPivotal);
        renderLegislators(filtered);
        renderNews(filteredNews);
    }

    // ── Utilities ────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr;
        }
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }
});
