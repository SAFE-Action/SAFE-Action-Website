/**
 * SAFE Action Live Dashboard
 * Real-time action tracking with US map visualization and activity feed.
 * Connects to Firebase Firestore for live updates.
 */

// Firebase initialization
var firebaseConfig = {
    apiKey: 'AIzaSyDQul9vsl7oEj43VSlzLi_S4SXrm3liZWc',
    authDomain: 'safe-action-website.firebaseapp.com',
    projectId: 'safe-action-website',
    storageBucket: 'safe-action-website.firebasestorage.app',
    messagingSenderId: '1035666846416',
    appId: '1:1035666846416:web:1c0bac14e6569b4f41a4d5'
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// State tracking
var initialLoadDone = false;
var audioCtx = null;
var isMuted = false;

// State centroid coordinates for SVG viewBox "0 0 960 600"
var STATE_COORDS = {
    'AL': {x: 680, y: 420},
    'AK': {x: 150, y: 530},
    'AZ': {x: 210, y: 410},
    'AR': {x: 600, y: 400},
    'CA': {x: 105, y: 350},
    'CO': {x: 310, y: 320},
    'CT': {x: 870, y: 210},
    'DE': {x: 840, y: 280},
    'FL': {x: 760, y: 500},
    'GA': {x: 730, y: 430},
    'HI': {x: 300, y: 540},
    'ID': {x: 195, y: 190},
    'IL': {x: 620, y: 300},
    'IN': {x: 660, y: 290},
    'IA': {x: 560, y: 250},
    'KS': {x: 470, y: 340},
    'KY': {x: 700, y: 330},
    'LA': {x: 600, y: 470},
    'ME': {x: 900, y: 120},
    'MD': {x: 830, y: 280},
    'MA': {x: 880, y: 195},
    'MI': {x: 670, y: 220},
    'MN': {x: 530, y: 170},
    'MS': {x: 640, y: 440},
    'MO': {x: 570, y: 340},
    'MT': {x: 280, y: 140},
    'NE': {x: 450, y: 280},
    'NV': {x: 155, y: 310},
    'NH': {x: 880, y: 160},
    'NJ': {x: 855, y: 260},
    'NM': {x: 270, y: 410},
    'NY': {x: 840, y: 190},
    'NC': {x: 780, y: 360},
    'ND': {x: 440, y: 150},
    'OH': {x: 710, y: 270},
    'OK': {x: 480, y: 390},
    'OR': {x: 120, y: 170},
    'PA': {x: 810, y: 240},
    'RI': {x: 885, y: 205},
    'SC': {x: 770, y: 400},
    'SD': {x: 440, y: 210},
    'TN': {x: 690, y: 370},
    'TX': {x: 440, y: 460},
    'UT': {x: 225, y: 320},
    'VT': {x: 870, y: 150},
    'VA': {x: 790, y: 310},
    'WA': {x: 130, y: 100},
    'WV': {x: 760, y: 300},
    'WI': {x: 590, y: 190},
    'WY': {x: 300, y: 230},
    'DC': {x: 820, y: 290}
};

// ---------------------
// Map Rendering — Stacking Dots
// ---------------------

// Track per-state action counts and types
var stateActions = {};

function getStateColor(stateData) {
    if (stateData.emails > 0 && stateData.calls > 0) return 'mixed';
    if (stateData.calls > 0) return 'call';
    return 'email';
}

function getDotRadius(count) {
    // Base radius 30, grows with count, caps at 60
    if (count <= 1) return 30;
    if (count <= 3) return 38;
    if (count <= 6) return 44;
    if (count <= 10) return 50;
    if (count <= 20) return 56;
    return 60;
}

function addActionToMap(data) {
    var coords = STATE_COORDS[data.state];
    if (!coords) return;

    var svg = document.getElementById('us-map');
    if (!svg) return;
    var ns = 'http://www.w3.org/2000/svg';

    // Update state action tracker
    if (!stateActions[data.state]) {
        stateActions[data.state] = { emails: 0, calls: 0, total: 0, dot: null, label: null };
    }
    var st = stateActions[data.state];
    if (data.type === 'call') { st.calls++; } else { st.emails++; }
    st.total++;

    var colorType = getStateColor(st);
    var radius = getDotRadius(st.total);

    // Create or update the dot for this state
    if (!st.dot) {
        // Create new dot
        st.dot = document.createElementNS(ns, 'circle');
        st.dot.setAttribute('cx', coords.x);
        st.dot.setAttribute('cy', coords.y);
        st.dot.setAttribute('class', 'map-dot map-dot-' + colorType);
        svg.appendChild(st.dot);

        // Create count label
        st.label = document.createElementNS(ns, 'text');
        st.label.setAttribute('x', coords.x);
        st.label.setAttribute('y', coords.y);
        st.label.setAttribute('class', 'map-count');
        svg.appendChild(st.label);
    }

    // Update dot size and color
    st.dot.setAttribute('r', radius);
    st.dot.setAttribute('class', 'map-dot map-dot-' + colorType);

    // Update count label (show count when > 1)
    if (st.total > 1) {
        st.label.textContent = st.total;
        st.label.style.fontSize = (radius > 44 ? 24 : 18) + 'px';
    }

    // Highlight the state path
    var stateEl = document.getElementById(data.state);
    if (stateEl) {
        if (st.total >= 5) {
            stateEl.classList.add('hot');
        } else {
            stateEl.classList.add('has-activity');
        }
    }

    // Add ripple animation (only after initial load)
    if (initialLoadDone) {
        var ripple = document.createElementNS(ns, 'circle');
        ripple.setAttribute('cx', coords.x);
        ripple.setAttribute('cy', coords.y);
        ripple.setAttribute('r', String(radius));
        ripple.setAttribute('class', 'map-ripple map-ripple-' + colorType);
        svg.appendChild(ripple);
        setTimeout(function() { ripple.remove(); }, 1700);
    }
}

// ---------------------
// Activity Feed
// ---------------------

function buildFeedItem(data) {
    var item = document.createElement('div');
    item.className = 'feed-item' + (initialLoadDone ? ' feed-item-new' : '');

    var iconSpan = document.createElement('span');
    iconSpan.className = 'feed-icon';
    iconSpan.textContent = data.type === 'email' ? '\u2709\uFE0F' : '\uD83D\uDCDE';

    var contentDiv = document.createElement('div');
    contentDiv.className = 'feed-content';

    var city = (data.city || 'Unknown') + (data.state ? ', ' + data.state : '');
    var cityDiv = document.createElement('div');
    cityDiv.className = 'feed-city';
    cityDiv.textContent = city;
    contentDiv.appendChild(cityDiv);

    if (data.repName) {
        var repDiv = document.createElement('div');
        repDiv.className = 'feed-rep';
        repDiv.textContent = '\u2192 ' + data.repName;
        contentDiv.appendChild(repDiv);
    }

    var bill = data.billTitle || '';
    if (bill) {
        if (bill.length > 40) bill = bill.substring(0, 37) + '...';
        var billDiv = document.createElement('div');
        billDiv.className = 'feed-bill';
        billDiv.textContent = bill;
        contentDiv.appendChild(billDiv);
    }

    item.appendChild(iconSpan);
    item.appendChild(contentDiv);
    return item;
}

function addActionToFeed(data) {
    var feed = document.getElementById('activity-feed');
    if (!feed) return;

    // Hide empty state
    var emptyEl = document.getElementById('feed-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    var item = buildFeedItem(data);

    // During initial load, append (docs arrive newest-first, so append keeps that order)
    // After initial load, insert at top so new events appear first
    if (initialLoadDone) {
        feed.insertBefore(item, feed.firstChild);
    } else {
        feed.appendChild(item);
    }

    // Limit feed to 50 items
    while (feed.children.length > 50) {
        feed.removeChild(feed.lastChild);
    }
}

// ---------------------
// Counter Updates
// ---------------------

function updateCounters(stats) {
    var emailsEl = document.getElementById('counter-emails');
    var callsEl = document.getElementById('counter-calls');
    var totalEl = document.getElementById('counter-total');

    if (emailsEl) {
        if (emailsEl.textContent !== '' + stats.emails) {
            emailsEl.textContent = stats.emails;
            bumpCounter(emailsEl);
        }
    }
    if (callsEl) {
        if (callsEl.textContent !== '' + stats.calls) {
            callsEl.textContent = stats.calls;
            bumpCounter(callsEl);
        }
    }
    if (totalEl) {
        if (totalEl.textContent !== '' + stats.total) {
            totalEl.textContent = stats.total;
            bumpCounter(totalEl);
        }
    }

    // Update progress bar with dynamic goal
    var goals = [25, 50, 100, 250, 500, 1000, 2500, 5000];
    var goal = 25;
    for (var i = 0; i < goals.length; i++) {
        if (stats.total < goals[i]) { goal = goals[i]; break; }
        if (i === goals.length - 1) goal = goals[i];
    }
    var pct = Math.min(100, (stats.total / goal) * 100);

    var progressFill = document.getElementById('progress-fill');
    var progressLabel = document.getElementById('progress-label');
    if (progressFill) {
        progressFill.style.width = pct + '%';
        if (pct >= 80) {
            progressFill.classList.add('near-goal');
        } else {
            progressFill.classList.remove('near-goal');
        }
    }
    if (progressLabel) progressLabel.textContent = stats.total + ' / ' + goal;
}

// ---------------------
// Sound Effects (Web Audio API)
// ---------------------

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(freq, duration, waveType) {
    if (!audioCtx) return;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = waveType;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + duration);
}

function playSound(type) {
    if (isMuted || !initialLoadDone) return;
    initAudio();
    if (!audioCtx) return;

    if (type === 'email') {
        // Short bright ping
        playTone(880, 0.1, 'sine');
    } else if (type === 'call') {
        // Phone ring - two tones
        playTone(440, 0.15, 'sine');
        setTimeout(function() { playTone(550, 0.15, 'sine'); }, 200);
    }
}

function playFanfare() {
    if (isMuted) return;
    initAudio();
    if (!audioCtx) return;
    var notes = [523, 659, 784, 1047];
    notes.forEach(function(freq, i) {
        setTimeout(function() { playTone(freq, 0.3, 'triangle'); }, i * 150);
    });
}

// ---------------------
// Pledge Takeover
// ---------------------

function showPledgeTakeover(pledgeData) {
    var overlay = document.getElementById('pledge-overlay');
    if (!overlay) return;

    var name = pledgeData.name || 'An Elected Official';
    var title = pledgeData.title || '';
    var party = pledgeData.party || '';
    var state = pledgeData.state || '';

    var nameEl = document.getElementById('pledge-name');
    var titleEl = document.getElementById('pledge-title');

    if (nameEl) nameEl.textContent = name;
    if (titleEl) titleEl.textContent = [title, party, state].filter(Boolean).join(' \u00B7 ');

    overlay.classList.add('active');
    playFanfare();

    setTimeout(function() {
        overlay.classList.remove('active');
    }, 8000);
}

// ---------------------
// Utility
// ---------------------

function bumpCounter(el) {
    el.classList.remove('bump');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(function() { el.classList.remove('bump'); }, 400);
}

function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------
// Firestore Listeners
// ---------------------

function startActionEventsListener() {
    db.collection('actionEvents')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .onSnapshot(function(snapshot) {
            snapshot.docChanges().forEach(function(change) {
                if (change.type === 'added') {
                    var data = change.doc.data();
                    addActionToMap(data);
                    addActionToFeed(data);
                    playSound(data.type);
                }
            });
        });
}

function startActionStatsListener() {
    db.collection('actionStats').doc('counters')
        .onSnapshot(function(doc) {
            var data = doc.data();
            if (!data) return;
            var dk = data.currentDayKey || new Date().toISOString().split('T')[0];
            updateCounters({
                emails: data['daily_' + dk + '_emails'] || 0,
                calls: data['daily_' + dk + '_calls'] || 0,
                total: data['daily_' + dk + '_total'] || 0
            });
        });
}

// ---------------------
// Initialization
// ---------------------

document.addEventListener('DOMContentLoaded', function() {
    // Set up mute button
    var muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', function() {
            isMuted = !isMuted;
            this.textContent = isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
            this.title = isMuted ? 'Unmute' : 'Mute';
        });
    }

    // Start Firestore listeners
    startActionEventsListener();
    startActionStatsListener();

    // After 2-second delay, mark initial load as done
    // so subsequent events trigger animations and sounds
    setTimeout(function() {
        initialLoadDone = true;
    }, 2000);
});
