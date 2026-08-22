// ============================================
// SAFE Action - Live Tracker command center wiring.
// Every number on this page is computed from data/bills.json at load.
// The analysis (stats, cartogram, ranked sidebar, topic chips, stage
// pipeline) doubles as the filter UI: a click sets the bb-* controls in
// the filter bar and dispatches one 'change' event so BillBrowser
// (js/my-reps-page.js) reloads its own list. This file never renders
// into BillBrowser's elements; it only reads #bb-count to mirror the
// filtered count into the stats band.
// ============================================
(function () {
    'use strict';

    var STATE_NAMES = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', US:'US Congress' };

    // 11-column US tile-grid cartogram positions [col, row] (same as js/home.js)
    var POS = { AK:[1,1], ME:[11,1], VT:[10,2], NH:[11,2],
        WA:[1,3], ID:[2,3], MT:[3,3], ND:[4,3], MN:[5,3], WI:[6,3], MI:[7,3], NY:[9,3], MA:[10,3], RI:[11,3],
        OR:[1,4], NV:[2,4], WY:[3,4], SD:[4,4], IA:[5,4], IL:[6,4], IN:[7,4], OH:[8,4], PA:[9,4], NJ:[10,4], CT:[11,4],
        CA:[1,5], UT:[2,5], CO:[3,5], NE:[4,5], MO:[5,5], KY:[6,5], WV:[7,5], VA:[8,5], MD:[9,5], DE:[10,5],
        AZ:[2,6], NM:[3,6], KS:[4,6], AR:[5,6], TN:[6,6], NC:[7,6], SC:[8,6], DC:[9,6],
        OK:[4,7], LA:[5,7], MS:[6,7], AL:[7,7], GA:[8,7],
        HI:[1,8], TX:[4,8], FL:[9,8] };

    var STATUS_ORDER = ['Pre-filed','Introduced','In Committee','Passed Committee','Floor Vote Scheduled','Passed One Chamber','In Conference','Passed Both Chambers','Sent to Governor'];
    // govinfo emits chamber-specific federal statuses; rank them as one chamber passed.
    var STATUS_ALIAS = { 'Passed Senate': 'Passed One Chamber', 'Passed House': 'Passed One Chamber' };

    // Stage pipeline, in process order. Values double as #bb-status option values.
    var STAGES = ['Pre-filed','Introduced','In Committee','Passed Committee','Passed One Chamber','Passed Both Chambers','Signed into Law'];

    // Same labels BillBrowser uses on its cards, so chips and cards agree.
    var CAT_LABELS = {
        'vaccine-exemption': 'Vaccine Exemptions',
        'vaccine-mandate': 'Vaccine Mandates',
        'medical-freedom': 'Medical Freedom',
        'informed-consent': 'Informed Consent',
        'vaccine-discrimination': 'Vaccine Discrimination',
        'mRNA-reclassification': 'mRNA Reclassification',
        'vaccine-injury': 'Vaccine Injury',
        'raw-milk': 'Raw Milk',
        'fluoride': 'Fluoride',
        'geoengineering': 'Geoengineering',
        'public-health': 'Public Health'
    };

    var SYNC_IDS = ['bb-state', 'bb-stance', 'bb-status', 'bb-category'];
    var ALL_IDS = ['bb-state', 'bb-stance', 'bb-status', 'bb-impact', 'bb-category', 'bb-search'];

    // ---------- small DOM helpers (no innerHTML anywhere) ----------
    function $(id) { return document.getElementById(id); }
    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function fmt(n) { return Number(n).toLocaleString(); }
    function bucket(n) { return n >= 13 ? 'b4' : n >= 7 ? 'b3' : n >= 3 ? 'b2' : n >= 1 ? 'b1' : 'b0'; }
    function dateLabel(iso) {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }).toUpperCase();
    }
    function make(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = text;
        return e;
    }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function each(sel, fn) {
        var list = document.querySelectorAll(sel);
        for (var i = 0; i < list.length; i++) fn(list[i]);
    }
    function setActive(node, on) {
        if (!node) return;
        if (on) node.classList.add('active'); else node.classList.remove('active');
        if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function val(id) { var e = $(id); return e ? e.value : ''; }
    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    // ---------- filter bar bridge ----------

    // A <select> silently refuses a value it has no <option> for. BillBrowser
    // ships the site taxonomy; federal bills carry govinfo subject names, so
    // add any missing value before a chip can point at it.
    function ensureOption(sel, value, label) {
        if (!sel || !value) return;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === value) return;
        }
        var opt = make('option', null, label || value);
        opt.value = value;
        sel.appendChild(opt);
    }

    function dispatchChange(target) {
        var ev;
        try {
            ev = new Event('change', { bubbles: true });
        } catch (e) {
            ev = document.createEvent('Event');
            ev.initEvent('change', true, true);
        }
        target.dispatchEvent(ev);
    }

    // BillBrowser ignores a change that lands while a load is in flight, so
    // wait for the current load to settle (bounded) before firing.
    function fireChange(target, tries) {
        var bb = window.BillBrowser;
        tries = tries || 0;
        if (bb && bb._loading && tries < 50) {
            setTimeout(function () { fireChange(target, tries + 1); }, 100);
            return;
        }
        dispatchChange(target);
    }

    // Set several bb-* controls, then fire ONE change so BillBrowser reloads
    // once with every value in place.
    function applyFilters(map, scroll) {
        var first = null;
        Object.keys(map).forEach(function (id) {
            var e = $(id);
            if (!e) return;
            e.value = map[id];
            if (!first) first = e;
        });
        if (first) fireChange(first);
        syncActive();
        if (scroll) jumpToList();
    }

    // Jump (not glide) to the list. BillBrowser empties and refills its grid
    // during the reload, which cancels an in-flight smooth scroll, and the
    // scroll-behavior on <html> would otherwise make this one glide.
    function jumpToList() {
        var b = $('browse-bills');
        if (!b) return;
        var root = document.documentElement;
        var prev = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        b.scrollIntoView();
        root.style.scrollBehavior = prev;
    }

    // Click again on something already selected to deselect it.
    function toggleFilters(map, scroll) {
        var allSet = Object.keys(map).every(function (id) { return val(id) === map[id]; });
        var next = {};
        Object.keys(map).forEach(function (id) { next[id] = allSet ? '' : map[id]; });
        applyFilters(next, scroll);
    }

    function resetFilters() {
        var next = {};
        ALL_IDS.forEach(function (id) { next[id] = ''; });
        applyFilters(next, false);
    }

    // Mirror the filter bar onto every control on the page (two-way sync).
    function syncActive() {
        var state = val('bb-state'), stance = val('bb-stance'), status = val('bb-status'), cat = val('bb-category');
        each('.cartogrid .tile[data-state]', function (t) { setActive(t, t.getAttribute('data-state') === state); });
        setActive($('fedchip'), state === 'US');
        each('#rank li[data-state]', function (li) { setActive(li, li.getAttribute('data-state') === state); });
        var cs = $('clear-state');
        if (cs) cs.style.display = state ? '' : 'none';
        each('.topic[data-cat]', function (c) { setActive(c, c.getAttribute('data-cat') === cat); });
        each('.stage[data-status]', function (s) { setActive(s, s.getAttribute('data-status') === status); });
        setActive($('tile-threats'), stance === 'anti' && status === 'active');
        setActive($('tile-pro'), stance === 'pro' && status === 'active');
        setActive($('tile-signed'), status === 'Signed into Law');
    }

    // Deep links can name a category or status that only exists as an option
    // after render (federal subject names). Re-apply those once options exist.
    function reapplyURL() {
        var params = new URLSearchParams(window.location.search);
        var fixed = null;
        [['bb-category', 'category'], ['bb-status', 'status']].forEach(function (p) {
            var e = $(p[0]), want = params.get(p[1]);
            if (e && want && e.value !== want) {
                e.value = want;
                if (e.value === want) fixed = e;
            }
        });
        if (fixed) fireChange(fixed);
    }

    // "Matching your filters" tile mirrors whatever BillBrowser reports.
    function watchCount() {
        var c = $('bb-count');
        if (!c) return;
        function update() {
            var m = /^([\d,]+\+?)/.exec(c.textContent || '');
            setText('stat-matching', m ? m[1] : '...');
        }
        update();
        if (window.MutationObserver) {
            new MutationObserver(update).observe(c, { childList: true, characterData: true, subtree: true });
        }
    }

    // ---------- renderers ----------

    function renderMap(states, perState) {
        var grid = $('cartogrid');
        if (!grid) return;
        clear(grid);
        Object.keys(POS).forEach(function (st) {
            // A state absent from the dataset has NO coverage yet; showing it
            // as "0 threats" would assert something we have not verified.
            var covered = !!states[st];
            var n = perState[st] || 0;
            var tile = make(covered ? 'button' : 'span', 'tile ' + (covered ? bucket(n) : 'nodata'));
            tile.style.gridArea = POS[st][1] + '/' + POS[st][0];
            tile.title = (STATE_NAMES[st] || st) +
                (covered ? ': ' + n + ' active threat' + (n === 1 ? '' : 's') : ': no bill data yet');
            tile.appendChild(make('span', 'ab', st));
            if (covered && n) tile.appendChild(make('span', 'ct', String(n)));
            if (covered) {
                tile.type = 'button';
                tile.setAttribute('data-state', st);
                tile.setAttribute('aria-label', tile.title + '. Filter the list to this state.');
                tile.setAttribute('aria-pressed', 'false');
                tile.addEventListener('click', function () { pickState(st); });
            } else {
                tile.setAttribute('aria-label', tile.title);
            }
            grid.appendChild(tile);
        });
        var top = Object.keys(perState).filter(function (s) { return s !== 'US'; })
            .sort(function (x, y) { return perState[y] - perState[x]; }).slice(0, 5)
            .map(function (s) { return (STATE_NAMES[s] || s) + ' ' + perState[s]; }).join(', ');
        grid.setAttribute('aria-label', 'Tile map of active anti-science bills per state; each tile filters the list. Highest: ' + top + '.');
    }

    function pickState(st) {
        if (val('bb-state') === st) applyFilters({ 'bb-state': '' }, false);
        else applyFilters({ 'bb-state': st, 'bb-stance': 'anti' }, true);
    }

    function renderFed(fedCount) {
        var fed = $('fedchip');
        if (!fed) return;
        clear(fed);
        fed.appendChild(document.createTextNode('US CONGRESS '));
        fed.appendChild(make('span', 'ct', fedCount + ' ACTIVE THREATS (FEDERAL)'));
        fed.addEventListener('click', function () { pickState('US'); });
        var cs = $('clear-state');
        if (cs) cs.addEventListener('click', function () { applyFilters({ 'bb-state': '' }, false); });
    }

    function renderRank(perState, generatedAt) {
        var rank = Object.keys(perState).map(function (s) { return { s: s, n: perState[s] }; })
            .sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
        var max = rank.length ? rank[0].n : 1;
        var rEl = $('rank');
        if (!rEl) return;
        clear(rEl);
        rank.forEach(function (r) {
            var li = make('li');
            li.setAttribute('data-state', r.s);
            var btn = make('button');
            btn.type = 'button';
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', (STATE_NAMES[r.s] || r.s) + ': ' + r.n + ' active anti-science bill' + (r.n === 1 ? '' : 's') + '. Filter the list to this jurisdiction.');
            var row = make('div', 'row');
            row.appendChild(make('span', null, STATE_NAMES[r.s] || r.s));
            row.appendChild(make('span', 'n', String(r.n)));
            var bar = make('div', 'bar');
            var fill = make('i');
            fill.style.width = Math.max(6, Math.round(r.n / max * 100)) + '%';
            bar.appendChild(fill);
            btn.appendChild(row);
            btn.appendChild(bar);
            btn.addEventListener('click', function () { pickState(r.s); });
            li.appendChild(btn);
            rEl.appendChild(li);
        });
        setText('rank-note', 'Active anti-science bills by jurisdiction, from bill data updated ' +
            (generatedAt ? new Date(generatedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'daily') +
            '. Click one to filter the list.');
    }

    function renderTopics(activeAnti, pro) {
        var box = $('topics');
        if (!box) return;
        var counts = {};
        activeAnti.concat(pro).forEach(function (b) {
            var c = b.category || '';
            if (c) counts[c] = (counts[c] || 0) + 1;
        });
        var cats = Object.keys(counts).sort(function (a, b) {
            return counts[b] - counts[a] || a.localeCompare(b);
        });
        var sel = $('bb-category');
        clear(box);
        if (!cats.length) {
            box.appendChild(make('p', 'muted', 'No active anti- or pro-science bills carry a topic yet.'));
            return;
        }
        cats.forEach(function (c) {
            ensureOption(sel, c, CAT_LABELS[c] || c);
            var chip = make('button', 'topic');
            chip.type = 'button';
            chip.setAttribute('data-cat', c);
            chip.setAttribute('aria-pressed', 'false');
            chip.appendChild(make('span', null, CAT_LABELS[c] || c));
            chip.appendChild(make('span', 'n', String(counts[c])));
            chip.addEventListener('click', function () { toggleFilters({ 'bb-category': c }, true); });
            box.appendChild(chip);
        });
    }

    function renderStages(bills) {
        var box = $('pipeline');
        if (!box) return;
        var counts = {};
        bills.forEach(function (b) {
            var s = STATUS_ALIAS[b.status] || b.status || '';
            if (s) counts[s] = (counts[s] || 0) + 1;
        });
        var max = 0;
        STAGES.forEach(function (s) { if ((counts[s] || 0) > max) max = counts[s]; });
        var sel = $('bb-status');
        clear(box);
        STAGES.forEach(function (s) {
            var n = counts[s] || 0;
            var seg = make('button', 'stage');
            seg.type = 'button';
            seg.setAttribute('data-status', s);
            seg.setAttribute('aria-pressed', 'false');
            seg.setAttribute('aria-label', s + ': ' + fmt(n) + ' bill' + (n === 1 ? '' : 's') + (n ? '. Filter the list to this stage.' : ''));
            seg.appendChild(make('span', 'n', fmt(n)));
            seg.appendChild(make('span', 'l', s));
            var bar = make('span', 'bar');
            var fill = make('i');
            fill.style.width = (n && max ? Math.max(2, Math.round(n / max * 100)) : 0) + '%';
            bar.appendChild(fill);
            seg.appendChild(bar);
            if (n) {
                ensureOption(sel, s, s);
                seg.addEventListener('click', function () { toggleFilters({ 'bb-status': s }, true); });
            } else {
                seg.disabled = true;
            }
            box.appendChild(seg);
        });
    }

    function renderWatch(activeAnti) {
        var bl = $('bills-live');
        if (!bl) return;
        var rankOf = {};
        STATUS_ORDER.forEach(function (s, i) { rankOf[s] = i; });
        var wl = activeAnti.slice().sort(function (a, b) {
            return (rankOf[STATUS_ALIAS[b.status] || b.status] || 0) - (rankOf[STATUS_ALIAS[a.status] || a.status] || 0) ||
                String(b.lastActionDate || '').localeCompare(String(a.lastActionDate || ''));
        }).slice(0, 6);
        clear(bl);
        if (!wl.length) {
            bl.appendChild(make('p', 'muted', 'No active anti-science bills are moving right now.'));
            return;
        }
        wl.forEach(function (b) {
            var isFed = b.state === 'US';
            var href = 'action.html?bill=' + encodeURIComponent(b.billId || '') +
                (isFed ? '' : '&state=' + encodeURIComponent(b.state));
            var row = make('div', 'bill');
            row.appendChild(make('span', 'jur' + (isFed ? '' : ' state'), b.state || ''));
            var mid = make('div');
            mid.appendChild(make('span', 'id', b.billNumber || ''));
            mid.appendChild(document.createTextNode(' '));
            mid.appendChild(make('span', 'ttl', String(b.title || '').slice(0, 110)));
            row.appendChild(mid);
            row.appendChild(make('span', 'bstatus', String(b.status || '').toUpperCase()));
            var a = make('a', 'actlink', 'Act on this bill →');
            a.href = href;
            row.appendChild(a);
            bl.appendChild(row);
        });
    }

    function wireStats() {
        var t = $('tile-threats'), p = $('tile-pro'), s = $('tile-signed');
        if (t) t.addEventListener('click', function () { toggleFilters({ 'bb-stance': 'anti', 'bb-status': 'active' }, true); });
        if (p) p.addEventListener('click', function () { toggleFilters({ 'bb-stance': 'pro', 'bb-status': 'active' }, true); });
        if (s) s.addEventListener('click', function () { toggleFilters({ 'bb-status': 'Signed into Law' }, true); });
        var r = $('reset-filters');
        if (r) r.addEventListener('click', resetFilters);
    }

    function wireSelects() {
        SYNC_IDS.forEach(function (id) {
            var e = $(id);
            if (e) e.addEventListener('change', syncActive);
        });
    }

    function showUnavailable() {
        ['stat-bills', 'stat-threats', 'stat-pro', 'stat-signed', 'stat-states'].forEach(function (id) { setText(id, 'n/a'); });
        setText('data-updated-stamp', 'BILL DATA TEMPORARILY UNAVAILABLE');
        var note = $('insights-note');
        if (note) note.style.display = '';
        each('.insight', function (s) { s.style.display = 'none'; });
    }

    // ---------- main ----------

    // Share the single fetch+parse with LegislationAPI (BillBrowser needs the
    // same 7MB file); avoids downloading and parsing it twice on this page.
    var load = (typeof LegislationAPI !== 'undefined' && LegislationAPI._loadBillsDoc)
        ? LegislationAPI._loadBillsDoc()
        : fetch('data/bills.json').then(function (r) {
            if (!r.ok) throw new Error('bills.json HTTP ' + r.status);
            return r.json();
        });

    ready(function () {
        wireStats();
        wireSelects();
        watchCount();
        syncActive();

        load.then(function (data) {
            var bills = data.bills || [];
            var anti = bills.filter(function (b) { return b.billType === 'anti'; });
            var activeAnti = anti.filter(function (b) { return b.isActive === 'Yes'; });
            var pro = bills.filter(function (b) { return b.billType === 'pro' && b.isActive === 'Yes'; });
            var signed = bills.filter(function (b) { return b.status === 'Signed into Law'; });
            var states = {};
            // DC gets a map tile but is not a state; keep it out of the "states
            // covered" count so 50 means fifty states.
            bills.forEach(function (b) { if (b.state && b.state !== 'US') states[b.state] = true; });
            var stateCount = Object.keys(states).filter(function (s) { return s !== 'DC'; }).length;

            var upd = data.generated_at ? dateLabel(data.generated_at) : '';
            setText('data-updated-stamp', 'TRACKING ' + fmt(bills.length) + ' BILLS' + (upd ? ' - UPDATED ' + upd : ''));
            setText('chip-updated', upd ? 'BILL DATA UPDATED ' + upd : 'BILL DATA UPDATED DAILY');
            setText('chip-coverage', stateCount + ' STATES + CONGRESS');
            setText('watch-updated', upd ? 'UPDATED ' + upd : 'LIVE');

            setText('stat-bills', fmt(bills.length));
            setText('stat-threats', fmt(activeAnti.length));
            setText('stat-pro', fmt(pro.length));
            setText('stat-signed', fmt(signed.length));
            setText('stat-states', String(stateCount));
            setText('map-chip', activeAnti.length + ' ACTIVE THREATS');

            var perState = {};
            activeAnti.forEach(function (b) {
                var s = b.state || '';
                if (s) perState[s] = (perState[s] || 0) + 1;
            });

            renderMap(states, perState);
            renderFed(perState.US || 0);
            renderRank(perState, data.generated_at);
            renderTopics(activeAnti, pro);
            renderStages(bills);
            renderWatch(activeAnti);

            reapplyURL();
            syncActive();
        }).catch(function (e) {
            console.warn('tracker insights:', e);
            showUnavailable();
        });
    });
})();
