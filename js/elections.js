// ============================================
// SAFE Action - 2026 Elections Page
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('seat-grid');
    const tableWrap = document.getElementById('seat-table-wrap');
    const tableBody = document.getElementById('seat-table-body');
    const emptyState = document.getElementById('election-empty');
    const toolbar = document.getElementById('election-toolbar');
    const countEl = document.getElementById('election-count');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const loadMoreHint = document.getElementById('load-more-hint');
    const btnCardView = document.getElementById('btn-card-view');
    const btnTableView = document.getElementById('btn-table-view');

    const filterState = document.getElementById('elect-filter-state');
    const filterBody = document.getElementById('elect-filter-body');
    const filterParty = document.getElementById('elect-filter-party');
    const filterSearch = document.getElementById('elect-filter-search');

    let allSeats = [];
    let filteredSeats = [];
    let currentLevel = 'federal';
    let currentView = 'card';
    let displayedCount = 0;
    const PAGE_SIZE = 60;

    init();

    async function init() {
        try {
            const resp = await fetch('data/seats.json');
            if (!resp.ok) throw new Error('Failed to load seats.json');
            const data = await resp.json();
            allSeats = data.seats || [];

            // Populate state filter
            populateStateFilter();

            // Set up stats
            updateStats(data);

            // Set up sub-nav level switching
            setupSubNav();

            // Set up filters
            filterState.addEventListener('change', applyFilters);
            filterBody.addEventListener('change', applyFilters);
            filterParty.addEventListener('change', applyFilters);
            filterSearch.addEventListener('input', debounce(applyFilters, 300));

            // View toggle
            btnCardView.addEventListener('click', () => switchView('card'));
            btnTableView.addEventListener('click', () => switchView('table'));

            // Load more
            loadMoreBtn.addEventListener('click', loadMore);

            // Initial render
            applyFilters();

        } catch (err) {
            console.error('Failed to load election data:', err);
            grid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Failed to load election data. Please try again later.</p>';
        }
    }

    function populateStateFilter() {
        const states = [...new Set(allSeats.map(s => s.state))].sort();
        states.forEach(code => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = (SAFE_CONFIG.STATES[code] || code) + ` (${code})`;
            filterState.appendChild(opt);
        });
    }

    function updateStats(data) {
        const stats = data.population_stats || {};
        const summary = data.summary || {};

        animateCounter('stat-total-seats', data.total_seats || allSeats.length);
        animateCounter('stat-candidates', stats.total_candidates_filed || 0);
        animateCounter('stat-incumbents', stats.seats_with_incumbent || 0);

        const stateCount = new Set(allSeats.map(s => s.state)).size;
        animateCounter('stat-states', stateCount);
    }

    function animateCounter(id, target) {
        const el = document.getElementById(id);
        if (!el || !target) { if (el) el.textContent = target; return; }
        const duration = 1200;
        const start = performance.now();
        function tick(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(target * eased).toLocaleString();
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function setupSubNav() {
        document.querySelectorAll('.sub-nav-link[data-level]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.sub-nav-link[data-level]').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                currentLevel = link.dataset.level;

                // Auto-set body filter based on level
                if (currentLevel === 'federal') {
                    filterBody.value = '';
                } else if (currentLevel === 'governor') {
                    filterBody.value = 'Governor';
                } else if (currentLevel === 'state') {
                    filterBody.value = '';
                } else {
                    filterBody.value = '';
                }

                applyFilters();
            });
        });
    }

    function applyFilters() {
        const stateVal = filterState.value;
        const bodyVal = filterBody.value;
        const partyVal = filterParty.value;
        const search = filterSearch.value.toLowerCase().trim();

        filteredSeats = allSeats.filter(seat => {
            // Level filter
            if (currentLevel === 'federal') {
                if (seat.level !== 'Federal') return false;
            } else if (currentLevel === 'state') {
                if (seat.body !== 'State House' && seat.body !== 'State Senate') return false;
            } else if (currentLevel === 'governor') {
                if (seat.body !== 'Governor') return false;
            }
            // All = no level filter

            if (stateVal && seat.state !== stateVal) return false;
            if (bodyVal && seat.body !== bodyVal) return false;

            if (partyVal) {
                const inc = seat.incumbent;
                if (!inc || inc.party !== partyVal) return false;
            }

            if (search) {
                const searchable = [
                    seat.seatId,
                    seat.state,
                    SAFE_CONFIG.STATES[seat.state] || '',
                    seat.body,
                    seat.district,
                    seat.incumbent ? seat.incumbent.name : '',
                    ...(seat.candidates || []).map(c => c.name)
                ].join(' ').toLowerCase();
                if (!searchable.includes(search)) return false;
            }

            return true;
        });

        // Sort: seats with candidates first, then by state/district
        filteredSeats.sort((a, b) => {
            // Prioritize seats with candidates
            const aCands = (a.candidates || []).length;
            const bCands = (b.candidates || []).length;
            if (aCands > 0 && bCands === 0) return -1;
            if (bCands > 0 && aCands === 0) return 1;

            // Then by state
            if (a.state !== b.state) return a.state.localeCompare(b.state);
            // Then by body order
            const bodyOrder = { 'US Senate': 0, 'US House': 1, 'Governor': 2, 'State Senate': 3, 'State House': 4 };
            const aOrder = bodyOrder[a.body] ?? 5;
            const bOrder = bodyOrder[b.body] ?? 5;
            if (aOrder !== bOrder) return aOrder - bOrder;
            // Then by district
            return (a.district || '').localeCompare(b.district || '', undefined, { numeric: true });
        });

        displayedCount = 0;
        renderSeats();
    }

    function renderSeats() {
        if (filteredSeats.length === 0) {
            grid.style.display = 'none';
            tableWrap.style.display = 'none';
            emptyState.style.display = '';
            loadMoreWrap.style.display = 'none';
            if (countEl) countEl.textContent = '0 seats';
            return;
        }

        emptyState.style.display = 'none';

        const batch = filteredSeats.slice(displayedCount, displayedCount + PAGE_SIZE);
        displayedCount += batch.length;

        if (countEl) {
            countEl.textContent = `Showing ${displayedCount.toLocaleString()} of ${filteredSeats.length.toLocaleString()} seats`;
        }

        if (currentView === 'card') {
            grid.style.display = '';
            tableWrap.style.display = 'none';

            if (displayedCount <= batch.length) {
                // First page, replace content
                grid.innerHTML = batch.map(seatCard).join('');
            } else {
                // Appending
                grid.insertAdjacentHTML('beforeend', batch.map(seatCard).join(''));
            }
        } else {
            grid.style.display = 'none';
            tableWrap.style.display = '';

            if (displayedCount <= batch.length) {
                tableBody.innerHTML = batch.map(seatRow).join('');
            } else {
                tableBody.insertAdjacentHTML('beforeend', batch.map(seatRow).join(''));
            }
        }

        // Load more button
        if (displayedCount < filteredSeats.length) {
            loadMoreWrap.style.display = '';
            const remaining = filteredSeats.length - displayedCount;
            loadMoreHint.textContent = `${remaining.toLocaleString()} more seats`;
        } else {
            loadMoreWrap.style.display = 'none';
        }
    }

    function loadMore() {
        renderSeats();
    }

    function switchView(view) {
        currentView = view;
        btnCardView.classList.toggle('active', view === 'card');
        btnTableView.classList.toggle('active', view === 'table');
        displayedCount = 0;
        renderSeats();
    }

    // ── Card Rendering ──────────────────────────────────────────────

    function seatCard(seat) {
        const inc = seat.incumbent;
        const candidates = seat.candidates || [];
        const stateName = SAFE_CONFIG.STATES[seat.state] || seat.state;
        const partyClass = inc ? getPartyClass(inc.party) : '';
        const partyLabel = inc ? getPartyLabel(inc.party) : '';

        // Seat label
        let seatLabel = seat.body;
        if (seat.body === 'US House') {
            seatLabel = `${stateName} District ${seat.district}`;
        } else if (seat.body === 'US Senate') {
            seatLabel = `${stateName} - US Senate`;
        } else if (seat.body === 'Governor') {
            seatLabel = `${stateName} Governor`;
        } else if (seat.body === 'State House' || seat.body === 'State Senate') {
            seatLabel = `${seat.body} District ${seat.district}`;
        }

        // Incumbent section
        let incHtml = '';
        if (inc && inc.name) {
            const photoHtml = inc.photoUrl
                ? `<img src="${esc(inc.photoUrl)}" alt="${esc(inc.name)}" class="seat-incumbent-photo">`
                : `<div class="candidate-avatar">${getInitials(inc.name)}</div>`;

            incHtml = `
                <div class="seat-incumbent">
                    ${photoHtml}
                    <div>
                        <div class="seat-incumbent-name">${esc(inc.name)}</div>
                        <span class="badge badge-party ${partyClass}">${esc(partyLabel)}</span>
                        <span class="badge badge-office">Incumbent</span>
                    </div>
                </div>
            `;
        } else {
            incHtml = `<div class="seat-no-incumbent">No incumbent data</div>`;
        }

        // Candidates section
        let candHtml = '';
        if (candidates.length > 0) {
            const shown = candidates.slice(0, 5);
            candHtml = `
                <div class="seat-candidates">
                    <div class="seat-candidates-label">${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} filed</div>
                    <div class="seat-candidates-list">
                        ${shown.map(c => `
                            <span class="seat-candidate-chip ${getPartyClass(c.party)}">
                                ${esc(c.name)} <span class="chip-party">(${esc(c.party)})</span>
                            </span>
                        `).join('')}
                        ${candidates.length > 5 ? `<span class="seat-candidate-chip more">+${candidates.length - 5} more</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            candHtml = `<div class="seat-no-candidates">No candidates filed yet</div>`;
        }

        // Body badge
        const bodyClass = seat.body.toLowerCase().replace(/\s+/g, '-');

        return `
            <div class="candidate-card seat-card" data-seat-id="${esc(seat.seatId)}">
                <div class="seat-card-header">
                    <span class="badge badge-body badge-${bodyClass}">${esc(seat.body)}</span>
                    <span class="badge badge-state">${esc(seat.state)}</span>
                </div>
                <div class="seat-card-title">${esc(seatLabel)}</div>
                ${incHtml}
                ${candHtml}
            </div>
        `;
    }

    // ── Table Rendering ─────────────────────────────────────────────

    function seatRow(seat) {
        const inc = seat.incumbent;
        const candidates = seat.candidates || [];
        const stateName = SAFE_CONFIG.STATES[seat.state] || seat.state;

        let seatLabel = seat.seatId;
        if (seat.body === 'US House') seatLabel = `District ${seat.district}`;
        else if (seat.body === 'US Senate') seatLabel = 'Senate';
        else if (seat.body === 'Governor') seatLabel = 'Governor';
        else seatLabel = `Dist. ${seat.district}`;

        const incName = inc ? esc(inc.name) : '<span class="text-muted">-</span>';
        const incParty = inc ? `<span class="badge badge-party ${getPartyClass(inc.party)}" style="font-size:0.7rem;padding:2px 8px;">${esc(inc.party)}</span>` : '-';

        const candCount = candidates.length > 0
            ? `<strong>${candidates.length}</strong>`
            : '<span class="text-muted">0</span>';

        return `
            <tr>
                <td>${esc(seatLabel)}</td>
                <td>${esc(stateName)}</td>
                <td><span class="badge badge-body badge-${seat.body.toLowerCase().replace(/\s+/g, '-')}" style="font-size:0.7rem;padding:2px 8px;">${esc(seat.body)}</span></td>
                <td>${incName}</td>
                <td>${incParty}</td>
                <td>${candCount}</td>
            </tr>
        `;
    }

    // ── Helpers ──────────────────────────────────────────────────────

    function getPartyClass(party) {
        const map = { 'R': 'republican', 'D': 'democrat', 'I': 'independent', 'L': 'libertarian', 'G': 'green' };
        return map[party] || '';
    }

    function getPartyLabel(party) {
        const map = { 'R': 'Republican', 'D': 'Democrat', 'I': 'Independent', 'L': 'Libertarian', 'G': 'Green' };
        return map[party] || party || '?';
    }

    function getInitials(name) {
        if (!name) return '?';
        const parts = name.split(' ').filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return parts[0][0].toUpperCase();
    }

    function esc(str) {
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
});
