// SAFE Action - Public Bill Feed
(function() {
    var bills = [];
    var filtered = [];

    function init() {
        fetch('data/bills.json').then(function(r) { return r.json(); }).then(function(data) {
            bills = (data.bills || []).filter(function(b) {
                return b.billType === 'anti' || b.billType === 'pro';
            }).sort(function(a, b) {
                return (b.lastActionDate || '').localeCompare(a.lastActionDate || '');
            });
            populateFilters();
            applyFilters();
        }).catch(function(e) { console.error('Feed load error:', e); });

        document.getElementById('feed-state').addEventListener('change', applyFilters);
        document.getElementById('feed-type').addEventListener('change', applyFilters);
        document.getElementById('feed-search').addEventListener('input', applyFilters);
    }

    function populateFilters() {
        var states = {};
        bills.forEach(function(b) { if (b.state) states[b.state] = true; });
        var sel = document.getElementById('feed-state');
        Object.keys(states).sort().forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            sel.appendChild(opt);
        });
    }

    function applyFilters() {
        var sf = document.getElementById('feed-state').value;
        var tf = document.getElementById('feed-type').value;
        var search = document.getElementById('feed-search').value.toLowerCase();
        filtered = bills.filter(function(b) {
            if (sf && b.state !== sf) return false;
            if (tf && b.billType !== tf) return false;
            if (search && ((b.title || '') + ' ' + (b.billNumber || '')).toLowerCase().indexOf(search) === -1) return false;
            return true;
        });
        renderFeed();
    }

    function renderFeed() {
        var container = document.getElementById('feed-list');
        while (container.firstChild) container.removeChild(container.firstChild);
        var countEl = document.getElementById('feed-count');
        countEl.textContent = filtered.length + ' bill' + (filtered.length !== 1 ? 's' : '');

        if (filtered.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'feed-empty';
            empty.textContent = 'No bills match your filters.';
            container.appendChild(empty);
            return;
        }

        filtered.forEach(function(bill) {
            var card = document.createElement('div');
            card.className = 'feed-card';

            var hdr = document.createElement('div');
            hdr.className = 'feed-card-header';

            var badge = document.createElement('span');
            badge.className = 'feed-badge feed-badge-' + bill.billType;
            badge.textContent = bill.billType === 'anti' ? 'ANTI-SCIENCE' : 'PRO-SCIENCE';
            hdr.appendChild(badge);

            var state = document.createElement('span');
            state.className = 'feed-state';
            state.textContent = bill.state;
            hdr.appendChild(state);

            if (bill.lastActionDate) {
                var date = document.createElement('span');
                date.className = 'feed-date';
                date.textContent = bill.lastActionDate;
                hdr.appendChild(date);
            }
            card.appendChild(hdr);

            var title = document.createElement('h3');
            title.className = 'feed-card-title';
            if (bill.sourceUrl) {
                var a = document.createElement('a');
                a.href = bill.sourceUrl;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = (bill.billNumber ? bill.billNumber + ': ' : '') + (bill.title || 'Untitled');
                title.appendChild(a);
            } else {
                title.textContent = (bill.billNumber ? bill.billNumber + ': ' : '') + (bill.title || 'Untitled');
            }
            card.appendChild(title);

            if (bill.summary) {
                var sum = document.createElement('p');
                sum.className = 'feed-summary';
                sum.textContent = bill.summary.length > 200 ? bill.summary.substring(0, 200) + '...' : bill.summary;
                card.appendChild(sum);
            }

            var foot = document.createElement('div');
            foot.className = 'feed-card-footer';
            if (bill.category) {
                var cat = document.createElement('span');
                cat.className = 'feed-category';
                cat.textContent = bill.category;
                foot.appendChild(cat);
            }
            if (bill.status) {
                var st = document.createElement('span');
                st.className = 'feed-status';
                st.textContent = bill.status;
                foot.appendChild(st);
            }
            card.appendChild(foot);

            container.appendChild(card);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
