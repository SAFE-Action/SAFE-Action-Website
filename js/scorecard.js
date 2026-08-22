// ============================================
// SAFE Action - Science Scorecard (scorecard.html, body data-page="scorecard").
//
// Reads data/scorecard.json: per-legislator COUNTS of official acts on bills
// SAFE Action has classified as pro-science or anti-science (sponsorships,
// cosponsorships, and recorded roll-call votes). The page orders rows by
// those counts and by nothing else. No grades, no letters, no adjectives on
// people. Party is shown as a plain fact. Every number links to the
// legislator's /record/{slug} page, which lists the bills and votes behind it.
//
// Every piece of data reaches the DOM through createElement / textContent.
// No innerHTML is used anywhere in this file. ES5 only.
//
// Topic view: when a topic is chosen, counts come from by_topic[topic]
// (pro / anti only; the source carries no sponsor-vs-vote split per topic)
// and rows without that topic are hidden. Ties inside a topic fall back to
// the legislator's overall primary-sponsorship count, then name.
// ============================================
(function () {
    'use strict';

    var DATA_URL = '/data/scorecard.json';
    var PAGE_SIZE = 100;
    var TOP_N = 10;
    var MIN_BOARD = 3;
    var DEFAULT_VIEW = 'anti';
    var SIDES = ['pro', 'anti'];
    var SIDE_WORD = { pro: 'pro-science', anti: 'anti-science' };
    var STATE_NAMES = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', AS:'American Samoa', GU:'Guam', MP:'Northern Mariana Islands', PR:'Puerto Rico', VI:'U.S. Virgin Islands', US:'US Congress' };

    // Display names for topic slugs (same table as records.js). Unknown slugs
    // fall back to "hyphens to spaces, capitalize the first letter". Values
    // that already carry capitals (congress.gov policy areas) pass through.
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
    function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = String(txt);
        return e;
    }
    function show(id, on) { var e = $(id); if (e) e.style.display = on ? '' : 'none'; }
    function setText(id, v) { var e = $(id); if (e) e.textContent = v; }
    function fmt(n) { return Number(n || 0).toLocaleString(); }
    function plural(n, word) { return fmt(n) + ' ' + word + (n === 1 ? '' : 's'); }
    function signed(n) { return n > 0 ? '+' + fmt(n) : (n < 0 ? '-' + fmt(-n) : '0'); }
    function dateLabel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }

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
    function topicLabel(slug) {
        var s = str(slug);
        if (TOPIC_LABEL[s]) return TOPIC_LABEL[s];
        if (/[A-Z]/.test(s)) return s;
        var words = trim(s.replace(/[-_]+/g, ' '));
        return words.charAt(0).toUpperCase() + words.slice(1);
    }
    function placeLabel(l) {
        // Numeric districts read as "District 97"; named ones (WARD 1,
        // 31ST MIDDLESEX) are shown verbatim as the source records them.
        var st = str(l.state), d = str(l.district);
        if (!d) return st;
        return st + ', ' + (/^\d+$/.test(d) ? 'District ' + d : d);
    }
    function officeLine(l) {
        var o = str(l.office), p = placeLabel(l);
        return o && p ? o + ', ' + p : (o || p);
    }
    function recordHref(slug) { return '/record/' + encodeURIComponent(str(slug)); }

    // Counts for one legislator. Without a topic, the crawler's totals.
    // With a topic, the by_topic entry; null when the row has none.
    function counts(l, topic) {
        if (topic) {
            var t = l.by_topic && l.by_topic[topic];
            if (!t) return null;
            return { pro: num(t.pro), anti: num(t.anti) };
        }
        return { pro: num(l.pro_acts), anti: num(l.anti_acts) };
    }
    function primaryOf(l, side) { return side === 'pro' ? num(l.pro_primary) : num(l.anti_primary); }
    // Order: count on that side desc, primary sponsorships desc, then name.
    function bySide(side) {
        return function (a, b) {
            return b[side] - a[side] || primaryOf(b.l, side) - primaryOf(a.l, side) ||
                str(a.l.name).localeCompare(str(b.l.name));
        };
    }
    function voteWord(n) { return n === 1 ? 'vote' : 'votes'; }
    // Text behind a count, e.g. "2 sponsored (1 primary), 1 vote for, 1 vote against anti".
    function breakdown(l, side, topic, n) {
        if (topic) {
            return fmt(n) + ' ' + SIDE_WORD[side] + ' act' + (n === 1 ? '' : 's') + ' on bills in ' + topicLabel(topic);
        }
        var pro = side === 'pro';
        var sp = pro ? num(l.pro_sponsored) : num(l.anti_sponsored);
        var pr = primaryOf(l, side);
        var vf = pro ? num(l.votes_for_pro) : num(l.votes_for_anti);
        var va = pro ? num(l.votes_against_anti) : num(l.votes_against_pro);
        return fmt(sp) + ' sponsored' + (pr ? ' (' + fmt(pr) + ' primary)' : '') + ', ' +
            fmt(vf) + ' ' + voteWord(vf) + ' for, ' +
            fmt(va) + ' ' + voteWord(va) + ' against ' + (pro ? 'anti' : 'pro');
    }
    // Table sub-line: "1 sponsored, 0 votes" (votes = for this side + against the other).
    function subline(l, side) {
        var pro = side === 'pro';
        var sp = pro ? num(l.pro_sponsored) : num(l.anti_sponsored);
        var v = pro ? num(l.votes_for_pro) + num(l.votes_against_anti) :
            num(l.votes_for_anti) + num(l.votes_against_pro);
        return fmt(sp) + ' sponsored, ' + fmt(v) + ' ' + voteWord(v);
    }
    function load(onOk, onErr) {
        fetch(DATA_URL).then(function (r) {
            if (!r.ok) throw new Error(DATA_URL + ' HTTP ' + r.status);
            return r.json();
        }).then(onOk).catch(onErr);
    }
    function stamp(prefix, data) {
        var upd = dateLabel(data && data.generated_at);
        setText('sb-label', prefix + (upd ? ' - UPDATED ' + upd : ''));
        return upd;
    }

    // ============================================
    // Page
    // ============================================
    function init() {
        var all = [], filtered = [], shown = 0;
        var selState = $('sf-state'), selLevel = $('sf-level'), selChamber = $('sf-chamber'),
            selParty = $('sf-party'), selTopic = $('sf-topic'), chkAll = $('sf-all');
        var radios = document.querySelectorAll('input[name="sf-view"]');
        var tbody = $('sc-rows'), moreBtn = $('sc-more');
        if (!tbody || !selState || !selTopic || !radios.length) return;

        function currentView() {
            for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
            return DEFAULT_VIEW;
        }
        function setView(v) {
            for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === v;
        }
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
                Object.keys(l.by_topic || {}).forEach(function (t) {
                    if (t && !seen[t]) { seen[t] = true; out.push(t); }
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

        // A count is always a link to the record it is counted from.
        function countLink(l, side, n, topic, cls) {
            var a = el('a', cls, fmt(n));
            a.href = recordHref(l.slug);
            var t = breakdown(l, side, topic, n);
            a.title = t;
            a.setAttribute('aria-label', fmt(n) + ' ' + SIDE_WORD[side] + ' act' + (n === 1 ? '' : 's') +
                ' for ' + str(l.name) + ': ' + t + '. Opens the legislative record.');
            return a;
        }

        function boardRow(item, rank, side, topic) {
            var l = item.l;
            var li = document.createElement('li');
            li.appendChild(el('span', 'rank', String(rank)));
            var who = el('span', 'who');
            var a = el('a', 'name', str(l.name));
            a.href = recordHref(l.slug);
            who.appendChild(a);
            who.appendChild(el('span', 'sub', officeLine(l)));
            li.appendChild(who);
            li.appendChild(el('span', 'party', str(l.party)));
            li.appendChild(countLink(l, side, item[side], topic, 'n'));
            return li;
        }
        function renderBoard(side, topic, view) {
            var list = $('lb-' + side + '-list'), card = $('lb-' + side);
            var top = filtered.filter(function (r) { return r[side] > 0; }).sort(bySide(side)).slice(0, TOP_N);
            clear(list);
            var sparse = top.length < MIN_BOARD;
            show('lb-' + side + '-sparse', sparse);
            show('lb-' + side + '-list', !sparse);
            if (!sparse) {
                var frag = document.createDocumentFragment();
                top.forEach(function (r, i) { frag.appendChild(boardRow(r, i + 1, side, topic)); });
                list.appendChild(frag);
            }
            if (card) card.className = 'card lb' + (view === side ? ' active' : '');
        }

        function row(item, rank, topic, view) {
            var l = item.l;
            var tr = document.createElement('tr');
            // Rank only means something for rows with at least one act in the current view.
            var rankTd = el('td', 'rank', item[view] > 0 ? fmt(rank) : '');
            if (!(item[view] > 0)) rankTd.setAttribute('aria-label', 'Unranked');
            tr.appendChild(rankTd);
            var td = el('td');
            var a = el('a', 'name', str(l.name));
            a.href = recordHref(l.slug);
            td.appendChild(a);
            tr.appendChild(td);

            td = el('td', null, str(l.office));
            td.appendChild(el('span', 'rec-sub', placeLabel(l)));
            tr.appendChild(td);

            tr.appendChild(el('td', null, str(l.party)));

            SIDES.forEach(function (side) {
                var c = el('td', 'num');
                c.appendChild(countLink(l, side, item[side], topic, 'tot'));
                // Sub-line only when there is something to break down (records.js does the same for votes).
                if (!topic && item[side] > 0) c.appendChild(el('span', 'rec-sub', subline(l, side)));
                tr.appendChild(c);
            });

            td = el('td', 'net');
            var n = el('a', null, signed(item.net));
            n.href = recordHref(l.slug);
            n.title = 'Pro-science acts minus anti-science acts';
            td.appendChild(n);
            tr.appendChild(td);

            return tr;
        }

        function renderMore() {
            var topic = selTopic.value, view = currentView();
            var frag = document.createDocumentFragment();
            var end = Math.min(filtered.length, shown + PAGE_SIZE);
            for (var i = shown; i < end; i++) frag.appendChild(row(filtered[i], i + 1, topic, view));
            tbody.appendChild(frag);
            shown = end;
            setText('sc-count', 'Showing ' + fmt(shown) + ' of ' + plural(filtered.length, 'legislator') +
                (topic ? ' (topic: ' + topicLabel(topic) + ')' : ''));
            show('sc-tablewrap', filtered.length > 0);
            show('sc-empty', filtered.length === 0);
            show('sc-more', shown < filtered.length);
        }

        // Deep-link state: the controls mirror ?view=&topic=&state=&level=&chamber=&party=
        // so a shared URL lands on the same view. Unknown params are kept.
        function syncUrl(q) {
            if (!window.history || !window.history.replaceState) return;
            var cur = parseQuery(window.location.search);
            Object.keys(q).forEach(function (k) { cur[k] = q[k]; });
            var next = window.location.pathname + buildQuery(cur) + window.location.hash;
            if (next !== window.location.pathname + window.location.search + window.location.hash) {
                window.history.replaceState(null, '', next);
            }
        }
        function readUrl() {
            var init = parseQuery(window.location.search);
            if (init.view === 'pro' || init.view === 'anti') setView(init.view);
            if (init.level && hasOption(selLevel, init.level)) selLevel.value = init.level;
            if (init.state && hasOption(selState, init.state)) selState.value = init.state;
            if (init.chamber && hasOption(selChamber, init.chamber)) selChamber.value = init.chamber;
            if (init.party && hasOption(selParty, init.party)) selParty.value = init.party;
            if (init.topic && hasOption(selTopic, init.topic)) selTopic.value = init.topic;
        }

        function applyFilters() {
            var view = currentView();
            var st = selState.value, lv = selLevel.value, ch = selChamber.value, pa = selParty.value,
                tp = selTopic.value, includeAll = chkAll.checked;
            filtered = [];
            all.forEach(function (l) {
                if (st && str(l.state) !== st) return;
                if (lv && str(l.level) !== lv) return;
                if (ch && str(l.chamber) !== ch) return;
                if (pa && str(l.party) !== pa) return;
                var c = counts(l, tp);
                if (!c) return;
                if (!includeAll && !c.pro && !c.anti) return;
                filtered.push({ l: l, pro: c.pro, anti: c.anti, net: c.pro - c.anti });
            });
            renderBoard('pro', tp, view);
            renderBoard('anti', tp, view);
            filtered.sort(bySide(view));
            setText('sc-table-title', 'Ranked by ' + SIDE_WORD[view] + ' acts' + (tp ? ': ' + topicLabel(tp) : ''));
            shown = 0;
            clear(tbody);
            renderMore();
            syncUrl({ view: view, topic: tp, state: st, level: lv, chamber: ch, party: pa });
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
            var nWith = typeof s.with_classified_activity === 'number' ? s.with_classified_activity :
                all.filter(function (l) { return num(l.pro_acts) > 0 || num(l.anti_acts) > 0; }).length;
            var nPro = typeof s.pro_acts === 'number' ? s.pro_acts :
                all.reduce(function (acc, l) { return acc + num(l.pro_acts); }, 0);
            var nAnti = typeof s.anti_acts === 'number' ? s.anti_acts :
                all.reduce(function (acc, l) { return acc + num(l.anti_acts); }, 0);
            var upd = stamp('SCIENCE SCORECARD', data);
            setText('sc-summary', fmt(nLeg) + ' LEGISLATORS ON FILE - ' + fmt(nWith) +
                ' WITH CLASSIFIED ACTIVITY - ' + fmt(nPro) + ' PRO-SCIENCE ACTS - ' +
                fmt(nAnti) + ' ANTI-SCIENCE ACTS' + (upd ? ' - UPDATED ' + upd : ''));
            var method = str(data.method);
            setText('sc-method', method);
            show('sc-method', !!method);
            show('sc-loading', false);

            readUrl();
            [selState, selLevel, selChamber, selParty, selTopic, chkAll].forEach(function (c) {
                c.addEventListener('change', applyFilters);
            });
            for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', applyFilters);
            moreBtn.addEventListener('click', renderMore);
            applyFilters();
        }, function (e) {
            console.warn('scorecard:', e);
            show('sc-loading', false);
            show('sc-error', true);
            setText('sb-label', 'SCORECARD DATA TEMPORARILY UNAVAILABLE');
        });
    }

    if (document.body && document.body.getAttribute('data-page') === 'scorecard') init();
})();
