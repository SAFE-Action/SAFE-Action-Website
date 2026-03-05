// ============================================
// SAFE Action - Bill Updates News Feed
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const feedTimeline = document.getElementById('feed-timeline');
    const feedEmpty = document.getElementById('feed-empty');
    const feedState = document.getElementById('feed-state');
    const feedType = document.getElementById('feed-type');
    const feedSearch = document.getElementById('feed-search');
    const feedCopyUrl = document.getElementById('feed-copy-url');
    const feedCopySuccess = document.getElementById('feed-copy-success');

    let allUpdates = [];

    init();

    async function init() {
        // Populate state dropdown
        populateStates();

        try {
            const bills = await LegislationAPI.getLegislation('ALL');
            allUpdates = buildUpdateFeed(bills);
            renderFeed(allUpdates);

            // Filters
            feedState.addEventListener('change', applyFilters);
            feedType.addEventListener('change', applyFilters);
            feedSearch.addEventListener('input', debounce(applyFilters, 300));

            // Copy URL
            feedCopyUrl.addEventListener('click', () => {
                const url = window.location.href.split('?')[0];
                copyToClipboard(url);
                feedCopySuccess.classList.add('show');
                setTimeout(() => feedCopySuccess.classList.remove('show'), 2000);
            });
        } catch (error) {
            console.error('Failed to load updates:', error);
            feedTimeline.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Failed to load updates. Please try again later.</p>';
        }
    }

    function populateStates() {
        if (!SAFE_CONFIG || !SAFE_CONFIG.STATES) return;
        Object.entries(SAFE_CONFIG.STATES).forEach(([code, name]) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            feedState.appendChild(opt);
        });
    }

    function buildUpdateFeed(bills) {
        const updates = [];

        bills.forEach(bill => {
            // Main update: last action
            if (bill.lastAction && bill.lastActionDate) {
                updates.push({
                    date: bill.lastActionDate,
                    billId: bill.billId,
                    billNumber: bill.billNumber,
                    title: bill.title,
                    state: bill.state,
                    stateName: SAFE_CONFIG.STATES[bill.state] || bill.state,
                    level: bill.level,
                    billType: bill.billType,
                    status: bill.status,
                    impact: bill.impact,
                    action: bill.lastAction,
                    category: bill.category,
                    summary: bill.summary,
                    stoppedWithAction: bill.stoppedWithAction,
                    actionsTaken: bill.actionsTaken || 0
                });
            }

            // If the bill was added on a different date than its last action, add an "introduced" entry
            if (bill.dateAdded && bill.dateAdded !== bill.lastActionDate) {
                updates.push({
                    date: bill.dateAdded,
                    billId: bill.billId,
                    billNumber: bill.billNumber,
                    title: bill.title,
                    state: bill.state,
                    stateName: SAFE_CONFIG.STATES[bill.state] || bill.state,
                    level: bill.level,
                    billType: bill.billType,
                    status: 'Added to Tracker',
                    impact: bill.impact,
                    action: 'Bill added to SAFE Action tracker for monitoring.',
                    category: bill.category,
                    summary: bill.summary,
                    isAddedEntry: true
                });
            }
        });

        // Sort by date, newest first
        updates.sort((a, b) => new Date(b.date) - new Date(a.date));
        return updates;
    }

    function applyFilters() {
        const state = feedState.value;
        const type = feedType.value;
        const search = feedSearch.value.toLowerCase().trim();

        let filtered = allUpdates;

        if (state) {
            filtered = filtered.filter(u => u.state === state);
        }
        if (type) {
            filtered = filtered.filter(u => u.billType === type);
        }
        if (search) {
            filtered = filtered.filter(u => {
                const searchable = [
                    u.billNumber, u.title, u.action, u.stateName, u.category
                ].join(' ').toLowerCase();
                return searchable.includes(search);
            });
        }

        renderFeed(filtered);
    }

    function renderFeed(updates) {
        feedEmpty.style.display = 'none';
        feedTimeline.style.display = '';

        if (updates.length === 0) {
            feedTimeline.style.display = 'none';
            feedEmpty.style.display = '';
            return;
        }

        // Group by date
        const grouped = {};
        updates.forEach(u => {
            const dateKey = u.date;
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(u);
        });

        const dateKeys = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

        feedTimeline.innerHTML = dateKeys.map(dateKey => {
            const dateLabel = formatDate(dateKey);
            const items = grouped[dateKey];

            return `
                <div class="feed-date-group">
                    <div class="feed-date-header">
                        <span class="feed-date-dot"></span>
                        <span class="feed-date-label">${escapeHtml(dateLabel)}</span>
                    </div>
                    ${items.map(item => renderFeedItem(item)).join('')}
                </div>
            `;
        }).join('');
    }

    function renderFeedItem(item) {
        const typeClass = item.billType === 'pro' ? 'feed-type-pro' : 'feed-type-anti';
        const typeLabel = item.billType === 'pro' ? 'PRO-SCIENCE' : 'ANTI-SCIENCE';
        const impactClass = item.impact === 'High' ? 'impact-high' : item.impact === 'Medium' ? 'impact-medium' : 'impact-low';
        const isVictory = item.stoppedWithAction;
        const statusIcon = getStatusIcon(item.status);

        return `
            <div class="feed-item ${isVictory ? 'feed-item-victory' : ''}">
                <div class="feed-item-line"></div>
                <div class="feed-item-content">
                    <div class="feed-item-header">
                        <span class="feed-item-bill">${escapeHtml(item.billNumber)}</span>
                        <span class="badge ${typeClass}">${typeLabel}</span>
                        <span class="badge badge-state">${escapeHtml(item.stateName)}</span>
                        <span class="badge ${impactClass}">${escapeHtml(item.impact)}</span>
                    </div>
                    <h3 class="feed-item-title">
                        <a href="action.html?id=${encodeURIComponent(item.billId)}">${escapeHtml(item.title)}</a>
                    </h3>
                    <div class="feed-item-action">
                        <span class="feed-status-icon">${statusIcon}</span>
                        <span class="feed-item-status">${escapeHtml(item.status)}</span>
                        <span class="feed-item-action-text">${escapeHtml(item.action)}</span>
                    </div>
                    <div class="feed-item-meta">
                        <span class="feed-item-category">${escapeHtml(item.category)}</span>
                        <span class="feed-item-level">${escapeHtml(item.level)}</span>
                        ${isVictory ? `<span class="feed-item-victory-badge">&#127942; Bill Stopped &mdash; ${item.actionsTaken} citizen actions</span>` : ''}
                    </div>
                    <div class="feed-item-actions">
                        <a href="action.html?id=${encodeURIComponent(item.billId)}" class="feed-action-link">View Details &rarr;</a>
                        <button class="feed-share-btn" onclick="shareFeedItem('${escapeHtml(item.billNumber)}', '${escapeHtml(item.title)}')">Share</button>
                    </div>
                </div>
            </div>
        `;
    }

    function getStatusIcon(status) {
        const icons = {
            'Introduced': '&#128220;',
            'In Committee': '&#128203;',
            'Passed Committee': '&#9989;',
            'Floor Vote Scheduled': '&#128197;',
            'Passed One Chamber': '&#127919;',
            'Sent to Governor': '&#128221;',
            'Signed into Law': '&#9888;',
            'Vetoed': '&#10060;',
            'Died in Committee': '&#128683;',
            'Tabled': '&#128683;',
            'Withdrawn': '&#128683;',
            'Added to Tracker': '&#128270;'
        };
        return icons[status] || '&#128196;';
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr + 'T12:00:00');
        const now = new Date();
        const diff = Math.floor((now - date) / (1000 * 60 * 60 * 24));

        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return `${diff} days ago`;

        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
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

    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }
});

// Global share function
function shareFeedItem(billNumber, title) {
    const text = `${billNumber}: ${title} - Track this bill on SAFE Action`;
    const url = window.location.href;

    if (navigator.share) {
        navigator.share({ title: `SAFE Action - ${billNumber}`, text, url });
    } else {
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
        window.open(tweetUrl, '_blank');
    }
}
