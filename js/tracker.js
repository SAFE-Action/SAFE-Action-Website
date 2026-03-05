// ============================================
// SAFE Action - Legislation Tracker Page
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const stateSelect = document.getElementById('state-select');
    const trackBtn = document.getElementById('track-btn');
    const resultsEl = document.getElementById('tracker-results');
    const initialState = document.getElementById('initial-state');
    const billGrid = document.getElementById('bill-grid');
    const noBills = document.getElementById('no-bills');
    const filterLevel = document.getElementById('filter-level');
    const filterStatus = document.getElementById('filter-status');
    const filterImpact = document.getElementById('filter-impact');
    const filterSearch = document.getElementById('filter-bill-search');
    const filterStance = document.getElementById('filter-stance');
    const filterCategory = document.getElementById('filter-category');
    const resultsCount = document.getElementById('results-count');
    const signupForm = document.getElementById('email-signup-form');
    const signupSuccess = document.getElementById('signup-success');
    const mediaSection = document.getElementById('media-section');

    let allBills = [];
    let selectedState = '';
    let selectedBills = new Set(); // multi-bill selection
    const multiBillBar = document.getElementById('multi-bill-bar');
    const multiBillCountNum = document.getElementById('multi-bill-count-num');
    const multiBillComposeSection = document.getElementById('multi-bill-compose-section');

    init();
    initTrackerImpact();
    initMultiBill();

    function initTrackerImpact() {
        const BASE = { total: 1128, emails: 743, calls: 385 };
        try {
            const stored = JSON.parse(localStorage.getItem('safe_action_counts'));
            if (stored && stored.total >= BASE.total) {
                setImpact('tracker-impact-actions', stored.total);
                setImpact('tracker-impact-emails', stored.emails);
                setImpact('tracker-impact-calls', stored.calls);
                return;
            }
        } catch (e) {}
        setImpact('tracker-impact-actions', BASE.total);
        setImpact('tracker-impact-emails', BASE.emails);
        setImpact('tracker-impact-calls', BASE.calls);

        function setImpact(id, val) {
            const el = document.getElementById(id);
            if (el) el.textContent = val.toLocaleString();
        }

        // Load stopped bills count
        LegislationAPI.getVictories().then(victories => {
            setImpact('tracker-impact-stopped', victories.length);
        }).catch(() => {});
    }

    function init() {
        // Populate state dropdown
        const states = SAFE_CONFIG.STATES;
        Object.keys(states).sort((a, b) => states[a].localeCompare(states[b])).forEach(code => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = states[code];
            stateSelect.appendChild(opt);
        });

        // Check URL for pre-selected state, default to ALL (auto-load bills)
        const params = new URLSearchParams(window.location.search);
        const stateParam = params.get('state') || 'ALL';
        stateSelect.value = stateParam;
        loadLegislation(stateParam);

        // Event listeners
        trackBtn.addEventListener('click', () => {
            if (stateSelect.value) loadLegislation(stateSelect.value);
        });

        stateSelect.addEventListener('change', () => {
            if (stateSelect.value) loadLegislation(stateSelect.value);
        });

        filterLevel.addEventListener('change', applyFilters);
        filterStatus.addEventListener('change', applyFilters);
        filterImpact.addEventListener('change', applyFilters);
        filterStance.addEventListener('change', applyFilters);
        filterCategory.addEventListener('change', applyFilters);
        filterSearch.addEventListener('input', debounce(applyFilters, 300));

        // Email signup
        signupForm.addEventListener('submit', handleEmailSignup);

        // Share buttons
        setupShareButtons();

        // Media section buttons
        setupMediaSection();
    }

    async function loadLegislation(state) {
        selectedState = state;
        initialState.style.display = 'none';
        resultsEl.style.display = '';

        // Show loading
        billGrid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading legislation...</p></div>';
        noBills.style.display = 'none';

        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('state', state);
        history.replaceState(null, '', url);

        try {
            if (state === 'ALL') {
                allBills = await LegislationAPI.getLegislation(null);
            } else {
                allBills = await LegislationAPI.getLegislation(state);
            }
            renderStats(allBills);
            renderBills(allBills);
            mediaSection.style.display = '';
            renderMediaStats(allBills);
            enrichBillsWithIntelligence(allBills);
        } catch (error) {
            console.error('Failed to load legislation:', error);
            billGrid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Failed to load legislation. Please try again.</p>';
        }
    }

    function renderStats(bills) {
        const active = bills.filter(b => b.isActive === 'Yes');
        const proBills = bills.filter(b => b.billType === 'pro');
        const antiBills = bills.filter(b => b.billType === 'anti');

        document.getElementById('stat-active').textContent = active.length;
        document.getElementById('stat-pro').textContent = proBills.length;
        document.getElementById('stat-anti').textContent = antiBills.length;
        document.getElementById('stat-high').textContent = active.filter(b => b.impact === 'High').length;
        document.getElementById('stat-federal').textContent = bills.filter(b => b.level === 'Federal').length;
    }

    function applyFilters() {
        const level = filterLevel.value;
        const status = filterStatus.value;
        const impact = filterImpact.value;
        const stance = filterStance.value;
        const category = filterCategory.value;
        const search = filterSearch.value.toLowerCase().trim();

        let filtered = allBills;

        if (stance === 'pro') {
            filtered = filtered.filter(b => b.billType === 'pro');
        } else if (stance === 'anti') {
            filtered = filtered.filter(b => b.billType === 'anti');
        }

        if (level) filtered = filtered.filter(b => b.level === level);

        if (category) filtered = filtered.filter(b => b.category === category);

        if (status === 'active') {
            filtered = filtered.filter(b => b.isActive === 'Yes');
        } else if (status === 'dead') {
            filtered = filtered.filter(b => SAFE_CONFIG.DEAD_STATUSES.includes(b.status) || b.isActive === 'No');
        } else if (status) {
            filtered = filtered.filter(b => b.status === status);
        }

        if (impact) filtered = filtered.filter(b => b.impact === impact);

        if (search) {
            filtered = filtered.filter(b => {
                const searchable = [b.billNumber, b.title, b.summary, b.committee, b.lastAction, b.category, b.state].join(' ').toLowerCase();
                return searchable.includes(search);
            });
        }

        renderBills(filtered);
    }

    function renderBills(bills) {
        noBills.style.display = 'none';

        // Update results count
        resultsCount.textContent = `${bills.length} bill${bills.length !== 1 ? 's' : ''} found`;

        if (bills.length === 0) {
            billGrid.innerHTML = '';
            noBills.style.display = '';
            return;
        }

        // Sort: active first, then by impact (High > Medium > Low), then by date
        const impactOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
        bills.sort((a, b) => {
            const activeA = a.isActive === 'Yes' ? 0 : 1;
            const activeB = b.isActive === 'Yes' ? 0 : 1;
            if (activeA !== activeB) return activeA - activeB;
            const impA = impactOrder[a.impact] ?? 3;
            const impB = impactOrder[b.impact] ?? 3;
            if (impA !== impB) return impA - impB;
            return (b.lastActionDate || '').localeCompare(a.lastActionDate || '');
        });

        billGrid.innerHTML = bills.map(bill => {
            const typeClass = bill.billType === 'pro' ? 'pro-science' : 'anti-science';
            const stanceClass = bill.stance ? bill.stance.toLowerCase() : '';
            const impactClass = bill.impact ? bill.impact.toLowerCase() : '';
            const levelClass = bill.level === 'Federal' ? 'federal' : (bill.level === 'Local' ? 'local' : '');
            const isDead = SAFE_CONFIG.DEAD_STATUSES.includes(bill.status);
            const statusDotClass = isDead ? 'dead' : (bill.impact === 'High' ? 'urgent' : 'active');
            const summaryExcerpt = bill.summary ? (bill.summary.length > 150 ? bill.summary.substring(0, 150) + '...' : bill.summary) : '';
            const stateName = (selectedState === 'ALL' && bill.state !== 'US') ? (SAFE_CONFIG.STATES[bill.state] || bill.state) : '';
            const billTypeLabel = bill.billType === 'pro' ? 'PRO-SCIENCE' : 'ANTI-SCIENCE';
            const billTypeClass = bill.billType === 'pro' ? 'badge-pro' : 'badge-anti';
            const isSelected = selectedBills.has(bill.billId);

            return `
                <div class="bill-card-wrapper ${isSelected ? 'selected' : ''}">
                    <label class="bill-select-checkbox" onclick="event.stopPropagation();">
                        <input type="checkbox" class="bill-checkbox" data-bill-id="${escapeHtml(bill.billId)}" ${isSelected ? 'checked' : ''}>
                        <span class="bill-checkbox-custom"></span>
                    </label>
                    <a href="action.html?bill=${encodeURIComponent(bill.billId)}&state=${encodeURIComponent(selectedState === 'ALL' ? bill.state : selectedState)}" class="bill-card ${typeClass}">
                        <div class="bill-card-header">
                            <span class="bill-card-number">${escapeHtml(bill.billNumber)}</span>
                            <div class="bill-card-meta">
                                <span class="badge ${billTypeClass}">${billTypeLabel}</span>
                                <span class="badge badge-level ${levelClass}">${escapeHtml(bill.level)}</span>
                                <span class="badge badge-impact ${impactClass}">${escapeHtml(bill.impact)}</span>
                            </div>
                        </div>
                        <div class="bill-card-title">${escapeHtml(bill.title)}</div>
                        ${bill.category ? `<span class="bill-category-tag">${escapeHtml(bill.category)}</span>` : ''}
                        <div class="bill-card-summary">${escapeHtml(summaryExcerpt)}</div>
                        <div class="bill-card-meta">
                            <span class="status-indicator">
                                <span class="status-dot ${statusDotClass}"></span>
                                ${escapeHtml(bill.status)}
                            </span>
                            ${stateName ? `<span class="badge badge-state">${escapeHtml(stateName)}</span>` : ''}
                            ${bill.stance ? `<span class="badge badge-stance ${stanceClass}">SAFE: ${escapeHtml(bill.stance)}</span>` : ''}
                        </div>
                        <div class="bill-card-footer">
                            <span class="bill-card-date">${bill.lastActionDate ? 'Last action: ' + escapeHtml(bill.lastActionDate) : ''}</span>
                            <div class="bill-card-share-row">
                                <button class="bill-share-btn" onclick="event.preventDefault();event.stopPropagation();shareBill('${escapeHtml(bill.billId)}','${escapeHtml(bill.billNumber)}','${escapeHtml(bill.title.replace(/'/g, ''))}','twitter')" title="Share on X">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                                </button>
                                <button class="bill-share-btn" onclick="event.preventDefault();event.stopPropagation();shareBill('${escapeHtml(bill.billId)}','${escapeHtml(bill.billNumber)}','${escapeHtml(bill.title.replace(/'/g, ''))}','facebook')" title="Share on Facebook">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                                </button>
                                <span class="card-arrow">&rarr;</span>
                            </div>
                        </div>
                    </a>
                </div>
            `;
        }).join('');

        // Attach checkbox listeners
        billGrid.querySelectorAll('.bill-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const billId = e.target.dataset.billId;
                if (e.target.checked) {
                    selectedBills.add(billId);
                } else {
                    selectedBills.delete(billId);
                }
                e.target.closest('.bill-card-wrapper').classList.toggle('selected', e.target.checked);
                updateMultiBillBar();
                updateSelectAllBtn();
            });
        });
    }

    // Global share function for bill cards
    window.shareBill = function(billId, billNumber, billTitle, platform) {
        const shareUrl = window.location.origin + window.location.pathname + `?bill=${encodeURIComponent(billId)}`;
        const shareText = `${billNumber}: ${billTitle} - Track this bill on SAFE Action`;

        if (platform === 'twitter') {
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank', 'width=550,height=420');
        } else if (platform === 'facebook') {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank', 'width=550,height=420');
        }
    };

    function setupShareButtons() {
        document.getElementById('share-twitter').addEventListener('click', () => {
            const text = getShareText();
            const url = window.location.href;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
        });

        document.getElementById('share-facebook').addEventListener('click', () => {
            const url = window.location.href;
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
        });

        document.getElementById('share-linkedin').addEventListener('click', () => {
            const url = window.location.href;
            window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
        });

        document.getElementById('share-copy-link').addEventListener('click', () => {
            const url = window.location.href;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    const success = document.getElementById('share-copy-success');
                    success.classList.add('show');
                    setTimeout(() => success.classList.remove('show'), 2500);
                });
            }
        });
    }

    function getShareText() {
        const stateName = selectedState === 'ALL' ? 'all states' : (SAFE_CONFIG.STATES[selectedState] || selectedState);
        const active = allBills.filter(b => b.isActive === 'Yes').length;
        const pro = allBills.filter(b => b.billType === 'pro').length;
        const anti = allBills.filter(b => b.billType === 'anti').length;
        return `Tracking ${active} active science bills in ${stateName}: ${pro} pro-science, ${anti} anti-science. See what's happening in your state.`;
    }

    function renderMediaStats(bills) {
        const grid = document.getElementById('media-stats-grid');
        const active = bills.filter(b => b.isActive === 'Yes');
        const proBills = active.filter(b => b.billType === 'pro');
        const antiBills = active.filter(b => b.billType === 'anti');
        const highPriority = active.filter(b => b.impact === 'High');

        // Get unique categories
        const categories = {};
        active.forEach(b => {
            if (b.category) categories[b.category] = (categories[b.category] || 0) + 1;
        });

        const stateOrAll = selectedState === 'ALL' ? 'Nationwide' : (SAFE_CONFIG.STATES[selectedState] || selectedState);

        grid.innerHTML = `
            <div class="media-stat-block">
                <div class="media-stat-number">${active.length}</div>
                <div class="media-stat-label">Active Bills in ${escapeHtml(stateOrAll)}</div>
            </div>
            <div class="media-stat-block pro">
                <div class="media-stat-number">${proBills.length}</div>
                <div class="media-stat-label">Pro-Science Bills</div>
            </div>
            <div class="media-stat-block anti">
                <div class="media-stat-number">${antiBills.length}</div>
                <div class="media-stat-label">Anti-Science Bills</div>
            </div>
            <div class="media-stat-block">
                <div class="media-stat-number">${highPriority.length}</div>
                <div class="media-stat-label">High Priority</div>
            </div>
        `;

        // Trending topics
        if (Object.keys(categories).length > 0) {
            const topCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 5);
            grid.innerHTML += `
                <div class="media-stat-block wide">
                    <div class="media-stat-label" style="margin-bottom:8px;">Top Categories</div>
                    <div class="media-trending-tags">
                        ${topCategories.map(([cat, count]) => `<span class="trending-tag">${escapeHtml(cat)} (${count})</span>`).join('')}
                    </div>
                </div>
            `;
        }
    }

    function setupMediaSection() {
        const embedBtn = document.getElementById('media-embed-btn');
        const downloadBtn = document.getElementById('media-download-btn');
        const embedBox = document.getElementById('embed-code-box');
        const embedCode = document.getElementById('embed-code');
        const copyEmbed = document.getElementById('copy-embed');

        embedBtn.addEventListener('click', () => {
            const url = window.location.href;
            embedCode.value = `<iframe src="${url}" width="100%" height="600" frameborder="0" title="SAFE Action Legislation Tracker"></iframe>`;
            embedBox.style.display = embedBox.style.display === 'none' ? '' : 'none';
        });

        copyEmbed.addEventListener('click', () => {
            embedCode.select();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(embedCode.value);
            } else {
                document.execCommand('copy');
            }
        });

        downloadBtn.addEventListener('click', () => {
            downloadCSV(allBills);
        });
    }

    function downloadCSV(bills) {
        const headers = ['Bill ID', 'State', 'Level', 'Bill Number', 'Title', 'Type', 'Category', 'Status', 'Active', 'Impact', 'Stance', 'Last Action Date', 'Summary'];
        const rows = bills.map(b => [
            b.billId, b.state, b.level, b.billNumber, b.title, b.billType, b.category || '', b.status, b.isActive, b.impact, b.stance, b.lastActionDate || '', b.summary || ''
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`));

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `safe-action-legislation-${selectedState || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function handleEmailSignup(e) {
        e.preventDefault();
        const email = document.getElementById('signup-email').value.trim();
        if (!email) return;

        try {
            await LegislationAPI.submitEmailSignup(email, selectedState || '', 'tracker');
            signupForm.style.display = 'none';
            signupSuccess.classList.add('show');
        } catch (error) {
            console.error('Signup error:', error);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Multi-Bill Selection ---
    function initMultiBill() {
        document.getElementById('multi-bill-compose').addEventListener('click', showMultiBillCompose);
        document.getElementById('multi-bill-clear').addEventListener('click', clearMultiBillSelection);
        document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);

        // Tab switching for multi-bill
        multiBillComposeSection.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                multiBillComposeSection.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                multiBillComposeSection.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Copy buttons
        document.getElementById('multi-copy-email').addEventListener('click', () => {
            const subject = document.getElementById('multi-email-subject').value;
            const body = document.getElementById('multi-email-body').value;
            copyToClipboard(`Subject: ${subject}\n\n${body}`, 'multi-copy-email-success');
        });

        document.getElementById('multi-open-mailto').addEventListener('click', () => {
            const subject = encodeURIComponent(document.getElementById('multi-email-subject').value);
            const body = encodeURIComponent(document.getElementById('multi-email-body').value);
            const repSelect = document.getElementById('multi-rep-select');
            const repEmail = repSelect.value || '';
            window.open(`mailto:${repEmail}?subject=${subject}&body=${body}`, '_self');
        });

        document.getElementById('multi-copy-phone').addEventListener('click', () => {
            copyToClipboard(document.getElementById('multi-phone-script').value, 'multi-copy-phone-success');
        });

        // Update template when user info changes
        document.getElementById('multi-user-name').addEventListener('input', debounce(buildMultiBillTemplate, 300));
        document.getElementById('multi-user-city').addEventListener('input', debounce(buildMultiBillTemplate, 300));
        document.getElementById('multi-rep-select').addEventListener('change', buildMultiBillTemplate);
    }

    function updateMultiBillBar() {
        const count = selectedBills.size;
        multiBillCountNum.textContent = count;
        multiBillBar.style.display = count > 0 ? '' : 'none';
        if (count === 0) {
            multiBillComposeSection.style.display = 'none';
        }
    }

    function toggleSelectAll() {
        const btn = document.getElementById('select-all-btn');
        const checkboxes = billGrid.querySelectorAll('.bill-checkbox');
        const allSelected = checkboxes.length > 0 && [...checkboxes].every(cb => cb.checked);

        if (allSelected) {
            // Deselect all
            clearMultiBillSelection();
        } else {
            // Select all visible
            checkboxes.forEach(cb => {
                cb.checked = true;
                const billId = cb.dataset.billId;
                selectedBills.add(billId);
                cb.closest('.bill-card-wrapper').classList.add('selected');
            });
            updateMultiBillBar();
        }
        updateSelectAllBtn();
    }

    function updateSelectAllBtn() {
        const btn = document.getElementById('select-all-btn');
        if (!btn) return;
        const checkboxes = billGrid.querySelectorAll('.bill-checkbox');
        const allSelected = checkboxes.length > 0 && [...checkboxes].every(cb => cb.checked);

        if (allSelected) {
            btn.innerHTML = 'Deselect All';
            btn.classList.add('deselect');
        } else {
            btn.innerHTML = '<span class="btn-star">&#9733;</span> Select All Bills';
            btn.classList.remove('deselect');
        }
    }

    function clearMultiBillSelection() {
        selectedBills.clear();
        billGrid.querySelectorAll('.bill-checkbox').forEach(cb => {
            cb.checked = false;
            cb.closest('.bill-card-wrapper').classList.remove('selected');
        });
        updateMultiBillBar();
        updateSelectAllBtn();
    }

    async function showMultiBillCompose() {
        if (selectedBills.size === 0) return;

        multiBillComposeSection.style.display = '';
        multiBillComposeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Load reps for this state
        const repSelect = document.getElementById('multi-rep-select');
        repSelect.innerHTML = '<option value="">Select a representative...</option>';

        try {
            const reps = await LegislationAPI.getRepresentatives(selectedState === 'ALL' ? null : selectedState);
            reps.forEach(rep => {
                const opt = document.createElement('option');
                opt.value = rep.email || '';
                opt.textContent = `${rep.name} (${rep.party}) - ${rep.chamber || rep.district || ''}`;
                opt.dataset.repName = rep.name;
                opt.dataset.repPhone = rep.phone || '';
                repSelect.appendChild(opt);
            });
        } catch (e) {}

        buildMultiBillTemplate();
        renderMultiBillSummary();
    }

    function buildMultiBillTemplate() {
        const yourName = document.getElementById('multi-user-name').value || '[Your Name]';
        const yourCity = document.getElementById('multi-user-city').value || '[Your City]';
        const repSelect = document.getElementById('multi-rep-select');
        const selectedOpt = repSelect.options[repSelect.selectedIndex];
        const repName = selectedOpt && selectedOpt.dataset && selectedOpt.dataset.repName
            ? selectedOpt.dataset.repName.replace(/^(Rep\.|Sen\.|Representative|Senator)\s*/i, '')
            : '[Representative Name]';

        const bills = getSelectedBillObjects();
        const proBills = bills.filter(b => b.billType === 'pro');
        const antiBills = bills.filter(b => b.billType === 'anti');
        const stateName = selectedState === 'ALL' ? 'our nation' : (SAFE_CONFIG.STATES[selectedState] || selectedState);

        // Build email
        let subject = '';
        if (proBills.length > 0 && antiBills.length > 0) {
            subject = `Support for pro-science bills & opposition to anti-science bills in ${stateName}`;
        } else if (proBills.length > 0) {
            subject = `Please SUPPORT pro-science legislation: ${proBills.map(b => b.billNumber).join(', ')}`;
        } else {
            subject = `Please OPPOSE anti-science legislation: ${antiBills.map(b => b.billNumber).join(', ')}`;
        }

        let body = `Dear ${repName},\n\nI am a constituent from ${yourCity} and I am writing to you about ${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} that affect science and public health in ${stateName}.\n\n`;

        if (proBills.length > 0) {
            body += `BILLS I URGE YOU TO SUPPORT:\n`;
            body += `I want to thank you and encourage your continued support for the following pro-science legislation:\n\n`;
            proBills.forEach(b => {
                body += `  * ${b.billNumber}: ${b.title}\n`;
                if (b.summary) body += `    ${b.summary.substring(0, 120)}${b.summary.length > 120 ? '...' : ''}\n`;
                body += `\n`;
            });
        }

        if (antiBills.length > 0) {
            if (proBills.length > 0) body += `\n`;
            body += `BILLS I URGE YOU TO OPPOSE:\n`;
            body += `I respectfully ask you to vote NO on the following anti-science legislation:\n\n`;
            antiBills.forEach(b => {
                body += `  * ${b.billNumber}: ${b.title}\n`;
                if (b.summary) body += `    ${b.summary.substring(0, 120)}${b.summary.length > 120 ? '...' : ''}\n`;
                body += `\n`;
            });
        }

        body += `Science-based policy protects the health and freedom of all your constituents. I urge you to stand on the side of evidence and public health.\n\n`;
        body += `Thank you for your time and service.\n\nSincerely,\n${yourName}\n${yourCity}, ${stateName}`;

        document.getElementById('multi-email-subject').value = subject;
        document.getElementById('multi-email-body').value = body;

        // Build phone script
        let phone = `Hello, my name is ${yourName} and I'm a constituent from ${yourCity}.\n\n`;
        phone += `I'm calling about ${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} related to science and public health.\n\n`;

        if (proBills.length > 0) {
            phone += `First, I want to thank ${repName} for supporting pro-science legislation and ask for continued support of:\n`;
            proBills.forEach(b => { phone += `  - ${b.billNumber}, the ${b.title}\n`; });
            phone += `\n`;
        }

        if (antiBills.length > 0) {
            phone += `I'm also calling to ask ${repName} to please vote NO on:\n`;
            antiBills.forEach(b => { phone += `  - ${b.billNumber}, the ${b.title}\n`; });
            phone += `\n`;
        }

        phone += `Science-based policy protects our community. Thank you for taking my call.`;
        document.getElementById('multi-phone-script').value = phone;

        // Update phone call button
        const phoneBtn = document.getElementById('multi-open-phone');
        if (phoneBtn) {
            const repPhone = selectedOpt && selectedOpt.dataset ? selectedOpt.dataset.repPhone || '' : '';
            if (repPhone) {
                phoneBtn.href = 'tel:' + repPhone.replace(/[^+\d]/g, '');
                phoneBtn.textContent = '\u{1F4DE} Call ' + repPhone;
                phoneBtn.style.display = '';
            } else {
                phoneBtn.style.display = 'none';
            }
        }
    }

    function getSelectedBillObjects() {
        return allBills.filter(b => selectedBills.has(b.billId));
    }

    function renderMultiBillSummary() {
        const summary = document.getElementById('multi-bill-summary');
        const bills = getSelectedBillObjects();
        const proBills = bills.filter(b => b.billType === 'pro');
        const antiBills = bills.filter(b => b.billType === 'anti');

        summary.innerHTML = `
            <h3 style="margin:16px 0 8px;font-size:1rem;">Selected Bills (${bills.length})</h3>
            ${proBills.length > 0 ? `
                <div class="multi-summary-group pro">
                    <strong style="color:var(--accent-green, #2e7d32);">Pro-Science (${proBills.length}):</strong>
                    ${proBills.map(b => `<span class="multi-summary-bill">${escapeHtml(b.billNumber)}: ${escapeHtml(b.title)}</span>`).join('')}
                </div>
            ` : ''}
            ${antiBills.length > 0 ? `
                <div class="multi-summary-group anti">
                    <strong style="color:var(--danger, #c0392b);">Anti-Science (${antiBills.length}):</strong>
                    ${antiBills.map(b => `<span class="multi-summary-bill">${escapeHtml(b.billNumber)}: ${escapeHtml(b.title)}</span>`).join('')}
                </div>
            ` : ''}
        `;
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
        try { document.execCommand('copy'); showCopySuccess(successId); }
        catch (e) { alert('Copy failed.'); }
        document.body.removeChild(textarea);
    }

    function showCopySuccess(id) {
        const el = document.getElementById(id);
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    }

    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // ── Intelligence Enrichment ──────────────────
    async function enrichBillsWithIntelligence(bills) {
        if (typeof IntelligenceAPI === 'undefined') return;
        const available = await IntelligenceAPI.isAvailable();
        if (!available) return;

        for (const bill of bills) {
            const cardEl = billGrid.querySelector(`[data-bill-id="${bill.billId}"]`)
                ?.closest('.bill-card-wrapper');
            if (!cardEl) continue;

            const billCard = cardEl.querySelector('.bill-card');
            if (!billCard || billCard.querySelector('.intel-badge-row')) continue;

            // Get legislators for this bill's state
            const state = bill.state === 'US' ? null : bill.state;
            const legislators = await IntelligenceAPI.getLegislators(state);
            if (legislators.length === 0) continue;

            // Count by category
            const counts = { champion: 0, 'likely-win': 0, 'fence-sitter': 0, unlikely: 0, opposed: 0 };
            legislators.forEach(leg => {
                const cat = (leg.persuadability || {}).category;
                if (cat && counts[cat] !== undefined) counts[cat]++;
            });

            const total = Object.values(counts).reduce((s, v) => s + v, 0);
            if (total === 0) continue;

            const badgeRow = document.createElement('div');
            badgeRow.className = 'intel-badge-row';
            badgeRow.innerHTML = [
                counts.champion > 0 ? `<span class="intel-badge intel-champion" title="Champions">${counts.champion} &#9733;</span>` : '',
                counts['likely-win'] > 0 ? `<span class="intel-badge intel-likely" title="Likely wins">${counts['likely-win']} &#10003;</span>` : '',
                counts['fence-sitter'] > 0 ? `<span class="intel-badge intel-fence" title="Fence-sitters">${counts['fence-sitter']} &#8646;</span>` : '',
                counts.unlikely > 0 ? `<span class="intel-badge intel-unlikely" title="Unlikely">${counts.unlikely} &#10007;</span>` : '',
                counts.opposed > 0 ? `<span class="intel-badge intel-opposed" title="Opposed">${counts.opposed} &#9888;</span>` : '',
            ].filter(Boolean).join('');
            billCard.appendChild(badgeRow);
        }
    }
});
