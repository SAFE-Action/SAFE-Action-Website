// ============================================
// SAFE Action - Action Detail Page
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('action-loading');
    const contentEl = document.getElementById('action-content');
    const notFoundEl = document.getElementById('action-not-found');
    const backLink = document.getElementById('back-link');

    // Get params from URL
    const params = new URLSearchParams(window.location.search);
    const billId = params.get('bill');
    const state = params.get('state');

    // Set back link
    backLink.href = state ? `tracker.html?state=${encodeURIComponent(state)}` : 'tracker.html';

    if (!billId) { showNotFound(); return; }

    let bill = null;
    let reps = [];
    let templates = [];
    let selectedRep = null;

    try {
        bill = await LegislationAPI.getBill(billId);
        if (!bill) { showNotFound(); return; }

        // Load reps and templates in parallel
        const billState = bill.state === 'US' ? state : bill.state;
        [reps, templates] = await Promise.all([
            LegislationAPI.getRepresentatives(billState || state),
            LegislationAPI.getTemplates(bill.stance)
        ]);

        // Filter reps by relevance to this bill
        if (bill.level === 'Federal') {
            reps = reps.filter(r => r.level === 'Federal');
        } else if (bill.chamber) {
            const sameChamber = reps.filter(r => r.chamber === bill.chamber && r.level === bill.level);
            if (sameChamber.length > 0) reps = sameChamber;
        }

        // Populate page
        populateBillDetails(bill);
        renderStatusPipeline(bill.status);
        renderRepresentatives(reps);
        setupTemplates(templates, bill, reps);
        setupTabs();
        setupCopyButtons(bill, reps);
        setupEmailSignup();

        // Update page title
        document.title = `${bill.billNumber}: ${bill.title} - SAFE Action`;

        loadingEl.style.display = 'none';
        contentEl.style.display = '';
    } catch (error) {
        console.error('Error loading action page:', error);
        showNotFound();
    }

    function populateBillDetails(b) {
        // Header badges
        const stanceBadge = document.getElementById('bill-stance-badge');
        stanceBadge.textContent = `SAFE: ${b.stance}`;
        stanceBadge.className = `badge badge-stance ${(b.stance || '').toLowerCase()}`;

        const levelBadge = document.getElementById('bill-level-badge');
        levelBadge.textContent = b.level;
        levelBadge.className = `badge badge-level ${b.level === 'Federal' ? 'federal' : ''}`;

        const impactBadge = document.getElementById('bill-impact-badge');
        impactBadge.textContent = `${b.impact} Priority`;
        impactBadge.className = `badge badge-impact ${(b.impact || '').toLowerCase()}`;

        // Bill type badge
        const typeBadge = document.getElementById('bill-type-badge');
        if (typeBadge && b.billType) {
            typeBadge.textContent = b.billType === 'pro' ? 'PRO-SCIENCE' : 'ANTI-SCIENCE';
            typeBadge.className = `badge ${b.billType === 'pro' ? 'badge-pro' : 'badge-anti'}`;
        }

        // Heading
        document.getElementById('bill-heading').textContent = `${b.billNumber}: ${b.title}`;

        // Info grid
        document.getElementById('bill-number').textContent = b.billNumber;
        document.getElementById('bill-status').textContent = b.status;
        document.getElementById('bill-chamber').textContent = b.chamber || 'N/A';

        if (b.committee) {
            document.getElementById('bill-committee').textContent = b.committee;
        } else {
            document.getElementById('bill-committee-row').style.display = 'none';
        }

        document.getElementById('bill-last-action').textContent = b.lastAction || 'No action recorded';
        document.getElementById('bill-last-date').textContent = b.lastActionDate || 'N/A';
        document.getElementById('bill-summary').textContent = b.summary;

        // Category
        const categoryEl = document.getElementById('bill-category');
        if (categoryEl && b.category) {
            categoryEl.textContent = b.category;
        }

        // Full text link
        const fullTextLink = document.getElementById('bill-full-text');
        if (b.fullTextUrl && b.fullTextUrl !== '#') {
            fullTextLink.href = b.fullTextUrl;
        } else {
            fullTextLink.style.display = 'none';
        }
    }

    function renderStatusPipeline(currentStatus) {
        const pipeline = document.getElementById('status-pipeline');
        const isDead = SAFE_CONFIG.DEAD_STATUSES.includes(currentStatus);
        const statusOrder = SAFE_CONFIG.STATUS_ORDER;
        const currentIndex = statusOrder.indexOf(currentStatus);

        let html = statusOrder.map((step, i) => {
            let cls = '';
            if (isDead) {
                cls = 'completed';
                if (i === 0) cls = 'completed';
            } else if (i < currentIndex) {
                cls = 'completed';
            } else if (i === currentIndex) {
                cls = 'current';
            }
            return `
                <div class="pipeline-step ${cls}">
                    <div class="pipeline-dot"></div>
                    <span class="pipeline-label">${escapeHtml(step)}</span>
                </div>
            `;
        }).join('');

        if (isDead) {
            html += `
                <div class="pipeline-step dead">
                    <div class="pipeline-dot"></div>
                    <span class="pipeline-label">${escapeHtml(currentStatus)}</span>
                </div>
            `;
        }

        pipeline.innerHTML = html;
    }

    function renderRepresentatives(repList) {
        const grid = document.getElementById('rep-grid');
        const noReps = document.getElementById('no-reps');

        if (repList.length === 0) {
            grid.style.display = 'none';
            noReps.style.display = '';
            return;
        }

        selectedRep = repList[0];

        grid.innerHTML = repList.map((rep, i) => {
            const partyClass = rep.party ? rep.party.toLowerCase().replace(/\s+/g, '-') : '';
            return `
                <div class="rep-card ${i === 0 ? 'selected' : ''}" data-rep-index="${i}">
                    <div class="rep-card-name">${escapeHtml(rep.name)}</div>
                    <div class="rep-card-info">
                        <span class="badge badge-party ${partyClass}" style="font-size:0.75rem;">${escapeHtml(rep.party)}</span>
                        ${rep.district ? ' &middot; ' + escapeHtml(rep.district) : ''}
                        ${rep.chamber ? ' &middot; ' + escapeHtml(rep.chamber) : ''}
                    </div>
                    ${rep.notes ? `<div class="rep-card-notes">${escapeHtml(rep.notes)}</div>` : ''}
                    <div class="rep-contact">
                        ${rep.phone ? `<a href="tel:${rep.phone.replace(/[^+\d]/g, '')}">${escapeHtml(rep.phone)}</a>` : ''}
                        ${rep.email ? `<a href="mailto:${escapeHtml(rep.email)}">${escapeHtml(rep.email)}</a>` : ''}
                    </div>
                    <div class="rep-actions">
                        <button class="btn-sm btn-primary select-rep-btn" data-rep-index="${i}">Use Template</button>
                    </div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.select-rep-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.repIndex);
                selectedRep = repList[index];
                grid.querySelectorAll('.rep-card').forEach(c => c.classList.remove('selected'));
                grid.querySelector(`[data-rep-index="${index}"]`).classList.add('selected');
                fillTemplateFields();
            });
        });
    }

    function setupTemplates(templateList, b, repList) {
        const emailTemplate = templateList.find(t => t.type === 'Email') || null;
        const phoneTemplate = templateList.find(t => t.type === 'Phone') || null;

        window._emailTemplate = emailTemplate;
        window._phoneTemplate = phoneTemplate;
        window._bill = b;

        fillTemplateFields();

        document.getElementById('user-name').addEventListener('input', debounce(fillTemplateFields, 300));
        document.getElementById('user-city').addEventListener('input', debounce(fillTemplateFields, 300));
    }

    function fillTemplateFields() {
        const b = window._bill;
        const stateName = SAFE_CONFIG.STATES[state] || SAFE_CONFIG.STATES[b.state] || b.state;

        const prefixMatch = selectedRep ? selectedRep.name.match(/^(Rep\.|Sen\.|Representative|Senator)\s*/i) : null;
        const repTitle = prefixMatch ? prefixMatch[1] : (selectedRep ? '' : '[Title]');
        const repName = selectedRep ? selectedRep.name.replace(/^(Rep\.|Sen\.|Representative|Senator)\s*/i, '') : '[Name]';

        const data = {
            repName: repName,
            repTitle: repTitle,
            billNumber: b.billNumber,
            billTitle: b.title,
            state: stateName,
            yourName: document.getElementById('user-name').value || '[Your Name]',
            yourCity: document.getElementById('user-city').value || '[Your City]'
        };

        // Email
        if (window._emailTemplate) {
            document.getElementById('email-subject').value = LegislationAPI.fillTemplate(window._emailTemplate.subject, data);
            document.getElementById('email-body').value = LegislationAPI.fillTemplate(window._emailTemplate.body, data);
        } else {
            document.getElementById('email-subject').value = `Please ${b.stance === 'Support' ? 'SUPPORT' : 'OPPOSE'} ${b.billNumber}`;
            document.getElementById('email-body').value = `Dear ${data.repName},\n\nI am writing regarding ${b.billNumber}, the ${b.title}.\n\n[Share your position here]\n\nSincerely,\n${data.yourName}\n${data.yourCity}, ${stateName}`;
        }

        // Phone
        if (window._phoneTemplate) {
            document.getElementById('phone-script').value = LegislationAPI.fillTemplate(window._phoneTemplate.body, data);
        } else {
            document.getElementById('phone-script').value = `Hello, my name is ${data.yourName} and I'm a constituent from ${data.yourCity}.\n\nI'm calling to ask ${data.repName} to please ${b.stance === 'Support' ? 'SUPPORT' : 'OPPOSE'} ${b.billNumber}, the ${b.title}.\n\nThank you for taking my call.`;
        }

        // Phone numbers list
        const phoneNumbers = document.getElementById('phone-numbers');
        if (reps.length > 0) {
            phoneNumbers.innerHTML = '<strong style="font-size:0.9rem;color:var(--text-mid);">Phone numbers to call:</strong><br>' +
                reps.filter(r => r.phone).map(r =>
                    `<a href="tel:${r.phone.replace(/[^+\d]/g, '')}" style="font-weight:600;margin-right:16px;">${escapeHtml(r.name)}: ${escapeHtml(r.phone)}</a>`
                ).join('<br>');
        }
    }

    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });
    }

    function setupCopyButtons() {
        // Copy email - with action tracking confirmation
        document.getElementById('copy-email').addEventListener('click', () => {
            const subject = document.getElementById('email-subject').value;
            const body = document.getElementById('email-body').value;
            copyToClipboard(`Subject: ${subject}\n\n${body}`, 'copy-email-success');
            showActionConfirm('email');
        });

        // Open mailto - with action tracking
        document.getElementById('open-mailto').addEventListener('click', () => {
            const subject = encodeURIComponent(document.getElementById('email-subject').value);
            const body = encodeURIComponent(document.getElementById('email-body').value);
            const to = selectedRep && selectedRep.email ? selectedRep.email : '';
            window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_self');
            showActionConfirm('email');
        });

        // Copy phone script - with action tracking
        document.getElementById('copy-phone').addEventListener('click', () => {
            copyToClipboard(document.getElementById('phone-script').value, 'copy-phone-success');
            showActionConfirm('call');
        });
    }

    // --- Action Confirmation ---
    function showActionConfirm(type) {
        const confirmEl = document.getElementById('action-confirm');
        if (!confirmEl) return;

        const typeText = type === 'email' ? 'email' : 'call';
        confirmEl.innerHTML = `
            <div class="action-confirm-inner">
                <span class="action-confirm-icon">${type === 'email' ? '&#9993;' : '&#9742;'}</span>
                <span>Did you send the ${typeText}?</span>
                <button class="btn-sm btn-primary action-confirm-yes" data-type="${type}">Yes, I did!</button>
                <button class="btn-sm btn-outline action-confirm-no">Not yet</button>
            </div>
        `;
        confirmEl.style.display = '';

        confirmEl.querySelector('.action-confirm-yes').addEventListener('click', () => {
            trackAction(type);
            confirmEl.innerHTML = `<div class="action-confirm-inner action-confirm-success">
                <span>&#10003; Thank you! Your action has been counted. Together we've taken <strong>${getActionCount().toLocaleString()}</strong> actions!</span>
            </div>`;
            setTimeout(() => { confirmEl.style.display = 'none'; }, 4000);
        });

        confirmEl.querySelector('.action-confirm-no').addEventListener('click', () => {
            confirmEl.style.display = 'none';
        });
    }

    function trackAction(type) {
        // Use the global tracker from main.js, or fallback
        if (window.SAFE_ACTIONS && window.SAFE_ACTIONS.trackAction) {
            window.SAFE_ACTIONS.trackAction(type);
        } else {
            // Standalone tracking
            const BASE = 1128;
            try {
                const stored = JSON.parse(localStorage.getItem('safe_action_counts')) || { total: BASE, emails: 743, calls: 385 };
                stored.total++;
                if (type === 'email') stored.emails++;
                if (type === 'call') stored.calls++;
                localStorage.setItem('safe_action_counts', JSON.stringify(stored));
            } catch (e) {}
        }
    }

    function getActionCount() {
        try {
            const stored = JSON.parse(localStorage.getItem('safe_action_counts'));
            return stored ? stored.total : 1128;
        } catch (e) {
            return 1128;
        }
    }

    function copyToClipboard(text, successId) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showCopySuccess(successId);
            }).catch(() => {
                fallbackCopy(text, successId);
            });
        } else {
            fallbackCopy(text, successId);
        }
    }

    function fallbackCopy(text, successId) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showCopySuccess(successId);
        } catch (e) {
            alert('Copy failed. Please select the text and copy manually.');
        }
        document.body.removeChild(textarea);
    }

    function showCopySuccess(id) {
        const el = document.getElementById(id);
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    }

    function setupEmailSignup() {
        const form = document.getElementById('email-signup-form');
        const success = document.getElementById('signup-success');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('signup-email').value.trim();
            if (!email) return;

            try {
                await LegislationAPI.submitEmailSignup(email, state || '', 'action');
                form.style.display = 'none';
                success.classList.add('show');
            } catch (error) {
                console.error('Signup error:', error);
            }
        });
    }

    function showNotFound() {
        loadingEl.style.display = 'none';
        notFoundEl.style.display = '';
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
});
