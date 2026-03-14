// SAFE Action - Admin Queue
// Uses Firebase Auth + Firestore for bill approval workflow
(function() {
    var auth, db, provider;
    var currentUser = null;
    var currentTab = 'pending';
    var allBills = [];
    var selectedBillId = null;
    var unsubscribe = null;

    // Volunteer management
    var currentSection = 'bills';
    var currentVTab = 'pending';
    var allVolunteers = [];
    var selectedVolunteerId = null;
    var vUnsubscribe = null;

    function esc(s) { return String(s || ''); }

    function init() {
        if (!SAFE_CONFIG.FIREBASE_CONFIG) {
            console.error('Firebase not configured in js/config.js');
            return;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(SAFE_CONFIG.FIREBASE_CONFIG);
            }
        } catch (e) {
            console.error('Firebase init:', e);
            return;
        }
        auth = firebase.auth();
        db = firebase.firestore();
        provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        // Handle redirect result (fallback for when popup was blocked)
        auth.getRedirectResult().then(function(result) {
            if (result && result.user) console.log('Redirect sign-in:', result.user.email);
        }).catch(function(e) {
            if (e.code !== 'auth/credential-already-in-use') console.error('Redirect error:', e);
        });

        auth.onAuthStateChanged(onAuthChanged);

        document.getElementById('login-btn').addEventListener('click', function() {
            auth.signInWithPopup(provider).catch(function(e) {
                if (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request') {
                    console.log('Popup blocked, falling back to redirect');
                    auth.signInWithRedirect(provider);
                } else if (e.code !== 'auth/popup-closed-by-user') {
                    console.error('Sign-in error:', e);
                }
            });
        });
        document.getElementById('logout-btn').addEventListener('click', function() {
            auth.signOut();
        });
        document.getElementById('denied-back-btn').addEventListener('click', function() {
            auth.signOut();
        });

        document.querySelectorAll('[data-tab]').forEach(function(tab) {
            tab.addEventListener('click', function() { switchTab(this.dataset.tab); });
        });

        document.getElementById('filter-state').addEventListener('change', renderQueue);
        document.getElementById('filter-category').addEventListener('change', renderQueue);
        document.getElementById('filter-search').addEventListener('input', renderQueue);

        // Section switcher
        document.querySelectorAll('.admin-section-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchSection(this.dataset.section);
            });
        });

        // Volunteer tab listeners
        document.querySelectorAll('[data-vtab]').forEach(function(tab) {
            tab.addEventListener('click', function() { switchVTab(this.dataset.vtab); });
        });

        populateStates();
    }

    function showScreen(name) {
        var screens = { login: 'auth-login', denied: 'auth-denied', loading: 'auth-loading', app: 'admin-app' };
        Object.keys(screens).forEach(function(k) {
            document.getElementById(screens[k]).style.display = (k === name) ? '' : 'none';
        });
    }

    function onAuthChanged(user) {
        if (!user) { showScreen('login'); return; }
        showScreen('loading');
        db.collection('admins').doc(user.email).get().then(function(doc) {
            if (doc.exists) {
                currentUser = user;
                document.getElementById('user-email').textContent = user.email;
                showScreen('app');
                startListening();
            } else {
                document.getElementById('denied-email').textContent = user.email;
                showScreen('denied');
            }
        }).catch(function() {
            document.getElementById('denied-email').textContent = user.email;
            showScreen('denied');
        });
    }

    function startListening() {
        if (unsubscribe) unsubscribe();
        unsubscribe = db.collection('queue_bills').orderBy('queuedAt', 'desc')
            .onSnapshot(function(snap) {
                allBills = [];
                snap.forEach(function(d) { allBills.push(Object.assign({ id: d.id }, d.data())); });
                updateCounts();
                renderQueue();
            }, function(err) { console.error('Listener:', err); });
    }

    function updateCounts() {
        var c = { pending: 0, approved: 0, denied: 0 };
        allBills.forEach(function(b) { var s = b.queueStatus || 'pending'; if (c[s] !== undefined) c[s]++; });
        document.getElementById('count-pending').textContent = c.pending;
        document.getElementById('count-approved').textContent = c.approved;
        document.getElementById('count-denied').textContent = c.denied;
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('[data-tab]').forEach(function(t) {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        selectedBillId = null;
        showPlaceholder();
        renderQueue();
    }

    function getFiltered() {
        var sf = document.getElementById('filter-state').value;
        var cf = document.getElementById('filter-category').value;
        var tf = document.getElementById('filter-search').value.toLowerCase();
        return allBills.filter(function(b) {
            if ((b.queueStatus || 'pending') !== currentTab) return false;
            if (sf && b.state !== sf) return false;
            if (cf && b.category !== cf) return false;
            if (tf && ((b.title || '') + ' ' + (b.billNumber || '') + ' ' + (b.summary || '')).toLowerCase().indexOf(tf) === -1) return false;
            return true;
        });
    }

    function renderQueue() {
        var list = document.getElementById('queue-list');
        var empty = document.getElementById('queue-empty');
        list.querySelectorAll('.admin-queue-card').forEach(function(c) { c.remove(); });
        var bills = getFiltered();
        empty.style.display = bills.length === 0 ? '' : 'none';
        bills.forEach(function(b) { list.appendChild(makeCard(b)); });
    }

    function makeCard(bill) {
        var card = document.createElement('div');
        card.className = 'admin-queue-card' + (bill.id === selectedBillId ? ' selected' : '');
        card.addEventListener('click', function() { selectedBillId = bill.id; renderQueue(); renderDetail(bill); });

        var hdr = document.createElement('div');
        hdr.className = 'admin-card-header';
        var num = document.createElement('span');
        num.className = 'admin-card-billnum';
        num.textContent = esc(bill.billNumber || bill.billId);
        hdr.appendChild(num);
        var badge = document.createElement('span');
        badge.className = 'admin-card-badge badge-' + (bill.classifierBillType || 'anti');
        badge.textContent = (bill.classifierBillType || 'anti').toUpperCase();
        hdr.appendChild(badge);
        card.appendChild(hdr);

        var ttl = document.createElement('div');
        ttl.className = 'admin-card-title';
        ttl.textContent = esc(bill.title || 'Untitled');
        card.appendChild(ttl);

        var meta = document.createElement('div');
        meta.className = 'admin-card-meta';
        var st = document.createElement('span');
        st.textContent = esc(bill.state);
        meta.appendChild(st);
        if (bill.queuedAt) {
            var tm = document.createElement('span');
            tm.textContent = timeAgo(bill.queuedAt);
            meta.appendChild(tm);
        }
        card.appendChild(meta);
        return card;
    }

    function showPlaceholder() {
        document.getElementById('detail-placeholder').style.display = '';
        document.getElementById('detail-content').style.display = 'none';
    }

    function renderDetail(bill) {
        document.getElementById('detail-placeholder').style.display = 'none';
        var el = document.getElementById('detail-content');
        el.style.display = '';
        while (el.firstChild) el.removeChild(el.firstChild);

        // Title
        var sec1 = mkSection(el);
        var h2 = document.createElement('h2');
        h2.className = 'admin-detail-title';
        h2.textContent = esc(bill.title);
        sec1.appendChild(h2);

        var metaRow = document.createElement('div');
        metaRow.className = 'admin-detail-meta';
        addMeta(metaRow, 'Bill', bill.billNumber || bill.billId);
        addMeta(metaRow, 'State', SAFE_CONFIG.STATES[bill.state] || bill.state);
        addMeta(metaRow, 'Status', bill.status);
        addMeta(metaRow, 'Category', bill.category);
        addMeta(metaRow, 'Level', bill.level);
        sec1.appendChild(metaRow);

        // Sponsors
        if (bill.sponsors && bill.sponsors.length) {
            var sec2 = mkSection(el, 'Sponsors');
            bill.sponsors.forEach(function(s) {
                var sp = document.createElement('div');
                sp.className = 'admin-sponsor';
                var txt = typeof s === 'string' ? s : (s.name || '');
                if (s.party) txt += ' (' + s.party + ')';
                if (s.role) txt += ' \u2014 ' + s.role;
                sp.textContent = txt;
                sec2.appendChild(sp);
            });
        }

        // Why Flagged
        var sec3 = mkSection(el, 'Why Flagged');
        sec3.classList.add('admin-flag-section');
        if (bill.classifierReasoning) {
            var p = document.createElement('p');
            p.className = 'admin-reasoning';
            p.textContent = esc(bill.classifierReasoning);
            sec3.appendChild(p);
        }
        if (bill.classifierScore) {
            var sc = document.createElement('div');
            sc.className = 'admin-score';
            sc.textContent = 'Score: ' + (bill.classifierScore.rawScore || '?') + ' (threshold: ' + (bill.classifierScore.threshold || '1.5') + ')';
            sec3.appendChild(sc);
        }
        if (bill.classifierKeywords && bill.classifierKeywords.length) {
            var kw = document.createElement('div');
            kw.className = 'admin-keywords';
            bill.classifierKeywords.forEach(function(k) {
                var b = document.createElement('span');
                b.className = 'admin-keyword-badge';
                b.textContent = k;
                kw.appendChild(b);
            });
            sec3.appendChild(kw);
        }

        // Summary
        if (bill.summary) {
            var sec4 = mkSection(el, 'Summary');
            var p2 = document.createElement('p');
            p2.textContent = esc(bill.summary);
            sec4.appendChild(p2);
        }

        // Impact / Last Action
        if (bill.lastAction) {
            var sec4b = mkSection(el, 'Last Action');
            var la = document.createElement('p');
            la.textContent = esc(bill.lastAction);
            if (bill.lastActionDate) la.textContent += ' (' + bill.lastActionDate + ')';
            sec4b.appendChild(la);
        }

        // Source link
        if (bill.sourceUrl) {
            var sec5 = mkSection(el);
            var a = document.createElement('a');
            a.href = bill.sourceUrl;
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'admin-source-link';
            a.textContent = 'View Full Bill Text \u2192';
            sec5.appendChild(a);
        }

        // Actions (pending only)
        if (currentTab === 'pending') {
            var actDiv = document.createElement('div');
            actDiv.className = 'admin-detail-actions';

            var appBtn = document.createElement('button');
            appBtn.className = 'admin-btn admin-btn-approve';
            appBtn.textContent = 'Approve (Anti-Science)';
            appBtn.addEventListener('click', function() { doApprove(bill); });
            actDiv.appendChild(appBtn);

            var denBtn = document.createElement('button');
            denBtn.className = 'admin-btn admin-btn-deny';
            denBtn.textContent = 'Deny (Not Anti-Science)';
            denBtn.addEventListener('click', function() { showDenyForm(bill, actDiv); });
            actDiv.appendChild(denBtn);

            el.appendChild(actDiv);
        }

        // Review info (approved/denied)
        if (currentTab !== 'pending' && bill.reviewedBy) {
            var sec6 = mkSection(el, currentTab === 'approved' ? 'Approved' : 'Denied');
            sec6.classList.add('admin-review-info');
            var rb = document.createElement('p');
            rb.textContent = 'By: ' + esc(bill.reviewedBy);
            sec6.appendChild(rb);
            if (bill.reviewedAt) {
                var rt = document.createElement('p');
                rt.textContent = 'On: ' + new Date((bill.reviewedAt.seconds || 0) * 1000).toLocaleString();
                sec6.appendChild(rt);
            }
            if (bill.reviewNotes) {
                var rn = document.createElement('p');
                rn.textContent = 'Notes: ' + esc(bill.reviewNotes);
                sec6.appendChild(rn);
            }
        }
    }

    function mkSection(parent, title) {
        var sec = document.createElement('div');
        sec.className = 'admin-detail-section';
        if (title) {
            var h3 = document.createElement('h3');
            h3.textContent = title;
            sec.appendChild(h3);
        }
        parent.appendChild(sec);
        return sec;
    }

    function addMeta(row, label, value) {
        if (!value) return;
        var item = document.createElement('div');
        item.className = 'admin-meta-item';
        var lbl = document.createElement('span');
        lbl.className = 'admin-meta-label';
        lbl.textContent = label + ':';
        item.appendChild(lbl);
        var val = document.createElement('span');
        val.textContent = esc(value);
        item.appendChild(val);
        row.appendChild(item);
    }

    function showDenyForm(bill, actDiv) {
        while (actDiv.firstChild) actDiv.removeChild(actDiv.firstChild);

        var lbl = document.createElement('label');
        lbl.className = 'admin-deny-label';
        lbl.textContent = 'Reason for denial (required):';
        actDiv.appendChild(lbl);

        var ta = document.createElement('textarea');
        ta.className = 'admin-deny-notes';
        ta.placeholder = 'Why is this bill not anti-science?';
        ta.rows = 3;
        actDiv.appendChild(ta);

        var row = document.createElement('div');
        row.className = 'admin-btn-row';
        var conf = document.createElement('button');
        conf.className = 'admin-btn admin-btn-deny';
        conf.textContent = 'Confirm Deny';
        conf.addEventListener('click', function() {
            var notes = ta.value.trim();
            if (!notes) { ta.style.borderColor = '#B22234'; ta.focus(); return; }
            doDeny(bill, notes);
        });
        row.appendChild(conf);

        var canc = document.createElement('button');
        canc.className = 'admin-btn admin-btn-cancel';
        canc.textContent = 'Cancel';
        canc.addEventListener('click', function() { renderDetail(bill); });
        row.appendChild(canc);
        actDiv.appendChild(row);
        ta.focus();
    }

    function doApprove(bill) {
        var batch = db.batch();
        batch.update(db.collection('queue_bills').doc(bill.id), {
            queueStatus: 'approved',
            finalBillType: bill.classifierBillType || 'anti',
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reviewedBy: currentUser.email
        });
        batch.set(db.collection('review_log').doc(), {
            billId: bill.billId || bill.id, title: bill.title, state: bill.state,
            classifierBillType: bill.classifierBillType, finalBillType: bill.classifierBillType || 'anti',
            isCorrect: true, reviewNotes: '', reviewedBy: currentUser.email,
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            classifierKeywords: bill.classifierKeywords || [], classifierScore: bill.classifierScore || null
        });
        batch.commit().then(function() {
            toast('Bill approved'); showPlaceholder(); selectedBillId = null;
        }).catch(function(e) { console.error('Approve:', e); toast('Error approving', true); });
    }

    function doDeny(bill, notes) {
        var batch = db.batch();
        batch.update(db.collection('queue_bills').doc(bill.id), {
            queueStatus: 'denied', finalBillType: 'monitor',
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reviewedBy: currentUser.email, reviewNotes: notes
        });
        batch.set(db.collection('review_log').doc(), {
            billId: bill.billId || bill.id, title: bill.title, state: bill.state,
            classifierBillType: bill.classifierBillType, finalBillType: 'monitor',
            isCorrect: false, reviewNotes: notes, reviewedBy: currentUser.email,
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            classifierKeywords: bill.classifierKeywords || [], classifierScore: bill.classifierScore || null
        });
        batch.commit().then(function() {
            toast('Bill denied'); showPlaceholder(); selectedBillId = null;
        }).catch(function(e) { console.error('Deny:', e); toast('Error denying', true); });
    }

    function populateStates() {
        var sel = document.getElementById('filter-state');
        var states = SAFE_CONFIG.STATES;
        Object.keys(states).forEach(function(code) {
            var opt = document.createElement('option');
            opt.value = code;
            opt.textContent = states[code];
            sel.appendChild(opt);
        });
    }

    function timeAgo(ts) {
        if (!ts) return '';
        var s = ts.seconds ? ts.seconds : Math.floor(ts / 1000);
        var d = Math.floor(Date.now() / 1000) - s;
        if (d < 60) return 'just now';
        if (d < 3600) return Math.floor(d / 60) + 'm ago';
        if (d < 86400) return Math.floor(d / 3600) + 'h ago';
        return Math.floor(d / 86400) + 'd ago';
    }

    function toast(msg, isErr) {
        var old = document.querySelector('.admin-toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.className = 'admin-toast' + (isErr ? ' admin-toast-error' : '');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.classList.add('admin-toast-hide'); setTimeout(function() { t.remove(); }, 300); }, 3000);
    }

    // --- Volunteer Management ---

    function switchSection(section) {
        currentSection = section;
        document.querySelectorAll('.admin-section-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.section === section);
        });
        document.getElementById('bills-section').style.display = section === 'bills' ? '' : 'none';
        document.getElementById('volunteers-section').style.display = section === 'volunteers' ? '' : 'none';

        if (section === 'volunteers' && !vUnsubscribe) {
            loadVolunteers();
        }
    }

    function switchVTab(tab) {
        currentVTab = tab;
        document.querySelectorAll('[data-vtab]').forEach(function(t) {
            t.classList.toggle('active', t.dataset.vtab === tab);
        });
        selectedVolunteerId = null;
        showVolunteerPlaceholder();
        renderVolunteerQueue();
    }

    function showVolunteerPlaceholder() {
        document.getElementById('volunteer-detail-placeholder').style.display = '';
        document.getElementById('volunteer-detail-content').style.display = 'none';
    }

    function loadVolunteers() {
        vUnsubscribe = db.collection('volunteers').orderBy('createdAt', 'desc')
            .onSnapshot(function(snap) {
                allVolunteers = [];
                snap.forEach(function(doc) {
                    allVolunteers.push(Object.assign({ id: doc.id }, doc.data()));
                });
                updateVCounts();
                renderVolunteerQueue();
            }, function(err) { console.error('Volunteer listener:', err); });
    }

    function updateVCounts() {
        var counts = { pending: 0, approved: 0, rejected: 0 };
        allVolunteers.forEach(function(v) {
            if (counts[v.status] !== undefined) counts[v.status]++;
        });
        document.getElementById('vcount-pending').textContent = counts.pending;
        document.getElementById('vcount-approved').textContent = counts.approved;
        document.getElementById('vcount-rejected').textContent = counts.rejected;
    }

    function renderVolunteerQueue() {
        var list = document.getElementById('volunteer-queue-list');
        var empty = document.getElementById('volunteer-queue-empty');
        var filtered = allVolunteers.filter(function(v) { return v.status === currentVTab; });

        // Remove old cards (keep empty message)
        Array.from(list.querySelectorAll('.admin-queue-item')).forEach(function(el) { el.remove(); });

        empty.style.display = filtered.length ? 'none' : '';

        filtered.forEach(function(v) {
            var card = document.createElement('div');
            card.className = 'admin-queue-item' + (v.id === selectedVolunteerId ? ' active' : '');
            var titleDiv = document.createElement('div');
            titleDiv.className = 'queue-item-title';
            titleDiv.textContent = esc(v.name);
            card.appendChild(titleDiv);
            var emailDiv = document.createElement('div');
            emailDiv.className = 'queue-item-meta';
            emailDiv.textContent = esc(v.email);
            card.appendChild(emailDiv);
            var metaDiv = document.createElement('div');
            metaDiv.className = 'queue-item-meta';
            metaDiv.textContent = esc(v.availability) + ' \u2022 ' + (v.skills || []).length + ' skills';
            card.appendChild(metaDiv);
            card.addEventListener('click', function() { showVolunteerDetail(v.id); });
            list.appendChild(card);
        });
    }

    function showVolunteerDetail(id) {
        selectedVolunteerId = id;
        renderVolunteerQueue(); // update active state

        var v = allVolunteers.find(function(vol) { return vol.id === id; });
        if (!v) return;

        document.getElementById('volunteer-detail-placeholder').style.display = 'none';
        var el = document.getElementById('volunteer-detail-content');
        el.style.display = '';
        while (el.firstChild) el.removeChild(el.firstChild);

        var appliedDate = v.appliedAt ? new Date(v.appliedAt.seconds * 1000).toLocaleDateString() : 'Unknown';

        // Header
        var header = document.createElement('div');
        header.className = 'volunteer-detail-header';
        var h2 = document.createElement('h2');
        h2.textContent = esc(v.name);
        header.appendChild(h2);
        var badge = document.createElement('span');
        badge.className = 'volunteer-status-badge volunteer-status-' + v.status;
        badge.textContent = v.status;
        header.appendChild(badge);
        el.appendChild(header);

        // Fields
        addVolunteerField(el, 'Email', esc(v.email));
        addVolunteerField(el, 'Applied', appliedDate);
        addVolunteerField(el, 'Availability', esc(v.availability));

        // Skills
        addVolunteerField(el, 'Skills', '');
        var skillTags = document.createElement('div');
        skillTags.className = 'volunteer-tags';
        (v.skills || []).forEach(function(s) {
            var tag = document.createElement('span');
            tag.className = 'volunteer-tag';
            tag.textContent = esc(s);
            skillTags.appendChild(tag);
        });
        el.appendChild(skillTags);

        // Interests
        addVolunteerField(el, 'Interests', '');
        var intTags = document.createElement('div');
        intTags.className = 'volunteer-tags';
        (v.interests || []).forEach(function(s) {
            var tag = document.createElement('span');
            tag.className = 'volunteer-tag volunteer-tag-interest';
            tag.textContent = esc(s);
            intTags.appendChild(tag);
        });
        el.appendChild(intTags);

        // Onboarding status for approved volunteers
        if (v.status === 'approved' && v.onboardingSteps) {
            addVolunteerField(el, 'Onboarding', '');
            var stepsDiv = document.createElement('div');
            stepsDiv.className = 'volunteer-onboarding-steps';
            Object.keys(v.onboardingSteps).forEach(function(step) {
                var done = v.onboardingSteps[step];
                var stepEl = document.createElement('div');
                stepEl.className = 'onboarding-step' + (done ? ' done' : '');
                stepEl.textContent = (done ? '\u2713 ' : '\u2610 ') + step.replace(/([A-Z])/g, ' $1').trim();
                stepsDiv.appendChild(stepEl);
            });
            el.appendChild(stepsDiv);

            var ndaText = v.ndaSigned ? 'Signed on ' + new Date(v.ndaSignedAt.seconds * 1000).toLocaleDateString() : 'Not signed';
            addVolunteerField(el, 'NDA', ndaText);
        }

        // Action buttons for pending
        if (v.status === 'pending') {
            var actDiv = document.createElement('div');
            actDiv.className = 'volunteer-actions';
            var appBtn = document.createElement('button');
            appBtn.className = 'btn-approve';
            appBtn.textContent = 'Approve & Onboard';
            appBtn.addEventListener('click', function() { window._approveVolunteer(v.id); });
            actDiv.appendChild(appBtn);
            var rejBtn = document.createElement('button');
            rejBtn.className = 'btn-reject';
            rejBtn.textContent = 'Reject';
            rejBtn.addEventListener('click', function() { showVolunteerRejectForm(v.id, el); });
            actDiv.appendChild(rejBtn);
            el.appendChild(actDiv);
        }

        if (v.status === 'rejected' && v.rejectionReason) {
            addVolunteerField(el, 'Rejection Reason', esc(v.rejectionReason));
        }
    }

    function addVolunteerField(parent, label, value) {
        var field = document.createElement('div');
        field.className = 'volunteer-detail-field';
        var strong = document.createElement('strong');
        strong.textContent = label + ': ';
        field.appendChild(strong);
        if (value) {
            var span = document.createElement('span');
            span.textContent = value;
            field.appendChild(span);
        }
        parent.appendChild(field);
    }

    function showVolunteerRejectForm(id, parentEl) {
        var existingForm = document.getElementById('reject-form-' + id);
        if (existingForm) { existingForm.style.display = ''; return; }

        var formDiv = document.createElement('div');
        formDiv.id = 'reject-form-' + id;
        formDiv.className = 'reject-form';

        var ta = document.createElement('textarea');
        ta.id = 'reject-reason-' + id;
        ta.placeholder = 'Rejection reason (optional)...';
        ta.rows = 3;
        formDiv.appendChild(ta);

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-reject-confirm';
        confirmBtn.textContent = 'Confirm Rejection';
        confirmBtn.addEventListener('click', function() { window._rejectVolunteer(id); });
        formDiv.appendChild(confirmBtn);

        parentEl.appendChild(formDiv);
    }

    window._approveVolunteer = async function(id) {
        if (!confirm('Approve this volunteer and start onboarding?')) return;
        try {
            var token = await currentUser.getIdToken();
            var resp = await fetch('/api/admin/volunteers/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ volunteerId: id })
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Failed to approve');
            toast('Volunteer approved! Onboarding started.');
        } catch (e) {
            toast('Error: ' + e.message, true);
        }
    };

    window._showRejectForm = function(id) {
        var form = document.getElementById('reject-form-' + id);
        if (form) form.style.display = '';
    };

    window._rejectVolunteer = async function(id) {
        var reasonEl = document.getElementById('reject-reason-' + id);
        var reason = reasonEl ? reasonEl.value : '';
        try {
            var token = await currentUser.getIdToken();
            var resp = await fetch('/api/admin/volunteers/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ volunteerId: id, reason: reason })
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Failed to reject');
            toast('Volunteer rejected.');
        } catch (e) {
            toast('Error: ' + e.message, true);
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
