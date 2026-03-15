// ============================================
// SAFE Action - Main Page (Impact + Victory + Ticker)
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initImpactCounters();
    initDatabaseStats();
    initVictoryBoard();
    initPledgeTicker();

    // --- Impact Counters ---
    function initImpactCounters() {
        // Load stored action counts (localStorage for demo, Firebase in production)
        const stored = getActionCounts();
        updateCounterDisplay('impact-actions', stored.total);
        updateCounterDisplay('impact-emails', stored.emails);
        updateCounterDisplay('impact-calls', stored.calls);
        updateCounterDisplay('impact-engaged', 423);

        // Reps contacted = known baseline, grows as platform usage increases
        updateCounterDisplay('impact-reps', 428);

        // Load bill count from data file (async)
        LegislationAPI.getLegislation(null).then(bills => {
            const active = bills.filter(b => b.isActive === 'Yes').length;
            const count = active || bills.length;
            updateCounterDisplay('impact-bills', count);
            // Re-animate just this counter since data arrived async
            const el = document.getElementById('impact-bills');
            if (el) animateSingleCounter(el.querySelector('.counter'), count);
        }).catch(() => {});

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

    function animateSingleCounter(counter, target) {
        if (!counter || !target) return;
        counter.dataset.target = target; // store real target for observers
        const duration = 1500;
        const startTime = performance.now();
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            counter.textContent = Math.floor(target * eased).toLocaleString();
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    function animateCounters() {
        document.querySelectorAll('.counter').forEach(counter => {
            const target = parseInt(counter.textContent.replace(/,/g, ''));
            if (!target) return; // skip counters that haven't loaded yet
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

    // --- Database Stats Section ---
    function initDatabaseStats() {
        // Load seats.json to compute live database stats
        fetch('data/seats.json?v=62')
            .then(r => r.json())
            .then(data => {
                var seats = data.seats || [];
                var totalSeats = seats.length;

                // Count unique people across all formats, merging email status
                // A person appearing as both incumbent (no email) and incumbents[] (with email)
                // should count as having email
                var globalSeen = {}; // state|name -> {hasEmail: bool}
                seats.forEach(function(seat) {
                    var localPeople = {}; // name -> hasEmail (within this seat)
                    function addPerson(p) {
                        if (!p || !p.name) return;
                        var n = p.name;
                        if (!localPeople[n]) localPeople[n] = false;
                        if (p.email) localPeople[n] = true;
                    }
                    // Singular incumbent
                    addPerson(seat.incumbent);
                    // Incumbents array
                    (seat.incumbents || []).forEach(addPerson);
                    // Candidates
                    (seat.candidates || []).forEach(addPerson);
                    // Merge into global
                    for (var name in localPeople) {
                        var key = seat.state + '|' + name;
                        if (!globalSeen[key]) {
                            globalSeen[key] = localPeople[name];
                        } else if (localPeople[name]) {
                            globalSeen[key] = true;
                        }
                    }
                });
                var totalPeople = 0, totalEmails = 0;
                for (var k in globalSeen) {
                    totalPeople++;
                    if (globalSeen[k]) totalEmails++;
                }

                updateCounterDisplay('db-people', totalPeople);
                updateCounterDisplay('db-emails', totalEmails);
                updateCounterDisplay('db-seats', totalSeats);

                // Bills — total count from LegislationAPI
                LegislationAPI.getLegislation(null).then(function(bills) {
                    updateCounterDisplay('db-bills', bills.length);
                    var el = document.getElementById('db-bills');
                    if (el) animateSingleCounter(el.querySelector('.counter'), bills.length);
                }).catch(function() {
                    updateCounterDisplay('db-bills', 200);
                });

                // Animate the rest when scrolling into view
                var el = document.getElementById('db-people');
                if (el) animateSingleCounter(el.querySelector('.counter'), totalPeople);
                el = document.getElementById('db-emails');
                if (el) animateSingleCounter(el.querySelector('.counter'), totalEmails);
                el = document.getElementById('db-seats');
                if (el) animateSingleCounter(el.querySelector('.counter'), totalSeats);
            })
            .catch(function() {
                // Fallback hardcoded values if fetch fails
                updateCounterDisplay('db-people', 13797);
                updateCounterDisplay('db-emails', 8500);
                updateCounterDisplay('db-seats', 6718);
                updateCounterDisplay('db-bills', 10455);
            });

        // Observe for scroll animation
        var dbSection = document.querySelector('.database-section');
        if (dbSection) {
            var observer = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        dbSection.querySelectorAll('.counter').forEach(function(counter) {
                            // Use stored target (set by animateSingleCounter) to avoid
                            // reading a mid-animation textContent value
                            var target = parseInt(counter.dataset.target) ||
                                         parseInt(counter.textContent.replace(/,/g, ''));
                            if (target) animateSingleCounter(counter, target);
                        });
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.2 });
            observer.observe(dbSection);
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
        const BASE_ACTIONS = 1128;
        const BASE_EMAILS = 743;
        const BASE_CALLS = 385;

        try {
            const stored = JSON.parse(localStorage.getItem('safe_action_counts'));
            if (stored && stored.total >= BASE_ACTIONS) return stored;
        } catch (e) {}

        return { total: BASE_ACTIONS, emails: BASE_EMAILS, calls: BASE_CALLS };
    }

    // --- Daily Goal Progress ---
    initDailyGoal();

    function initDailyGoal() {
        const goalSection = document.getElementById('daily-goal');
        if (!goalSection) return;

        function dateKey() {
            return new Date().toISOString().split('T')[0];
        }
        function weekKey() {
            var now = new Date();
            var day = now.getDay();
            var mon = new Date(now);
            mon.setDate(now.getDate() - ((day + 6) % 7));
            return mon.toISOString().split('T')[0];
        }

        function getDailyData() {
            try {
                var stored = JSON.parse(localStorage.getItem('safe_daily_actions'));
                if (stored && stored.date === dateKey()) return stored;
            } catch (e) {}
            return { date: dateKey(), emails: 0, calls: 0, total: 0 };
        }

        function getWeeklyData() {
            try {
                var stored = JSON.parse(localStorage.getItem('safe_weekly_actions'));
                if (stored && stored.week === weekKey()) return stored;
            } catch (e) {}
            return { week: weekKey(), emails: 0, calls: 0, total: 0 };
        }

        function getYesterdayData() {
            try {
                var stored = JSON.parse(localStorage.getItem('safe_yesterday_actions'));
                if (stored) return stored;
            } catch (e) {}
            return { date: '', emails: 0, calls: 0, total: 0 };
        }

        function getStreak() {
            try {
                var stored = JSON.parse(localStorage.getItem('safe_action_streak'));
                if (stored) return stored;
            } catch (e) {}
            return { days: 0, lastDate: '' };
        }

        var daily = getDailyData();
        var weekly = getWeeklyData();
        var yesterday = getYesterdayData();
        var streak = getStreak();

        var todayEmails = daily.emails || 0;
        var todayTotal = daily.total || 0;
        var weekTotal = weekly.total || 0;
        var yesterdayTotal = yesterday.total || 0;

        // Bar never reaches 100% — always show room for more
        // Use a moving target that's always ahead of current progress
        var barTarget = Math.max(todayTotal + 5, 10);
        var pct = Math.min(Math.round((todayTotal / barTarget) * 100), 85);
        // Ensure at least a small fill if they've done something
        if (todayTotal > 0 && pct < 15) pct = 15;

        goalSection.style.display = '';

        var fillEl = document.getElementById('daily-goal-fill');
        var pctEl = document.getElementById('daily-goal-pct');
        var streakEl = document.getElementById('daily-goal-streak');
        var statsEl = document.getElementById('daily-goal-stats');
        var msgEl = document.getElementById('daily-goal-message');
        var ctaEl = document.getElementById('daily-goal-cta');

        setTimeout(function() {
            fillEl.style.width = pct + '%';
        }, 300);

        // Show comparative stat instead of raw percentage
        if (todayTotal > 0 && yesterdayTotal > 0 && todayTotal > yesterdayTotal) {
            var upPct = Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100);
            pctEl.textContent = '+' + upPct + '%';
        } else if (todayTotal > 0) {
            pctEl.textContent = todayTotal + ' today';
        } else {
            pctEl.textContent = 'Start!';
        }

        if (streak.days > 1) {
            streakEl.textContent = streak.days + '-day streak';
        } else if (streak.days === 1) {
            streakEl.textContent = '1 day streak';
        } else {
            streakEl.style.display = 'none';
        }

        // Build stats with safe DOM methods
        statsEl.textContent = '';
        function addStat(boldText, normalText) {
            var s = document.createElement('span');
            s.className = 'daily-goal-stat';
            var b = document.createElement('strong');
            b.textContent = boldText;
            s.appendChild(b);
            s.appendChild(document.createTextNode(' ' + normalText));
            statsEl.appendChild(s);
        }

        // Only show personal stats if user has done something
        if (todayEmails > 0) addStat(todayEmails, 'emails today');
        if (weekTotal > 0) addStat(weekTotal, 'actions this week');

        // Comparative stat
        if (todayTotal > 0 && yesterdayTotal > 0 && todayTotal > yesterdayTotal) {
            var upPctStat = Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100);
            addStat('+' + upPctStat + '%', 'vs yesterday');
        } else if (todayTotal > 0 && yesterdayTotal > 0 && todayTotal === yesterdayTotal) {
            addStat('=', 'matching yesterday');
        }

        // Motivational message — always encouraging, never "done"
        var msg;
        if (todayTotal === 0) {
            var startMsgs = [
                'Every email to a legislator makes your voice heard. Start today!',
                'Your representatives need to hear from you. Send your first email!',
                'One email can tip the scales on a bill. Take action now!',
            ];
            msg = startMsgs[Math.floor(Math.random() * startMsgs.length)];
        } else if (todayTotal < 5) {
            var earlyMsgs = [
                'Great start! Keep going \u2014 every email builds momentum.',
                'You\'re making a difference! A few more emails amplifies your impact.',
                'Legislators pay attention to volume. Keep the pressure on!',
            ];
            msg = earlyMsgs[Math.floor(Math.random() * earlyMsgs.length)];
        } else if (todayTotal < 10) {
            var midMsgs = [
                'You\'re on a roll! Each email tells your rep that voters are watching.',
                'Impressive effort! More emails = louder voice for science.',
                'You\'re outpacing most activists. Keep this energy going!',
            ];
            msg = midMsgs[Math.floor(Math.random() * midMsgs.length)];
        } else {
            var highMsgs = [
                'Incredible impact! You\'re in the top tier of citizen advocates today.',
                'Your representatives are definitely hearing from you. Keep pushing!',
                'This kind of engagement changes votes. You\'re making history.',
                todayTotal + ' actions today \u2014 that\'s real political power. Don\'t stop!',
            ];
            msg = highMsgs[Math.floor(Math.random() * highMsgs.length)];
        }
        msgEl.textContent = msg;
    }

    // Patch trackAction to also update daily/weekly/streak data
    var origTrackAction = window.SAFE_ACTIONS.trackAction;
    window.SAFE_ACTIONS.trackAction = function(type) {
        var result = origTrackAction(type);

        var dk = new Date().toISOString().split('T')[0];
        var daily;
        try { daily = JSON.parse(localStorage.getItem('safe_daily_actions')); } catch(e) {}
        // Save yesterday's data when a new day starts
        if (daily && daily.date && daily.date !== dk) {
            localStorage.setItem('safe_yesterday_actions', JSON.stringify(daily));
        }
        if (!daily || daily.date !== dk) daily = { date: dk, emails: 0, calls: 0, total: 0 };
        daily.total++;
        if (type === 'email') daily.emails++;
        if (type === 'call') daily.calls++;
        localStorage.setItem('safe_daily_actions', JSON.stringify(daily));

        var now = new Date();
        var day = now.getDay();
        var mon = new Date(now);
        mon.setDate(now.getDate() - ((day + 6) % 7));
        var wk = mon.toISOString().split('T')[0];
        var weekly;
        try { weekly = JSON.parse(localStorage.getItem('safe_weekly_actions')); } catch(e) {}
        if (!weekly || weekly.week !== wk) weekly = { week: wk, emails: 0, calls: 0, total: 0 };
        weekly.total++;
        if (type === 'email') weekly.emails++;
        if (type === 'call') weekly.calls++;
        localStorage.setItem('safe_weekly_actions', JSON.stringify(weekly));

        var streak;
        try { streak = JSON.parse(localStorage.getItem('safe_action_streak')); } catch(e) {}
        if (!streak) streak = { days: 0, lastDate: '' };
        if (streak.lastDate !== dk) {
            var yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            var yd = yesterday.toISOString().split('T')[0];
            if (streak.lastDate === yd) {
                streak.days++;
            } else {
                streak.days = 1;
            }
            streak.lastDate = dk;
            localStorage.setItem('safe_action_streak', JSON.stringify(streak));
        }

        // Also report to Cloud Function for national counter
        fetch('/api/actions/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type })
        }).catch(function() { /* silent fail — localStorage already updated */ });

        return result;
    };

    // --- National Stats (real-time Firestore listener) ---
    function initNationalStats() {
        if (typeof firebase === 'undefined' || !SAFE_CONFIG || !SAFE_CONFIG.FIREBASE_CONFIG) return;

        try {
            // Initialize Firebase if not already done
            if (!firebase.apps.length) {
                firebase.initializeApp(SAFE_CONFIG.FIREBASE_CONFIG);
            }
            var db = firebase.firestore();

            var todayEl = document.getElementById('national-today-total');
            var emailsEl = document.getElementById('national-emails');
            var callsEl = document.getElementById('national-calls');
            var headlineEl = document.getElementById('momentum-headline');
            if (!todayEl) return;

            // Compute current date keys
            function dateKey() { return new Date().toISOString().split('T')[0]; }
            function weekKey() {
                var now = new Date();
                var day = now.getDay();
                var mon = new Date(now);
                mon.setDate(now.getDate() - ((day + 6) % 7));
                return mon.toISOString().split('T')[0];
            }

            var lastValues = {};

            // Real-time listener
            db.collection('actionStats').doc('counters').onSnapshot(function(doc) {
                if (!doc.exists) {
                    if (headlineEl) headlineEl.textContent = 'Be the first to defend science today';
                    return;
                }

                var data = doc.data();
                var dk = dateKey();
                var wk = weekKey();

                var todayTotal = (data['daily_' + dk + '_total'] || 0);
                var weekTotal = (data['weekly_' + wk + '_total'] || 0);
                var allTimeTotal = (data['allTime_total'] || 0);

                // Animate tick effect when number changes
                function updateStat(el, key, val) {
                    var formatted = val.toLocaleString();
                    if (lastValues[key] !== undefined && lastValues[key] !== val) {
                        el.classList.add('tick');
                        setTimeout(function() { el.classList.remove('tick'); }, 600);
                    }
                    el.textContent = formatted;
                    lastValues[key] = val;
                }

                // Emails and calls breakdown
                var todayEmails = (data['daily_' + dk + '_emails'] || 0);
                var todayCalls = (data['daily_' + dk + '_calls'] || 0);

                updateStat(todayEl, 'today', todayTotal);
                if (emailsEl) updateStat(emailsEl, 'emails', todayEmails);
                if (callsEl) updateStat(callsEl, 'calls', todayCalls);

                // Daily goal progress bar — target grows as people hit it
                var progressFill = document.getElementById('momentum-progress-fill');
                var progressLabel = document.getElementById('momentum-progress-label');
                if (progressFill && progressLabel) {
                    // Dynamic target: round up to nearest milestone
                    var dailyGoal;
                    if (todayTotal < 25) dailyGoal = 25;
                    else if (todayTotal < 50) dailyGoal = 50;
                    else if (todayTotal < 100) dailyGoal = 100;
                    else if (todayTotal < 250) dailyGoal = 250;
                    else if (todayTotal < 500) dailyGoal = 500;
                    else if (todayTotal < 1000) dailyGoal = 1000;
                    else dailyGoal = Math.ceil(todayTotal / 500) * 500 + 500;

                    var pct = Math.min(Math.round((todayTotal / dailyGoal) * 100), 100);
                    if (todayTotal > 0 && pct < 5) pct = 5;

                    setTimeout(function() {
                        progressFill.style.width = pct + '%';
                    }, 300);
                    progressLabel.textContent = todayTotal.toLocaleString() + ' / ' + dailyGoal.toLocaleString();
                }

                // Dynamic headline based on activity
                if (headlineEl) {
                    if (todayTotal >= 50) {
                        headlineEl.textContent = 'Americans are defending science right now';
                    } else if (todayTotal >= 10) {
                        headlineEl.textContent = 'Momentum is building \u2014 join the movement';
                    } else if (todayTotal >= 1) {
                        headlineEl.textContent = 'People are taking action today \u2014 join them';
                    } else if (allTimeTotal > 0) {
                        headlineEl.textContent = 'A growing movement for science';
                    }
                }
            }, function(err) {
                console.warn('National stats listener error:', err);
            });
        } catch (e) {
            console.warn('Failed to init national stats:', e);
        }
    }

    initNationalStats();

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
            let candidates = [];
            try { candidates = await SheetsAPI.getCandidates(); } catch (e) {}

            if (candidates.length === 0) {
                // Demo pledges for ticker preview
                candidates = [
                    { id: 'demo-1', firstName: 'Sarah', lastName: 'Mitchell', party: 'Democrat', office: 'State Senator', state: 'CA', timestamp: '2026-03-10' },
                    { id: 'demo-2', firstName: 'James', lastName: 'Rodriguez', party: 'Republican', office: 'State Representative', state: 'TX', timestamp: '2026-03-09' },
                    { id: 'demo-3', firstName: 'Emily', lastName: 'Chen', party: 'Democrat', office: 'City Council', state: 'NY', timestamp: '2026-03-08' },
                    { id: 'demo-4', firstName: 'Robert', lastName: 'Thompson', party: 'Independent', office: 'County Commissioner', state: 'FL', timestamp: '2026-03-07' },
                    { id: 'demo-5', firstName: 'Maria', lastName: 'Gonzalez', party: 'Democrat', office: 'School Board', state: 'AZ', timestamp: '2026-03-06' },
                ];
            }

            // Sort by timestamp (most recent first), cap at 20
            const sorted = [...candidates]
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 20);

            const itemsHtml = sorted.map(c => {
                const stateName = c.state ? (SAFE_CONFIG.STATES[c.state] || c.state) : '';
                const first = (c.firstName || '').toLowerCase().trim();
                const last = (c.lastName || '').toLowerCase().trim();
                const slug = (first + '-' + last).replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                const href = '/candidate?slug=' + encodeURIComponent(slug);
                return `
                    <a href="${href}" class="pledge-ticker-item">
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
