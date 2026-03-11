// ============================================
// SAFE Action - Pledge Directory Page
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('candidate-grid');
    const emptyState = document.getElementById('empty-state');
    const noResults = document.getElementById('no-results');
    const filterParty = document.getElementById('filter-party');
    const filterOffice = document.getElementById('filter-office');
    const filterState = document.getElementById('filter-state');
    const filterSearch = document.getElementById('filter-search');
    const toolbar = document.getElementById('directory-toolbar');
    const countEl = document.getElementById('directory-count');

    let allCandidates = [];

    init();

    async function init() {
        try {
            allCandidates = await SheetsAPI.getCandidates();

            if (allCandidates.length === 0) {
                grid.style.display = 'none';
                emptyState.style.display = '';
                return;
            }

            populateFilters(allCandidates);
            renderCandidates(allCandidates);
            enrichDirectoryWithIntelligence(allCandidates);

            // Set up filter listeners
            filterParty.addEventListener('change', applyFilters);
            filterOffice.addEventListener('change', applyFilters);
            filterState.addEventListener('change', applyFilters);
            filterSearch.addEventListener('input', debounce(applyFilters, 300));
        } catch (error) {
            console.error('Failed to load candidates:', error);
            grid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Failed to load candidates. Please try again later.</p>';
        }
    }

    function populateFilters(candidates) {
        const parties = [...new Set(candidates.map(c => c.party).filter(Boolean))].sort();
        const offices = [...new Set(candidates.map(c => c.office).filter(Boolean))].sort();
        const states = [...new Set(candidates.map(c => c.state).filter(Boolean))].sort();

        parties.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            filterParty.appendChild(opt);
        });

        offices.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o;
            opt.textContent = o;
            filterOffice.appendChild(opt);
        });

        states.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = SAFE_CONFIG.STATES[s] || s;
            filterState.appendChild(opt);
        });
    }

    function applyFilters() {
        const party = filterParty.value;
        const office = filterOffice.value;
        const state = filterState.value;
        const search = filterSearch.value.toLowerCase().trim();

        let filtered = allCandidates;

        if (party) filtered = filtered.filter(c => c.party === party);
        if (office) filtered = filtered.filter(c => c.office === office);
        if (state) filtered = filtered.filter(c => c.state === state);

        if (search) {
            filtered = filtered.filter(c => {
                const searchable = [
                    c.firstName, c.lastName, c.party, c.office,
                    c.position, c.district, c.city,
                    c.state ? (SAFE_CONFIG.STATES[c.state] || c.state) : ''
                ].join(' ').toLowerCase();
                return searchable.includes(search);
            });
        }

        renderCandidates(filtered);
    }

    function renderCandidates(candidates) {
        grid.style.display = '';
        emptyState.style.display = 'none';
        noResults.style.display = 'none';

        // Update count
        if (toolbar && countEl) {
            toolbar.style.display = '';
            countEl.textContent = `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}`;
        }

        if (candidates.length === 0) {
            grid.style.display = 'none';
            if (toolbar) toolbar.style.display = 'none';
            if (allCandidates.length === 0) {
                emptyState.style.display = '';
            } else {
                noResults.style.display = '';
            }
            return;
        }

        grid.innerHTML = candidates.map(candidate => {
            const initials = (candidate.firstName[0] || '') + (candidate.lastName[0] || '');
            const partyClass = candidate.party ? candidate.party.toLowerCase().replace(/\s+/g, '-') : '';
            const stateName = candidate.state ? (SAFE_CONFIG.STATES[candidate.state] || candidate.state) : '';
            const location = [candidate.district, candidate.city, stateName].filter(Boolean).join(' \u00B7 ');
            const avatarHtml = candidate.photoUrl
                ? `<img src="${escapeHtml(candidate.photoUrl)}" alt="${escapeHtml(candidate.firstName)} ${escapeHtml(candidate.lastName)}" class="candidate-avatar-img">`
                : `<div class="candidate-avatar">${escapeHtml(initials)}</div>`;

            return `
                <a href="candidate.html?id=${encodeURIComponent(candidate.id)}" class="candidate-card">
                    <div class="card-top">
                        ${avatarHtml}
                        <div>
                            <div class="card-name">${escapeHtml(candidate.firstName)} ${escapeHtml(candidate.lastName)}</div>
                            <div class="card-position">${escapeHtml(candidate.position)}${location ? ' \u00B7 ' + escapeHtml(location) : ''}</div>
                        </div>
                    </div>
                    <div class="card-details">
                        <span class="badge badge-party ${partyClass}">${escapeHtml(candidate.party)}</span>
                        <span class="badge badge-office">${escapeHtml(candidate.office)}</span>
                        ${stateName ? `<span class="badge badge-state">${escapeHtml(stateName)}</span>` : ''}
                    </div>
                    <div class="card-vaccine">
                        <span class="card-vaccine-label">Vaccines:</span>
                        <span class="card-vaccine-value">${escapeHtml(candidate.vaccineSupport)}</span>
                    </div>
                    <span class="card-arrow">&rarr;</span>
                </a>
            `;
        }).join('');
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // ── Intelligence Enrichment ──────────────────
    async function enrichDirectoryWithIntelligence(candidates) {
        if (typeof IntelligenceAPI === 'undefined') return;
        const available = await IntelligenceAPI.isAvailable();
        if (!available) return;

        const legislators = await IntelligenceAPI.getLegislators();
        if (legislators.length === 0) return;

        const cards = grid.querySelectorAll('.candidate-card');
        candidates.forEach((candidate, i) => {
            const cardEl = cards[i];
            if (!cardEl) return;

            // Try to match candidate to a legislator by name
            const fullName = `${candidate.firstName} ${candidate.lastName}`.toLowerCase();
            const match = legislators.find(leg => {
                const legName = leg.name.toLowerCase().replace(/^(rep\.|sen\.|dr\.)\s*/i, '');
                return legName.includes(fullName) || fullName.includes(legName);
            });

        });
    }
});
