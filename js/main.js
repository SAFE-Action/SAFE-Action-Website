// ============================================
// SAFE Action - Main Page (Impact + Victory + Ticker)
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initImpactCounters();
    initVictoryBoard();
    initPledgeTicker();

    // --- Impact Counters ---
    function initImpactCounters() {
        // Load stored action counts (localStorage for demo, Firebase in production)
        const stored = getActionCounts();
        updateCounterDisplay('impact-actions', stored.total);
        updateCounterDisplay('impact-emails', stored.emails);
        updateCounterDisplay('impact-calls', stored.calls);

        // Animate counters when they scroll into view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounters();
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        const impactSection = document.querySelector('.impact-section');
        if (impactSection) observer.observe(impactSection);
    }

    function animateCounters() {
        document.querySelectorAll('.counter').forEach(counter => {
            const target = parseInt(counter.textContent.replace(/,/g, ''));
            const duration = 1500;
            const start = 0;
            const startTime = performance.now();

            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                const current = Math.floor(start + (target - start) * eased);
                counter.textContent = current.toLocaleString();
                if (progress < 1) requestAnimationFrame(update);
            }

            requestAnimationFrame(update);
        });
    }

    function updateCounterDisplay(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) {
            const counter = el.querySelector('.counter');
            if (counter) counter.textContent = value.toLocaleString();
        }
    }

    // --- Action Tracking ---
    // Stored in localStorage for demo; in production use Firebase
    window.SAFE_ACTIONS = {
        trackAction: function(type) {
            const counts = getActionCounts();
            counts.total++;
            if (type === 'email') counts.emails++;
            if (type === 'call') counts.calls++;
            localStorage.setItem('safe_action_counts', JSON.stringify(counts));
            return counts;
        }
    };

    function getActionCounts() {
        const BASE_ACTIONS = 0;
        const BASE_EMAILS = 0;
        const BASE_CALLS = 0;

        try {
            const stored = JSON.parse(localStorage.getItem('safe_action_counts'));
            if (stored && stored.total >= BASE_ACTIONS) return stored;
        } catch (e) {}

        return { total: BASE_ACTIONS, emails: BASE_EMAILS, calls: BASE_CALLS };
    }

    // --- Victory Board ---
    async function initVictoryBoard() {
        const victoryGrid = document.getElementById('victory-grid');
        const victoryEmpty = document.getElementById('victory-empty');
        if (!victoryGrid) return;

        try {
            const victories = await LegislationAPI.getVictories();
            if (victories.length === 0) {
                victoryGrid.style.display = 'none';
                victoryEmpty.style.display = '';
                return;
            }

            victoryGrid.innerHTML = victories.map(bill => {
                const statusLabel = bill.status === 'Vetoed' ? 'VETOED' :
                    bill.status === 'Withdrawn' ? 'WITHDRAWN' :
                    bill.status === 'Tabled' ? 'TABLED' : 'DEFEATED';
                const actionCount = bill.actionsTaken || 0;

                return `
                    <div class="victory-card">
                        <div class="victory-badge">${statusLabel}</div>
                        <div class="victory-bill-number">${escapeHtml(bill.billNumber)}</div>
                        <div class="victory-bill-title">${escapeHtml(bill.title)}</div>
                        <div class="victory-state">${escapeHtml(SAFE_CONFIG.STATES[bill.state] || bill.state)}</div>
                        <div class="victory-summary">${escapeHtml(bill.summary ? (bill.summary.length > 120 ? bill.summary.substring(0, 120) + '...' : bill.summary) : '')}</div>
                        ${actionCount > 0 ? `
                            <div class="victory-actions-taken">
                                <span class="victory-action-icon">&#9993;</span>
                                <strong>${actionCount}</strong> citizen actions taken against this bill
                            </div>
                        ` : ''}
                        <div class="victory-date">Stopped: ${escapeHtml(bill.lastActionDate || '')}</div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading victories:', error);
            victoryGrid.innerHTML = '';
        }
    }

    // --- Pledge Ticker ---
    async function initPledgeTicker() {
        const tickerTrack = document.getElementById('pledge-ticker-track');
        if (!tickerTrack) return;

        try {
            const candidates = await SheetsAPI.getCandidates();
            if (candidates.length === 0) {
                tickerTrack.closest('.pledge-ticker-section').style.display = 'none';
                return;
            }

            // Sort by timestamp (most recent first), cap at 20
            const sorted = [...candidates]
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 20);

            const itemsHtml = sorted.map(c => {
                const stateName = c.state ? (SAFE_CONFIG.STATES[c.state] || c.state) : '';
                return `
                    <a href="candidate.html?id=${encodeURIComponent(c.id)}" class="pledge-ticker-item">
                        <span class="ticker-name">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</span>
                        <span class="ticker-sep">&middot;</span>
                        <span class="ticker-detail">${escapeHtml(c.party)}</span>
                        <span class="ticker-sep">&middot;</span>
                        <span class="ticker-detail">${escapeHtml(c.office)}</span>
                        ${stateName ? `<span class="ticker-sep">&middot;</span><span class="ticker-detail">${escapeHtml(stateName)}</span>` : ''}
                    </a>
                `;
            }).join('');

            // Duplicate for seamless loop
            tickerTrack.innerHTML = `
                <div class="pledge-ticker-content">${itemsHtml}</div>
                <div class="pledge-ticker-content" aria-hidden="true">${itemsHtml}</div>
            `;
        } catch (error) {
            console.error('Error loading pledge ticker:', error);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
