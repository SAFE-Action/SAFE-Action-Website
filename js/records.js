// ============================================
// SAFE Action - Legislative Records (list + detail).
// Shared by records.html (body data-page="records") and record.html
// (body data-page="record", served at /record/:slug).
//
// Reads data/records.json, a neutral repository of sponsorships and
// cosponsorships of tracked bills. The only classification shown is the
// bill-level stance chip (anti / pro / monitor), which describes the bill.
// Nothing here labels, grades, scores, or ranks a person.
//
// Every piece of data reaches the DOM through createElement / textContent.
// No innerHTML is used anywhere in this file.
// ============================================
(function () {
    'use strict';

    var DATA_URL = '/data/records.json';
    var PAGE_SIZE = 100;
    var SITE = 'https://scienceandfreedom.com';
    var STATE_NAMES = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', AS:'American Samoa', GU:'Guam', MP:'Northern Mariana Islands', PR:'Puerto Rico', VI:'U.S. Virgin Islands', US:'US Congress' };

    // Bill-level classification vocabulary (matches the tracker's badge classes).
    var TYPE_LABEL = { anti: 'Anti-science', pro: 'Pro-science', monitor: 'Monitoring' };
    var TYPE_CLASS = { anti: 'badge-anti', pro: 'badge-pro', monitor: 'badge-monitor' };
    var TYPE_WORD  = { anti: 'anti-science', pro: 'pro-science', monitor: 'monitoring' };
    var ROLE_LABEL = { primary: 'Primary sponsor', cosponsor: 'Cosponsor' };
    var EMPTY_SENTENCE = 'No sponsorships of tracked bills on record.';

    // ---------- small DOM + format helpers ----------
    function $(id) { return document.getElementById(id); }
    function str(v) { return v == null ? '' : String(v); }
    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = String(txt);
        return e;
    }
    function show(id, on) { var e = $(id); if (e) e.style.display = on ? '' : 'none'; }
    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function setMeta(attr, key, value) {
        var m = document.querySelector('meta[' + attr + '="' + key + '"]');
        if (m) m.setAttribute('content', value);
    }
    function fmt(n) { return Number(n || 0).toLocaleString(); }
    function dateLabel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
    function safeUrl(u) { return /^https?:\/\//i.test(str(u)) ? str(u) : ''; }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

    // ---------- data helpers ----------
    function sponsorships(l) { return Array.isArray(l.sponsorships) ? l.sponsorships : []; }
    function total(l) {
        if (l.counts && typeof l.counts.total === 'number') return l.counts.total;
        return sponsorships(l).length;
    }
    function countOf(l, key) {
        if (l.counts && typeof l.counts[key] === 'number') return l.counts[key];
        var n = 0;
        sponsorships(l).forEach(function (s) {
            if (key === 'primary' || key === 'cosponsor') { if (s.role === key) n++; }
            else if (s.billType === key) n++;
        });
        return n;
    }
    function placeLabel(l) {
        // Numeric districts read as "District 97"; named ones (WARD 1,
        // 31ST MIDDLESEX) are shown verbatim as the source records them.
        var st = str(l.state), d = str(l.district);
        if (!d) return st;
        return st + ', ' + (/^\d+$/.test(d) ? 'District ' + d : d);
    }
    function load(onOk, onErr) {
        fetch(DATA_URL).then(function (r) {
            if (!r.ok) throw new Error('records.json HTTP ' + r.status);
            return r.json();
        }).then(onOk).catch(onErr);
    }
    function noteFixture(data) {
        // A development fixture must never be mistaken for a real record.
        if (data && data.fixture === true) show('rec-fixture', true);
    }
    function stamp(prefix, data) {
        var upd = dateLabel(data && data.generated_at);
        setText('sb-label', prefix + (upd ? ' - UPDATED ' + upd : ''));
        return upd;
    }

    // ============================================
    // List page: records.html
    // ============================================
    function initList() {
        var all = [], filtered = [], shown = 0;
        var selState = $('rf-state'), selLevel = $('rf-level'), selChamber = $('rf-chamber'),
            selParty = $('rf-party'), chkRec = $('rf-onrecord'), inpSearch = $('rf-search');
        var tbody = $('rec-rows'), moreBtn = $('rec-more');
        if (!tbody || !selState) return;

        function uniq(key) {
            var seen = {}, out = [];
            all.forEach(function (l) {
                var v = str(l[key]);
                if (v && !seen[v]) { seen[v] = true; out.push(v); }
            });
            return out.sort();
        }
        function fillSelect(sel, values, labelFn) {
            values.forEach(function (v) {
                var o = document.createElement('option');
                o.value = v;
                o.textContent = labelFn ? labelFn(v) : v;
                sel.appendChild(o);
            });
        }

        function row(l) {
            var tr = document.createElement('tr');
            var td = el('td');
            var a = el('a', 'name', str(l.name));
            a.href = '/record/' + encodeURIComponent(str(l.slug));
            td.appendChild(a);
            tr.appendChild(td);

            td = el('td', null, str(l.office));
            td.appendChild(el('span', 'rec-sub', placeLabel(l)));
            tr.appendChild(td);

            tr.appendChild(el('td', null, str(l.party)));

            td = el('td', 'spons');
            td.appendChild(el('span', 'tot', fmt(total(l))));
            ['anti', 'pro', 'monitor'].forEach(function (k) {
                var n = countOf(l, k);
                if (!n) return;
                var label = n + ' bill' + (n === 1 ? '' : 's') + ' classified ' + TYPE_WORD[k];
                // Visible text names the BILLS explicitly so the chip never reads as a label on the person.
                var b = el('span', 'badge ' + TYPE_CLASS[k], n + ' ' + TYPE_WORD[k] + ' bill' + (n === 1 ? '' : 's'));
                b.title = label;
                b.setAttribute('aria-label', label);
                td.appendChild(b);
            });
            tr.appendChild(td);

            tr.appendChild(el('td', 'mono', l.up_in_2026 === true ? '2026' : ''));
            return tr;
        }

        function renderMore() {
            var frag = document.createDocumentFragment();
            var end = Math.min(filtered.length, shown + PAGE_SIZE);
            for (var i = shown; i < end; i++) frag.appendChild(row(filtered[i]));
            tbody.appendChild(frag);
            shown = end;
            setText('rec-count', 'Showing ' + fmt(shown) + ' of ' + fmt(filtered.length) +
                ' legislator' + (filtered.length === 1 ? '' : 's'));
            show('rec-tablewrap', filtered.length > 0);
            show('rec-empty', filtered.length === 0);
            show('rec-more', shown < filtered.length);
        }

        function applyFilters() {
            var st = selState.value, lv = selLevel.value, ch = selChamber.value, pa = selParty.value;
            var onlyRec = chkRec.checked;
            var q = inpSearch.value.replace(/^\s+|\s+$/g, '').toLowerCase();
            filtered = all.filter(function (l) {
                if (st && str(l.state) !== st) return false;
                if (lv && str(l.level) !== lv) return false;
                if (ch && str(l.chamber) !== ch) return false;
                if (pa && str(l.party) !== pa) return false;
                if (onlyRec && total(l) === 0) return false;
                if (q && str(l.name).toLowerCase().indexOf(q) === -1) return false;
                return true;
            });
            shown = 0;
            clear(tbody);
            renderMore();
        }

        load(function (data) {
            all = (data.legislators || []).slice();
            all.sort(function (a, b) {
                return total(b) - total(a) || str(a.name).localeCompare(str(b.name));
            });
            fillSelect(selState, uniq('state'), function (s) {
                return STATE_NAMES[s] ? s + ' - ' + STATE_NAMES[s] : s;
            });
            fillSelect(selChamber, uniq('chamber'));
            fillSelect(selParty, uniq('party'));

            var s = data.summary || {};
            var nLeg = typeof s.legislators === 'number' ? s.legislators : all.length;
            var nWith = typeof s.with_records === 'number' ? s.with_records :
                all.filter(function (l) { return total(l) > 0; }).length;
            var nSp = typeof s.sponsorships === 'number' ? s.sponsorships :
                all.reduce(function (acc, l) { return acc + total(l); }, 0);
            var upd = stamp('LEGISLATIVE RECORDS', data);
            setText('rec-summary', fmt(nLeg) + ' LEGISLATORS ON FILE - ' + fmt(nWith) +
                ' WITH SPONSORSHIPS ON RECORD - ' + fmt(nSp) + ' SPONSORSHIPS' +
                (upd ? ' - UPDATED ' + upd : ''));
            noteFixture(data);
            show('rec-loading', false);

            [selState, selLevel, selChamber, selParty, chkRec].forEach(function (c) {
                c.addEventListener('change', applyFilters);
            });
            inpSearch.addEventListener('input', applyFilters);
            moreBtn.addEventListener('click', renderMore);
            applyFilters();
        }, function (e) {
            console.warn('records list:', e);
            show('rec-loading', false);
            show('rec-error', true);
            setText('sb-label', 'RECORD DATA TEMPORARILY UNAVAILABLE');
        });
    }

    // ============================================
    // Detail page: record.html at /record/:slug (or ?slug= fallback)
    // ============================================
    function getSlug() {
        // Last non-empty path segment wins (/record/<slug>). When the page is
        // reached as /record.html or /record with no slug, fall back to ?slug=.
        var parts = window.location.pathname.split('/');
        var last = '';
        for (var i = parts.length - 1; i >= 0; i--) {
            if (parts[i]) { last = parts[i]; break; }
        }
        if (last && last !== 'record' && last !== 'record.html') {
            try { return decodeURIComponent(last); } catch (e) { return last; }
        }
        var m = window.location.search.match(/[?&]slug=([^&#]*)/);
        if (!m) return '';
        try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e2) { return m[1]; }
    }

    function billRow(s) {
        var tr = document.createElement('tr');
        var td = el('td', 'billcell');
        var num = str(s.billNumber) || str(s.billId);
        var src = safeUrl(s.sourceUrl);
        if (src) {
            var a = el('a', 'name', num);
            a.href = src;
            a.target = '_blank';
            a.rel = 'noopener';
            td.appendChild(a);
        } else {
            td.appendChild(el('span', 'name', num));
        }
        td.appendChild(el('span', 'rec-sub', str(s.state) + (s.level ? ' ' + str(s.level) : '')));
        if (s.billId) {
            var t = el('a', 'rec-sub', 'See in tracker');
            t.href = '/action?bill=' + encodeURIComponent(str(s.billId));
            td.appendChild(t);
        }
        tr.appendChild(td);

        tr.appendChild(el('td', 'ttl', str(s.title)));
        tr.appendChild(el('td', null, ROLE_LABEL[str(s.role)] || str(s.role)));

        td = el('td');
        var k = str(s.billType);
        if (TYPE_LABEL[k]) td.appendChild(el('span', 'badge ' + TYPE_CLASS[k], TYPE_LABEL[k]));
        else td.textContent = k;
        tr.appendChild(td);

        tr.appendChild(el('td', null, str(s.status)));
        tr.appendChild(el('td', 'mono', str(s.lastActionDate)));
        return tr;
    }

    function renderDetail(l, slug, upd) {
        var name = str(l.name);
        var office = str(l.office);
        var titleText = name + ' - Legislative Record - SAFE Action';
        var desc = 'Sponsorships and cosponsorships of bills tracked by SAFE Action on record for ' +
            name + (office ? ', ' + office : '') + (l.state ? ', ' + str(l.state) : '') +
            '. Drawn from official legislative sources.';
        var url = SITE + '/record/' + encodeURIComponent(slug);

        document.title = titleText;
        setMeta('property', 'og:title', titleText);
        setMeta('name', 'twitter:title', titleText);
        setMeta('name', 'description', desc);
        setMeta('property', 'og:description', desc);
        setMeta('name', 'twitter:description', desc);
        setMeta('property', 'og:url', url);
        var canon = $('rec-canonical');
        if (canon) canon.setAttribute('href', url);

        setText('rec-name', name);
        setText('rec-party', str(l.party));
        setText('rec-office', office);
        var place = placeLabel(l);
        if (STATE_NAMES[str(l.state)]) place += ' (' + STATE_NAMES[str(l.state)] + ')';
        setText('rec-place', place);
        setText('rec-level', str(l.level));
        show('rec-2026', l.up_in_2026 === true);

        var n = total(l), p = countOf(l, 'primary'), c = countOf(l, 'cosponsor');
        setText('rec-counts', fmt(n) + ' SPONSORSHIP' + (n === 1 ? '' : 'S') + ' ON RECORD' +
            (n ? ' - ' + fmt(p) + ' AS PRIMARY SPONSOR - ' + fmt(c) + ' AS COSPONSOR' : '') +
            (upd ? ' - UPDATED ' + upd : ''));

        var fix = $('rec-correct');
        if (fix) fix.href = 'mailto:board@scienceandfreedom.com?subject=Correction%20request%3A%20' + encodeURIComponent(name);

        var rows = sponsorships(l).slice().sort(function (a, b) {
            return str(b.lastActionDate).localeCompare(str(a.lastActionDate)) ||
                str(a.billNumber).localeCompare(str(b.billNumber));
        });
        var tbody = $('rec-bill-rows');
        clear(tbody);
        if (rows.length) {
            var frag = document.createDocumentFragment();
            rows.forEach(function (s) { frag.appendChild(billRow(s)); });
            tbody.appendChild(frag);
        }
        show('rec-tablewrap', rows.length > 0);
        setText('rec-empty', EMPTY_SENTENCE);
        show('rec-empty', rows.length === 0);
        show('rec-head', true);
        show('rec-body', true);
    }

    function initDetail() {
        var slug = getSlug();
        var key = slug.toLowerCase();
        load(function (data) {
            var list = data.legislators || [];
            var found = null;
            if (key) {
                for (var i = 0; i < list.length; i++) {
                    if (str(list[i].slug).toLowerCase() === key) { found = list[i]; break; }
                }
            }
            var upd = stamp('LEGISLATIVE RECORD', data);
            noteFixture(data);
            show('rec-loading', false);
            if (!found) {
                document.title = 'Record Not Found - Legislative Record - SAFE Action';
                show('rec-notfound', true);
                return;
            }
            renderDetail(found, str(found.slug), upd);
        }, function (e) {
            console.warn('record detail:', e);
            show('rec-loading', false);
            show('rec-error', true);
            setText('sb-label', 'RECORD DATA TEMPORARILY UNAVAILABLE');
        });
    }

    var page = document.body ? document.body.getAttribute('data-page') : '';
    if (page === 'records') initList();
    else if (page === 'record') initDetail();
})();
