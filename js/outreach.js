// ============================================
// SAFE Action - Candidate Outreach Page
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const stateSelect = document.getElementById('outreach-state');
    const levelSelect = document.getElementById('outreach-level');
    const partySelect = document.getElementById('outreach-party');
    const searchInput = document.getElementById('outreach-search');
    const findBtn = document.getElementById('outreach-find-btn');
    const resultsEl = document.getElementById('outreach-results');
    const initialEl = document.getElementById('outreach-initial');
    const gridEl = document.getElementById('outreach-grid');
    const noResults = document.getElementById('outreach-no-results');
    const countEl = document.getElementById('outreach-count');
    const emailAllBtn = document.getElementById('email-all-btn');
    const templateSection = document.getElementById('outreach-template-section');

    let allCandidates = [];
    let filteredCandidates = [];
    let selectedCandidate = null;

    init();

    function init() {
        // Populate state dropdown
        const states = SAFE_CONFIG.STATES;
        Object.keys(states).sort((a, b) => states[a].localeCompare(states[b])).forEach(code => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = states[code];
            stateSelect.appendChild(opt);
        });

        // Check URL for pre-selected state
        const params = new URLSearchParams(window.location.search);
        const stateParam = params.get('state');
        if (stateParam) {
            stateSelect.value = stateParam;
            loadCandidates(stateParam);
        }

        // Events
        findBtn.addEventListener('click', () => {
            if (stateSelect.value) loadCandidates(stateSelect.value);
        });
        stateSelect.addEventListener('change', () => {
            if (stateSelect.value) loadCandidates(stateSelect.value);
        });
        levelSelect.addEventListener('change', applyFilters);
        partySelect.addEventListener('change', applyFilters);
        searchInput.addEventListener('input', debounce(applyFilters, 300));

        emailAllBtn.addEventListener('click', () => {
            composeEmailAll();
        });

        // Template interactions
        document.getElementById('outreach-your-name').addEventListener('input', debounce(updateTemplate, 300));
        document.getElementById('outreach-your-city').addEventListener('input', debounce(updateTemplate, 300));
        setupCopyButtons();

        // Load impact numbers
        initImpact();
    }

    function initImpact() {
        // Demo numbers — in production, pull from Firebase
        const contacted = getOutreachCount('contacted');
        const pledged = getOutreachCount('pledged');
        setEl('outreach-impact-contacted', contacted);
        setEl('outreach-impact-pledged', pledged);
        setEl('outreach-impact-pending', Math.max(0, contacted - pledged));
    }

    function getOutreachCount(key) {
        try {
            const stored = JSON.parse(localStorage.getItem('safe_outreach_counts'));
            if (stored) return stored[key] || 0;
        } catch (e) {}
        return 0;
    }

    function setEl(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = typeof val === 'number' ? val.toLocaleString() : val;
    }

    async function loadCandidates(state) {
        initialEl.style.display = 'none';
        resultsEl.style.display = '';
        gridEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading candidates...</p></div>';
        noResults.style.display = 'none';
        templateSection.style.display = 'none';

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('state', state);
        history.replaceState(null, '', url);

        try {
            allCandidates = await getElectionCandidates(state);
            setEl('outreach-impact-total', allCandidates.length);
            applyFilters();
        } catch (error) {
            console.error('Failed to load candidates:', error);
            gridEl.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Failed to load candidates. Please try again.</p>';
        }
    }

    function applyFilters() {
        const level = levelSelect.value;
        const party = partySelect.value;
        const search = searchInput.value.toLowerCase().trim();

        filteredCandidates = allCandidates;

        if (level) filteredCandidates = filteredCandidates.filter(c => c.level === level);
        if (party) filteredCandidates = filteredCandidates.filter(c => c.party === party);
        if (search) {
            filteredCandidates = filteredCandidates.filter(c => {
                const searchable = [c.name, c.office, c.party, c.district, c.state].join(' ').toLowerCase();
                return searchable.includes(search);
            });
        }

        renderCandidates(filteredCandidates);
    }


    function renderCandidates(candidates) {
        noResults.style.display = 'none';
        countEl.textContent = `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} found`;

        if (candidates.length === 0) {
            gridEl.innerHTML = '';
            noResults.style.display = '';
            return;
        }

        gridEl.innerHTML = candidates.map((c, i) => {
            const partyClass = c.party ? c.party.toLowerCase().replace(/\s+/g, '-') : '';
            const hasPledge = c.pledgeStatus === 'taken';
            const pledgeBadge = hasPledge
                ? '<span class="badge badge-pro" style="font-size:0.7rem;">Pledge Taken</span>'
                : '<span class="badge badge-anti" style="font-size:0.7rem;">No Pledge Yet</span>';

            return `
                <div class="outreach-card ${hasPledge ? 'pledged' : ''}" data-index="${i}">
                    <div class="outreach-card-top">
                        <div class="outreach-card-avatar">${getInitials(c.name)}</div>
                        <div>
                            <div class="outreach-card-name">${escapeHtml(c.name)}</div>
                            <div class="outreach-card-office">${escapeHtml(c.office)}</div>
                        </div>
                    </div>
                    <div class="outreach-card-details">
                        <span class="badge badge-party ${partyClass}">${escapeHtml(c.party)}</span>
                        <span class="badge badge-level ${c.level === 'Federal' ? 'federal' : ''}">${escapeHtml(c.level)}</span>
                        ${pledgeBadge}
                    </div>
                    ${c.district ? `<div class="outreach-card-district">${escapeHtml(c.district)}</div>` : ''}
                    <div class="outreach-card-contact">
                        ${c.email ? `<a href="mailto:${escapeHtml(c.email)}" class="outreach-contact-email">${escapeHtml(c.email)}</a>` : '<span style="color:var(--text-light);">No email listed</span>'}
                        ${c.phone ? `<a href="tel:${c.phone.replace(/[^+\d]/g, '')}" class="outreach-contact-phone">${escapeHtml(c.phone)}</a>` : ''}
                    </div>
                    <div class="outreach-card-actions">
                        ${c.email && !hasPledge ? `<button class="btn-sm btn-primary outreach-email-btn" data-index="${i}">Ask to Pledge</button>` : ''}
                        ${hasPledge ? `<a href="candidate.html?id=${encodeURIComponent(c.candidateId || '')}" class="btn-sm btn-outline">View Pledge</a>` : ''}
                        ${c.email ? `<button class="btn-sm btn-outline outreach-custom-btn" data-index="${i}">Custom Email</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Event listeners for buttons
        gridEl.querySelectorAll('.outreach-email-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                selectedCandidate = filteredCandidates[idx];
                showTemplate(selectedCandidate);
            });
        });

        gridEl.querySelectorAll('.outreach-custom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                selectedCandidate = filteredCandidates[idx];
                showTemplate(selectedCandidate, true);
            });
        });
    }

    function showTemplate(candidate, custom = false) {
        templateSection.style.display = '';
        selectedCandidate = candidate;
        updateTemplate(custom);
        templateSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function updateTemplate(custom) {
        const yourName = document.getElementById('outreach-your-name').value || '[Your Name]';
        const yourCity = document.getElementById('outreach-your-city').value || '[Your City]';
        const c = selectedCandidate;
        if (!c) return;

        const isCustom = custom === true;

        const prefixMatch = c.name.match(/^(Rep\.|Sen\.|Representative|Senator|Mayor|Council|Commissioner)\s*/i);
        const title = prefixMatch ? prefixMatch[1] : '';
        const cleanName = c.name.replace(/^(Rep\.|Sen\.|Representative|Senator|Mayor|Council|Commissioner)\s*/i, '');

        if (isCustom) {
            document.getElementById('outreach-email-subject').value = `Regarding science and public health policy`;
            document.getElementById('outreach-email-body').value =
`Dear ${title ? title + ' ' : ''}${cleanName},

I am a constituent from ${yourCity} and I am writing to you about the importance of science-based policy and public health in our community.

[Share your message here]

Thank you for your time and service.

Sincerely,
${yourName}
${yourCity}`;
        } else {
            document.getElementById('outreach-email-subject').value =
                `Will you take the SAFE Action pledge on science and public health?`;
            document.getElementById('outreach-email-body').value =
`Dear ${title ? title + ' ' : ''}${cleanName},

I am a constituent from ${yourCity}, and I am writing to ask you to take the SAFE Action pledge.

The SAFE Action pledge is a simple, public commitment to support science-based policymaking and protect the public health of your constituents. Voters want to know where their candidates stand on science and public health, and this is your chance to stand with them.

Taking the pledge is quick and free. You can complete it at: https://scienceandfreedom.com/quiz.html

By taking the pledge, your name will appear in the SAFE Action candidate directory, showing voters that you are committed to defending science and individual health freedom.

SAFE Action is a growing movement and your constituents are watching.

I urge you to take the pledge today.

Thank you for your time and service.

Sincerely,
${yourName}
${yourCity}`;
        }
    }

    function composeEmailAll() {
        const emailCandidates = filteredCandidates.filter(c => c.email && c.pledgeStatus !== 'taken');
        if (emailCandidates.length === 0) {
            alert('No unpledged candidates with email addresses found.');
            return;
        }

        // Use first candidate as template but BCC all
        selectedCandidate = emailCandidates[0];
        showTemplate(selectedCandidate);

        // Show a note about emailing all
        const note = document.createElement('div');
        note.className = 'email-all-note';
        note.innerHTML = `<strong>${emailCandidates.length} candidates</strong> will receive this email. Email addresses: <br><code>${emailCandidates.map(c => c.email).join(', ')}</code>`;

        const existing = templateSection.querySelector('.email-all-note');
        if (existing) existing.remove();
        templateSection.querySelector('.template-actions').before(note);
    }

    function setupCopyButtons() {
        document.getElementById('outreach-copy-email').addEventListener('click', () => {
            const subject = document.getElementById('outreach-email-subject').value;
            const body = document.getElementById('outreach-email-body').value;
            copyToClipboard(`Subject: ${subject}\n\n${body}`, 'outreach-copy-success');
            trackOutreach('contacted');
        });

        document.getElementById('outreach-open-mailto').addEventListener('click', () => {
            const subject = encodeURIComponent(document.getElementById('outreach-email-subject').value);
            const body = encodeURIComponent(document.getElementById('outreach-email-body').value);
            const to = selectedCandidate && selectedCandidate.email ? selectedCandidate.email : '';
            window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_self');
            trackOutreach('contacted');
        });
    }

    function trackOutreach(type) {
        try {
            const stored = JSON.parse(localStorage.getItem('safe_outreach_counts')) || { contacted: 0, pledged: 0 };
            stored[type] = (stored[type] || 0) + 1;
            localStorage.setItem('safe_outreach_counts', JSON.stringify(stored));
            initImpact();
        } catch (e) {}
    }

    // --- Demo Election Candidate Data ---
    async function getElectionCandidates(state) {
        // In production, this would fetch from Firebase/Google Sheets
        // For demo, return sample data for the 2026 election cycle
        const demo = getDemoElectionCandidates();

        if (state === 'ALL') return demo;
        return demo.filter(c => c.state === state || c.level === 'Federal');
    }

    function getDemoElectionCandidates() {
        return [];
    }

    // --- Utilities ---
    function getInitials(name) {
        return name
            .replace(/^(Rep\.|Sen\.|Representative|Senator|Mayor|Council Member|Commissioner)\s*/i, '')
            .split(' ')
            .map(w => w[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase();
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
