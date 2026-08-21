// ============================================
// SAFE Action - Legislative Records (list + detail).
// Shared by records.html (body data-page="records") and record.html
// (body data-page="record", served at /record/:slug).
//
// Reads data/records.json, a neutral repository of sponsorships,
// cosponsorships, and recorded roll-call votes on tracked bills. The only
// classification shown is the bill-level stance chip (anti / pro / monitor),
// which describes the bill. A vote is shown as the fact the legislature
// recorded (Yea, Nay, Not voting, Absent, Present) with no adjective.
// Nothing here labels, grades, scores, or ranks a person.
//
// Every piece of data reaches the DOM through createElement / textContent.
// No innerHTML is used anywhere in this file.
//
// Optional fields (older data files may lack them): legislators[].votes,
// legislators[].topics, counts.votes / votes_yea / votes_nay, summary.votes.
// Missing votes read as []. Missing topics derive from the categories of
// that legislator's sponsorships and votes.
//
// Development fixture: when the query string carries fixture=1 the pages
// load data/records.fixture.json instead of the live file. A fixture file
// carries "fixture": true at top level and the pages show a notice.
// ============================================
(function () {
    'use strict';

    var FIXTURE = /[?&]fixture=1(?:&|$)/.test(window.location.search);
    var DATA_URL = FIXTURE ? '/data/records.fixture.json' : '/data/records.json';
    var PAGE_SIZE = 100;
    var SITE = 'https://scienceandfreedom.com';
    var STATE_NAMES = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', AS:'American Samoa', GU:'Guam', MP:'Northern Mariana Islands', PR:'Puerto Rico', VI:'U.S. Virgin Islands', US:'US Congress' };

    // Bill-level classification vocabulary (matches the tracker's badge classes).
    var TYPE_LABEL = { anti: 'Anti-science', pro: 'Pro-science', monitor: 'Monitoring' };
    var TYPE_CLASS = { anti: 'badge-anti', pro: 'badge-pro', monitor: 'badge-monitor' };
    var TYPE_WORD  = { anti: 'anti-science', pro: 'pro-science', monitor: 'monitoring' };
    var ROLE_LABEL = { primary: 'Primary sponsor', cosponsor: 'Cosponsor' };
    var EMPTY_SENTENCE = 'No sponsorships of tracked bills on record.';
    var EMPTY_VOTES = 'No recorded votes on tracked bills on record.';

    // Recorded-vote vocabulary. Each value is shown as the legislature
    // recorded it. The two chip styles are outlines in the site's own
    // neutral inks (navy, ink), never a verdict color.
    var VOTE_LABEL = { Yea: 'Yea', Nay: 'Nay', NV: 'Not voting', Absent: 'Absent', Present: 'Present' };
    var VOTE_CLASS = { Yea: 'vote-yea', Nay: 'vote-nay' };

    // Display names for topic slugs. Unknown slugs fall back to "hyphens to
    // spaces, capitalize the first letter". Values that already carry
    // capitals (congress.gov policy areas such as "Health") pass through.
    var TOPIC_LABEL = {
        'vaccine-exemption': 'Vaccine exemptions',
        'vaccine-mandate': 'Vaccine mandates',
        'vaccine-injury': 'Vaccine injury',
        'vaccine-discrimination': 'Vaccine discrimination',
        'public-health': 'Public health',
        'medical-freedom': 'Medical freedom',
        'informed-consent': 'Informed consent',
        'fluoride': 'Fluoride'
    };

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
    function plural(n, word) { return fmt(n) + ' ' + word + (n === 1 ? '' : 's'); }
    function dateLabel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
    function safeUrl(u) { return /^https?:\/\//i.test(str(u)) ? str(u) : ''; }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
    function fillRows(tbody, rows, rowFn) {
        clear(tbody);
        if (!tbody || !rows.length) return;
        var frag = document.createDocumentFragment();
        rows.forEach(function (r) { frag.appendChild(rowFn(r)); });
        tbody.appendChild(frag);
    }

    // ---------- query-string helpers (ES5, no URLSearchParams) ----------
    function parseQuery(qs) {
        var out = {};
        str(qs).replace(/^\?/, '').split('&').forEach(function (pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            var k = i === -1 ? pair : pair.slice(0, i);
            var v = i === -1 ? '' : pair.slice(i + 1);
            try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
            try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e2) { /* keep raw */ }
            out[k] = v;
        });
        return out;
    }
    function buildQuery(obj) {
        var parts = [];
        Object.keys(obj).forEach(function (k) {
            if (obj[k] == null || obj[k] === '') return;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }
    function hasOption(sel, value) {
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === value) return true;
        }
        return false;
    }

    // ---------- data helpers ----------
    function sponsorships(l) { return Array.isArray(l.sponsorships) ? l.sponsorships : []; }
    function votes(l) { return Array.isArray(l.votes) ? l.votes : []; }
    function topicsOf(l) {
        if (Array.isArray(l.topics)) return l.topics;
        var seen = {}, out = [];
        sponsorships(l).concat(votes(l)).forEach(function (x) {
            var c = str(x.category);
            if (c && !seen[c]) { seen[c] = true; out.push(c); }
        });
        return out;
    }
    function topicLabel(slug) {
        var s = str(slug);
        if (TOPIC_LABEL[s]) return TOPIC_LABEL[s];
        if (/[A-Z]/.test(s)) return s;
        var words = trim(s.replace(/[-_]+/g, ' '));
        return words.charAt(0).toUpperCase() + words.slice(1);
    }
    function tally(sp, vo) {
        var v = { sp: sp, vo: vo, total: sp.length, primary: 0, cosponsor: 0, anti: 0, pro: 0, monitor: 0,
                  votes: vo.length, yea: 0, nay: 0 };
        sp.forEach(function (s) {
            if (s.role === 'primary') v.primary++;
            else if (s.role === 'cosponsor') v.cosponsor++;
            var t = str(s.billType);
            if (t === 'anti' || t === 'pro' || t === 'monitor') v[t]++;
        });
        vo.forEach(function (x) {
            if (x.vote === 'Yea') v.yea++;
            else if (x.vote === 'Nay') v.nay++;
        });
        return v;
    }
    // Counts for one legislator. With no topic, the crawler's precomputed
    // counts win when present. With a topic, every number is recomputed from
    // only the sponsorships and votes whose category equals that topic, so
    // the table and chips describe that subset alone.
    var COUNT_KEYS = { total: 'total', primary: 'primary', cosponsor: 'cosponsor', anti: 'anti', pro: 'pro',
                       monitor: 'monitor', votes: 'votes', yea: 'votes_yea', nay: 'votes_nay' };
    function view(l, topic) {
        var sp = sponsorships(l), vo = votes(l);
        if (topic) {
            sp = sp.filter(function (s) { return str(s.category) === topic; });
            vo = vo.filter(function (x) { return str(x.category) === topic; });
            return tally(sp, vo);
        }
        var v = tally(sp, vo);
        var c = l.counts || {};
        Object.keys(COUNT_KEYS).forEach(function (k) {
            if (typeof c[COUNT_KEYS[k]] === 'number') v[k] = c[COUNT_KEYS[k]];
        });
        return v;
    }
    function placeLabel(l) {
        // Numeric districts read as "District 97"; named ones (WARD 1,
        // 31ST MIDDLESEX) are shown verbatim as the source records them.
        var st = str(l.state), d = str(l.district);
        if (!d) return st;
        return st + ', ' + (/^\d+$/.test(d) ? 'District ' + d : d);
    }
    function recordHref(slug) {
        return '/record/' + encodeURIComponent(str(slug)) + (FIXTURE ? '?fixture=1' : '');
    }
    function load(onOk, onErr) {
        fetch(DATA_URL).then(function (r) {
            if (!r.ok) throw new Error(DATA_URL + ' HTTP ' + r.status);
            return r.json();
        }).then(onOk).catch(onErr);
    }
    function noteFixture(data) {
        // A development fixture must never be mistaken for a real record.
        if (data && data.fixture === true) show('rec-fixture', true);
        // Keep a fixture session in fixture mode when navigating back to the list.
        if (FIXTURE) {
            var back = document.querySelector('.back-link');
            if (back) back.setAttribute('href', '/records?fixture=1');
        }
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
            selParty = $('rf-party'), selTopic = $('rf-topic'), chkRec = $('rf-onrecord'),
            inpSearch = $('rf-search');
        var tbody = $('rec-rows'), moreBtn = $('rec-more');
        if (!tbody || !selState || !selTopic) return;

        function uniq(key) {
            var seen = {}, out = [];
            all.forEach(function (l) {
                var v = str(l[key]);
                if (v && !seen[v]) { seen[v] = true; out.push(v); }
            });
            return out.sort();
        }
        function uniqTopics() {
            var seen = {}, out = [];
            all.forEach(function (l) {
                topicsOf(l).forEach(function (t) {
                    var v = str(t);
                    if (v && !seen[v]) { seen[v] = true; out.push(v); }
                });
            });
            return out.sort(function (a, b) { return topicLabel(a).localeCompare(topicLabel(b)); });
        }
        function fillSelect(sel, values, labelFn) {
            values.forEach(function (v) {
                var o = document.createElement('option');
                o.value = v;
                o.textContent = labelFn ? labelFn(v) : v;
                sel.appendChild(o);
            });
        }
        // Name plus every bill number and title in the legislator's
        // sponsorships and votes, lowercased once and cached. Bill numbers
        // are added with and without spaces so "hr120" finds "HR 120".
        function searchBlob(l) {
            if (typeof l._search === 'string') return l._search;
            var parts = [str(l.name)];
            sponsorships(l).concat(votes(l)).forEach(function (x) {
                var num = str(x.billNumber);
                parts.push(num, num.replace(/\s+/g, ''), str(x.title));
            });
            l._search = parts.join('\n').toLowerCase();
            return l._search;
        }

        function row(item) {
            var l = item.l, v = item.v;
            var tr = document.createElement('tr');
            var td = el('td');
            var a = el('a', 'name', str(l.name));
            a.href = recordHref(l.slug);
            td.appendChild(a);
            tr.appendChild(td);

            td = el('td', null, str(l.office));
            td.appendChild(el('span', 'rec-sub', placeLabel(l)));
            tr.appendChild(td);

            tr.appendChild(el('td', null, str(l.party)));

            td = el('td', 'spons');
            td.appendChild(el('span', 'tot', fmt(v.total)));
            ['anti', 'pro', 'monitor'].forEach(function (k) {
                var n = v[k];
                if (!n) return;
                var label = n + ' bill' + (n === 1 ? '' : 's') + ' classified ' + TYPE_WORD[k];
                // Visible text names the BILLS explicitly so the chip never reads as a label on the person.
                var b = el('span', 'badge ' + TYPE_CLASS[k], n + ' ' + TYPE_WORD[k] + ' bill' + (n === 1 ? '' : 's'));
                b.title = label;
                b.setAttribute('aria-label', label);
                td.appendChild(b);
            });
            tr.appendChild(td);

            td = el('td', 'spons');
            td.appendChild(el('span', 'tot', fmt(v.votes)));
            if (v.votes) td.appendChild(el('span', 'rec-sub', fmt(v.yea) + ' yea, ' + fmt(v.nay) + ' nay'));
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
            var tp = selTopic.value;
            setText('rec-count', 'Showing ' + fmt(shown) + ' of ' + plural(filtered.length, 'legislator') +
                (tp ? ' (topic: ' + topicLabel(tp) + ')' : ''));
            show('rec-tablewrap', filtered.length > 0);
            show('rec-empty', filtered.length === 0);
            show('rec-more', shown < filtered.length);
        }

        // Deep-link state: ?topic=&q=&state= mirror the controls so a URL
        // from a video lands on the same view. Other params (fixture=1) are kept.
        function syncUrl(st, tp, q) {
            if (!window.history || !window.history.replaceState) return;
            var cur = parseQuery(window.location.search);
            cur.state = st;
            cur.topic = tp;
            cur.q = q;
            var next = window.location.pathname + buildQuery(cur) + window.location.hash;
            if (next !== window.location.pathname + window.location.search + window.location.hash) {
                window.history.replaceState(null, '', next);
            }
        }
        function readUrl() {
            var init = parseQuery(window.location.search);
            if (init.state && hasOption(selState, init.state)) selState.value = init.state;
            if (init.topic && hasOption(selTopic, init.topic)) selTopic.value = init.topic;
            if (init.q) inpSearch.value = init.q;
        }

        function applyFilters() {
            var st = selState.value, lv = selLevel.value, ch = selChamber.value, pa = selParty.value,
                tp = selTopic.value;
            var onlyRec = chkRec.checked;
            var qRaw = trim(inpSearch.value), q = qRaw.toLowerCase();
            filtered = [];
            all.forEach(function (l) {
                if (st && str(l.state) !== st) return;
                if (lv && str(l.level) !== lv) return;
                if (ch && str(l.chamber) !== ch) return;
                if (pa && str(l.party) !== pa) return;
                if (tp && topicsOf(l).indexOf(tp) === -1) return;
                if (q && searchBlob(l).indexOf(q) === -1) return;
                var v = view(l, tp);
                // "Has records" means at least one sponsorship or one vote,
                // inside the current topic when one is chosen.
                if (onlyRec && v.sp.length === 0 && v.vo.length === 0) return;
                filtered.push({ l: l, v: v });
            });
            filtered.sort(function (a, b) {
                return b.v.total - a.v.total || b.v.votes - a.v.votes ||
                    str(a.l.name).localeCompare(str(b.l.name));
            });
            shown = 0;
            clear(tbody);
            renderMore();
            syncUrl(st, tp, qRaw);
        }

        load(function (data) {
            all = (data.legislators || []).slice();
            fillSelect(selState, uniq('state'), function (s) {
                return STATE_NAMES[s] ? s + ' - ' + STATE_NAMES[s] : s;
            });
            fillSelect(selChamber, uniq('chamber'));
            fillSelect(selParty, uniq('party'));
            fillSelect(selTopic, uniqTopics(), topicLabel);

            var s = data.summary || {};
            var nLeg = typeof s.legislators === 'number' ? s.legislators : all.length;
            var nWith = typeof s.with_records === 'number' ? s.with_records :
                all.filter(function (l) { return sponsorships(l).length > 0 || votes(l).length > 0; }).length;
            var nSp = typeof s.sponsorships === 'number' ? s.sponsorships :
                all.reduce(function (acc, l) { return acc + sponsorships(l).length; }, 0);
            var nVo = typeof s.votes === 'number' ? s.votes :
                all.reduce(function (acc, l) { return acc + votes(l).length; }, 0);
            var upd = stamp('LEGISLATIVE RECORDS', data);
            setText('rec-summary', fmt(nLeg) + ' LEGISLATORS ON FILE - ' + fmt(nWith) +
                ' WITH SPONSORSHIPS OR VOTES ON RECORD - ' + fmt(nSp) + ' SPONSORSHIPS - ' +
                fmt(nVo) + ' VOTES' + (upd ? ' - UPDATED ' + upd : ''));
            noteFixture(data);
            show('rec-loading', false);

            readUrl();
            [selState, selLevel, selChamber, selParty, selTopic, chkRec].forEach(function (c) {
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

    // Shared first cell for sponsorship and vote rows: bill number linked to
    // the official source (http(s) only), state + level, tracker link.
    function billCell(s) {
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
        return td;
    }
    function classCell(type) {
        var td = el('td');
        var k = str(type);
        if (TYPE_LABEL[k]) td.appendChild(el('span', 'badge ' + TYPE_CLASS[k], TYPE_LABEL[k]));
        else td.textContent = k;
        return td;
    }

    function billRow(s) {
        var tr = document.createElement('tr');
        tr.appendChild(billCell(s));
        tr.appendChild(el('td', 'ttl', str(s.title)));
        tr.appendChild(el('td', null, ROLE_LABEL[str(s.role)] || str(s.role)));
        tr.appendChild(classCell(s.billType));
        tr.appendChild(el('td', null, str(s.status)));
        tr.appendChild(el('td', 'mono', str(s.lastActionDate)));
        return tr;
    }

    function voteRow(x) {
        var tr = document.createElement('tr');
        tr.appendChild(billCell(x));
        tr.appendChild(el('td', 'ttl', str(x.title)));
        tr.appendChild(el('td', null, str(x.motion) || str(x.chamber)));

        var td = el('td');
        var v = str(x.vote);
        var label = VOTE_LABEL[v] || v;
        var chip = el('span', 'vote' + (VOTE_CLASS[v] ? ' ' + VOTE_CLASS[v] : ''), label);
        chip.setAttribute('aria-label', 'Recorded vote: ' + label);
        td.appendChild(chip);
        tr.appendChild(td);

        tr.appendChild(classCell(x.billType));

        td = el('td', null, x.passed === true ? 'Passed' : (x.passed === false ? 'Failed' : ''));
        if (typeof x.yea === 'number' && typeof x.nay === 'number') {
            td.appendChild(el('span', 'rec-sub', fmt(x.yea) + ' yea, ' + fmt(x.nay) + ' nay'));
        }
        tr.appendChild(td);

        tr.appendChild(el('td', 'mono', str(x.date)));
        return tr;
    }

    function renderDetail(l, slug, upd) {
        var name = str(l.name);
        var office = str(l.office);
        var titleText = name + ' - Legislative Record - SAFE Action';
        var desc = 'Sponsorships, cosponsorships, and recorded votes on bills tracked by SAFE Action, on record for ' +
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

        var v = view(l, '');
        var n = v.total;
        setText('rec-counts', fmt(n) + ' SPONSORSHIP' + (n === 1 ? '' : 'S') + ' ON RECORD' +
            (n ? ' - ' + fmt(v.primary) + ' AS PRIMARY SPONSOR - ' + fmt(v.cosponsor) + ' AS COSPONSOR' : '') +
            ' - ' + fmt(v.votes) + ' VOTE' + (v.votes === 1 ? '' : 'S') + ' ON RECORD' +
            (upd ? ' - UPDATED ' + upd : ''));

        var fix = $('rec-correct');
        if (fix) fix.href = 'mailto:board@scienceandfreedom.com?subject=Correction%20request%3A%20' + encodeURIComponent(name);

        var rows = sponsorships(l).slice().sort(function (a, b) {
            return str(b.lastActionDate).localeCompare(str(a.lastActionDate)) ||
                str(a.billNumber).localeCompare(str(b.billNumber));
        });
        fillRows($('rec-bill-rows'), rows, billRow);
        show('rec-tablewrap', rows.length > 0);
        setText('rec-empty', EMPTY_SENTENCE);
        show('rec-empty', rows.length === 0);

        var vrows = votes(l).slice().sort(function (a, b) {
            return str(b.date).localeCompare(str(a.date)) ||
                str(a.billNumber).localeCompare(str(b.billNumber));
        });
        fillRows($('rec-vote-rows'), vrows, voteRow);
        show('rec-votewrap', vrows.length > 0);
        setText('rec-vote-empty', EMPTY_VOTES);
        show('rec-vote-empty', vrows.length === 0);

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
