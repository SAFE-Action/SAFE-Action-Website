// ============================================
// SAFE Action - My Representatives Page Controller
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // ── Tab Switching ────────────────────────────
    document.querySelectorAll('.sub-nav-link[data-tab]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            // Update active button
            document.querySelectorAll('.sub-nav-link[data-tab]').forEach(function(b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            // Update active panel
            document.querySelectorAll('.tab-panel').forEach(function(panel) {
                panel.style.display = 'none';
                panel.classList.remove('active');
            });
            var target = document.getElementById('tab-' + tabId);
            if (target) {
                target.style.display = '';
                target.classList.add('active');
            }
            // Lazy-init bill browser
            if (tabId === 'browse-bills') {
                BillBrowser.init();
            }
        });
    });

    // Handle hash-based tab navigation (e.g., outreach.html#take-pledge)
    var hash = window.location.hash.replace('#', '');
    if (hash) {
        var hashBtn = document.querySelector('.sub-nav-link[data-tab="' + hash + '"]');
        if (hashBtn) hashBtn.click();
    }

    const addressForm = document.getElementById('address-form');
    const addressInput = document.getElementById('address-input');
    const addressSection = document.getElementById('address-section');
    const savedAddressBar = document.getElementById('saved-address-bar');
    const savedAddressText = document.getElementById('saved-address-text');
    const changeAddressBtn = document.getElementById('change-address-btn');
    const stateFallback = document.getElementById('state-fallback');
    const stateSelect = document.getElementById('state-select');
    const stateLookupBtn = document.getElementById('state-lookup-btn');
    const repGrid = document.getElementById('rep-grid');
    const repSection = document.getElementById('rep-section');
    const statsBar = document.getElementById('hub-stats');
    const loadingEl = document.getElementById('hub-loading');
    const errorEl = document.getElementById('hub-error');

    // Escape HTML to prevent XSS from API data
    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Check if Civic API is available
    const hasCivicKey = SAFE_CONFIG.GOOGLE_CIVIC_API_KEY && SAFE_CONFIG.GOOGLE_CIVIC_API_KEY.length > 5;

    // Show/hide address vs state fallback
    if (!hasCivicKey) {
        if (addressSection) addressSection.style.display = 'none';
        if (stateFallback) stateFallback.style.display = '';
        populateStateDropdown();
    } else {
        if (stateFallback) stateFallback.style.display = 'none';
    }

    // Check for saved address on load
    const saved = MyRepsHub.getSavedAddress();
    if (saved && hasCivicKey) {
        showSavedAddress(saved.address);
        loadFromSaved(saved);
    }

    // Address form submission
    if (addressForm) {
        addressForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const address = addressInput.value.trim();
            if (!address) return;
            await doAddressLookup(address);
        });
    }

    // Change address
    if (changeAddressBtn) {
        changeAddressBtn.addEventListener('click', () => {
            MyRepsHub.clearSavedAddress();
            if (savedAddressBar) savedAddressBar.style.display = 'none';
            if (addressSection) addressSection.style.display = '';
            if (repSection) repSection.style.display = 'none';
            if (statsBar) statsBar.style.display = 'none';
            if (addressInput) { addressInput.value = ''; addressInput.focus(); }
        });
    }

    // State fallback
    if (stateLookupBtn) {
        stateLookupBtn.addEventListener('click', async () => {
            const state = stateSelect.value;
            if (!state) return;
            await doStateLookup(state);
        });
    }
    if (stateSelect) {
        stateSelect.addEventListener('change', async () => {
            const state = stateSelect.value;
            if (state) await doStateLookup(state);
        });
    }

    function populateStateDropdown() {
        if (!stateSelect) return;
        const states = SAFE_CONFIG.STATES;
        Object.keys(states).forEach(code => {
            if (code === 'US') return;
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = states[code];
            stateSelect.appendChild(opt);
        });
    }

    function showSavedAddress(address) {
        if (savedAddressBar) {
            savedAddressBar.style.display = '';
            if (savedAddressText) savedAddressText.textContent = address;
        }
        if (addressSection) addressSection.style.display = 'none';
    }

    function showLoading() {
        if (loadingEl) loadingEl.style.display = '';
        if (repGrid) repGrid.textContent = '';
        if (repSection) repSection.style.display = '';
        if (errorEl) errorEl.style.display = 'none';
    }

    function hideLoading() {
        if (loadingEl) loadingEl.style.display = 'none';
    }

    function showError(msg) {
        hideLoading();
        if (errorEl) {
            errorEl.style.display = '';
            errorEl.querySelector('p').textContent = msg;
        }
    }

    async function doAddressLookup(address) {
        showLoading();
        const reps = await MyRepsHub.lookupAddress(address);
        if (!reps || reps.length === 0) {
            showError('Could not find representatives for that address. Please check the address and try again.');
            return;
        }
        showSavedAddress(address);
        hideLoading();
        renderReps(reps);
    }

    async function loadFromSaved(saved) {
        showLoading();
        // New saved format has state + districts instead of officials/offices
        if (saved.state) {
            const parsed = { state: saved.state, districts: saved.districts || [] };
            const reps = await MyRepsHub._loadRepsFromDivisions(parsed);
            hideLoading();
            renderReps(reps);
        } else {
            // Legacy fallback: use state from address
            hideLoading();
            showError('Saved address format outdated. Please enter your address again.');
        }
    }

    async function doStateLookup(stateCode) {
        showLoading();
        const reps = await MyRepsHub.getRepsByState(stateCode);
        hideLoading();
        if (reps.length === 0) {
            showError('No federal representatives found for this state.');
            return;
        }
        renderReps(reps);
    }

    function renderReps(reps) {
        if (!repGrid) return;

        // Sort by action priority (most urgent first)
        reps.sort((a, b) => (a.primaryAction?.priority || 9) - (b.primaryAction?.priority || 9));

        // Update stats
        renderStats(reps);

        // Build cards via DOM methods
        repGrid.textContent = '';
        reps.forEach((rep, i) => {
            const card = buildRepCard(rep, i, reps);
            repGrid.appendChild(card);
        });

        if (repSection) repSection.style.display = '';
        if (statsBar) statsBar.style.display = '';
    }

    function renderStats(reps) {
        let totalBills = 0;
        let noPledge = 0;

        reps.forEach(rep => {
            if (rep.bills) {
                totalBills += rep.bills.filter(b => b.billType === 'anti').length;
            }
            if (!rep.intel || rep.intel.persuadability?.category !== 'champion') {
                noPledge++;
            }
        });

        const el = (id, val) => {
            const e = document.getElementById(id);
            if (e) e.textContent = val;
        };
        el('stat-active-bills', totalBills);
        el('stat-reps-found', reps.length);
        el('stat-no-pledge', noPledge);
    }

    function buildRepCard(rep, idx, allReps) {
        const card = document.createElement('div');
        const action = rep.primaryAction || {};
        const actionClass = action.type === 'oppose-bill' ? 'action-oppose' : 'action-pledge';
        card.className = `rep-hub-card ${actionClass}`;

        // ── Header ──
        const header = document.createElement('div');
        header.className = 'rep-hub-card-header';

        // Photo
        const photoWrap = document.createElement('div');
        photoWrap.className = 'rep-hub-photo-wrap';
        if (rep.photoUrl) {
            const img = document.createElement('img');
            img.src = rep.photoUrl;
            img.alt = rep.name;
            img.className = 'rep-hub-photo';
            img.onerror = function() { this.style.display = 'none'; this.nextElementSibling.style.display = 'flex'; };
            photoWrap.appendChild(img);
            const placeholder = document.createElement('div');
            placeholder.className = 'rep-hub-photo-placeholder';
            placeholder.style.display = 'none';
            placeholder.textContent = rep.name.charAt(0);
            photoWrap.appendChild(placeholder);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'rep-hub-photo-placeholder';
            placeholder.textContent = rep.name.charAt(0);
            photoWrap.appendChild(placeholder);
        }
        header.appendChild(photoWrap);

        // Info block
        const info = document.createElement('div');
        info.className = 'rep-hub-info';
        const nameEl = document.createElement('h3');
        nameEl.className = 'rep-hub-name';
        nameEl.textContent = rep.name;
        info.appendChild(nameEl);

        const party = rep.party || '?';
        const partyBadge = document.createElement('span');
        partyBadge.className = `rep-hub-party badge ${party === 'R' ? 'party-r' : party === 'D' ? 'party-d' : 'party-i'}`;
        partyBadge.textContent = party === 'R' ? 'Republican' : party === 'D' ? 'Democrat' : rep.partyFull || party;
        info.appendChild(partyBadge);

        const officeEl = document.createElement('span');
        officeEl.className = 'rep-hub-office';
        officeEl.textContent = rep.office;
        info.appendChild(officeEl);
        header.appendChild(info);

        // Persuadability badge
        if (rep.intel && rep.intel.persuadability) {
            const p = rep.intel.persuadability;
            const cat = p.category || 'unknown';
            const score = p.score ?? '?';
            const pDiv = document.createElement('div');
            pDiv.className = `rep-hub-persuadability ${IntelligenceAPI.getCategoryBadgeClass(cat)}`;
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'persuadability-score';
            scoreSpan.textContent = `${score}/10`;
            const labelSpan = document.createElement('span');
            labelSpan.className = 'persuadability-label';
            labelSpan.textContent = IntelligenceAPI.getCategoryLabel(cat);
            pDiv.appendChild(scoreSpan);
            pDiv.appendChild(labelSpan);
            header.appendChild(pDiv);
        }
        card.appendChild(header);

        // ── Primary Action Bar ──
        const actionBar = document.createElement('div');
        actionBar.className = 'rep-hub-action';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'action-icon';
        iconSpan.innerHTML = action.type === 'oppose-bill' ? '&#9888;' : '&#9733;';
        actionBar.appendChild(iconSpan);

        const actionContent = document.createElement('div');
        actionContent.className = 'action-content';
        const actionStrong = document.createElement('strong');
        actionStrong.textContent = action.label || 'Take Action';
        actionContent.appendChild(actionStrong);
        const actionDesc = document.createElement('p');
        actionDesc.textContent = action.description || '';
        actionContent.appendChild(actionDesc);
        actionBar.appendChild(actionContent);

        const emailBtn = document.createElement('button');
        emailBtn.className = 'btn btn-primary rep-hub-email-btn';
        emailBtn.textContent = rep.email ? 'Send Email' : 'Get Template';
        emailBtn.addEventListener('click', () => openEmailAction(rep));
        actionBar.appendChild(emailBtn);

        if (rep.phone) {
            const callBtn = document.createElement('button');
            callBtn.className = 'btn btn-outline rep-hub-call-btn';
            callBtn.innerHTML = '&#128222; Call';
            callBtn.addEventListener('click', () => window.open('tel:' + rep.phone));
            actionBar.appendChild(callBtn);
        }
        card.appendChild(actionBar);

        // ── Expand Button ──
        const expandBtn = document.createElement('button');
        expandBtn.className = 'rep-hub-expand-btn';
        expandBtn.textContent = 'Show Details';
        card.appendChild(expandBtn);

        // ── Detail Section (hidden) ──
        const detail = document.createElement('div');
        detail.className = 'rep-hub-detail';
        detail.style.display = 'none';

        // Intelligence profile
        if (rep.intel && rep.intel.persuadability) {
            const p = rep.intel.persuadability;
            const intelDiv = document.createElement('div');
            intelDiv.className = 'rep-hub-intel';
            const intelTitle = document.createElement('h4');
            intelTitle.textContent = 'Intelligence Profile';
            intelDiv.appendChild(intelTitle);
            const intelP = document.createElement('p');
            intelP.textContent = p.reasoning || 'No detailed analysis available.';
            intelDiv.appendChild(intelP);
            if (p.key_factors && p.key_factors.length) {
                const factorsDiv = document.createElement('div');
                factorsDiv.className = 'intel-factors';
                factorsDiv.textContent = 'Key Factors: ' + p.key_factors.join(', ');
                intelDiv.appendChild(factorsDiv);
            }
            detail.appendChild(intelDiv);
        }

        // Bills
        if (rep.bills && rep.bills.length > 0) {
            const billsDiv = document.createElement('div');
            billsDiv.className = 'rep-hub-bills';
            const billsTitle = document.createElement('h4');
            billsTitle.textContent = `Active Bills in Their Jurisdiction (${rep.bills.length})`;
            billsDiv.appendChild(billsTitle);
            rep.bills.slice(0, 5).forEach(b => {
                const item = document.createElement('div');
                item.className = 'rep-bill-item';
                const badge = document.createElement('span');
                badge.className = `badge ${b.billType === 'anti' ? 'badge-anti' : b.billType === 'pro' ? 'badge-pro' : 'badge-monitor'}`;
                badge.textContent = b.billType === 'anti' ? 'Oppose' : b.billType === 'pro' ? 'Support' : 'Monitor';
                item.appendChild(badge);
                const num = document.createElement('strong');
                num.textContent = ' ' + b.billNumber;
                item.appendChild(num);
                const titleText = document.createTextNode(' — ' + (b.title.length > 80 ? b.title.substring(0, 80) + '...' : b.title));
                item.appendChild(titleText);
                const statusSpan = document.createElement('span');
                statusSpan.className = 'rep-bill-status';
                statusSpan.textContent = b.status;
                item.appendChild(statusSpan);
                billsDiv.appendChild(item);
            });
            detail.appendChild(billsDiv);
        }

        // Candidates running for this seat
        if (rep.candidates && rep.candidates.length > 0) {
            var candSection = document.createElement('div');
            candSection.className = 'rep-hub-candidates';

            var candTitle = document.createElement('h4');
            candTitle.textContent = 'Ask Candidates to Take the Pledge';
            candSection.appendChild(candTitle);

            var candSubtext = document.createElement('p');
            candSubtext.className = 'cand-subtext';
            candSubtext.textContent = 'These candidates are running for this seat. Ask each one to take the SAFE Action pledge.';
            candSection.appendChild(candSubtext);

            var candList = document.createElement('div');
            candList.className = 'candidate-card-list';

            rep.candidates.forEach(function(c) {
                var card = document.createElement('div');
                card.className = 'candidate-action-card';
                var partyLetter = (c.party || '?').charAt(0).toUpperCase();
                if (partyLetter === 'R') card.classList.add('party-r');
                else if (partyLetter === 'D') card.classList.add('party-d');
                else card.classList.add('party-i');

                // Candidate header row
                var cardHeader = document.createElement('div');
                cardHeader.className = 'cand-card-header';
                var nameSpan = document.createElement('span');
                nameSpan.className = 'cand-card-name';
                nameSpan.textContent = c.name;
                cardHeader.appendChild(nameSpan);
                var partyBadge = document.createElement('span');
                partyBadge.className = 'cand-card-party';
                partyBadge.textContent = c.party || '?';
                cardHeader.appendChild(partyBadge);
                card.appendChild(cardHeader);

                var seatLabel = document.createElement('div');
                seatLabel.className = 'cand-card-seat';
                seatLabel.textContent = 'Running for: ' + rep.office;
                card.appendChild(seatLabel);

                // Get Template button
                var templateBtn = document.createElement('button');
                templateBtn.className = 'btn btn-sm cand-template-btn';
                templateBtn.textContent = 'Get Pledge Template';
                card.appendChild(templateBtn);

                // Template panel (hidden initially)
                var templatePanel = document.createElement('div');
                templatePanel.className = 'cand-template-panel';
                templatePanel.style.display = 'none';

                var candLastName = c.name.split(' ').pop();
                var candFullParty = c.party === 'R' ? 'Republican' : c.party === 'D' ? 'Democrat' : c.party || '';

                var emailSubject = 'Will you take the SAFE Action pledge on science and public health?';
                var emailBody = 'Dear ' + c.name + ',\n\n' +
                    'I am writing to ask you to take the SAFE Action pledge on science and public health policy.\n\n' +
                    'As a candidate for ' + rep.office + ', your position on science-based public health policy matters to voters in our community. The SAFE Action pledge commits candidates to supporting evidence-based public health measures, including maintaining strong vaccination programs.\n\n' +
                    'Taking this pledge shows voters that you prioritize science and public health. You can take the pledge at: https://safeaction.org/pledge.html\n\n' +
                    'Thank you for your time.\n\n' +
                    'Sincerely,\n[Your Name]\n[Your City, ' + rep.state + ']';

                // Subject line
                var subjLabel = document.createElement('div');
                subjLabel.className = 'template-field-label';
                subjLabel.textContent = 'Subject:';
                templatePanel.appendChild(subjLabel);
                var subjBox = document.createElement('div');
                subjBox.className = 'template-content template-subject';
                subjBox.textContent = emailSubject;
                templatePanel.appendChild(subjBox);

                // Body
                var bodyLabel = document.createElement('div');
                bodyLabel.className = 'template-field-label';
                bodyLabel.textContent = 'Email Body:';
                templatePanel.appendChild(bodyLabel);
                var bodyBox = document.createElement('pre');
                bodyBox.className = 'template-content template-body';
                bodyBox.textContent = emailBody;
                templatePanel.appendChild(bodyBox);

                // Copy button
                var copyBtn = document.createElement('button');
                copyBtn.className = 'btn btn-sm btn-outline cand-copy-btn';
                copyBtn.textContent = 'Copy Email';
                copyBtn.addEventListener('click', function() {
                    var fullText = 'Subject: ' + emailSubject + '\n\n' + emailBody;
                    navigator.clipboard.writeText(fullText).then(function() {
                        copyBtn.textContent = 'Copied!';
                        setTimeout(function() { copyBtn.textContent = 'Copy Email'; }, 2000);
                    }).catch(function() {
                        // Fallback
                        var ta = document.createElement('textarea');
                        ta.value = fullText;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        copyBtn.textContent = 'Copied!';
                        setTimeout(function() { copyBtn.textContent = 'Copy Email'; }, 2000);
                    });
                });
                templatePanel.appendChild(copyBtn);

                // FEC lookup link if available
                if (c.fecId) {
                    var fecLink = document.createElement('a');
                    fecLink.href = 'https://www.fec.gov/data/candidate/' + c.fecId + '/';
                    fecLink.target = '_blank';
                    fecLink.rel = 'noopener';
                    fecLink.className = 'cand-fec-link';
                    fecLink.textContent = 'Find contact info on FEC.gov \u2192';
                    templatePanel.appendChild(fecLink);
                }

                card.appendChild(templatePanel);

                // Toggle template visibility
                templateBtn.addEventListener('click', function() {
                    var isVisible = templatePanel.style.display !== 'none';
                    templatePanel.style.display = isVisible ? 'none' : '';
                    templateBtn.textContent = isVisible ? 'Get Pledge Template' : 'Hide Template';
                });

                candList.appendChild(card);
            });

            candSection.appendChild(candList);
            detail.appendChild(candSection);
        }

        // Contact info
        if (rep.phone || rep.email) {
            const contactDiv = document.createElement('div');
            contactDiv.className = 'rep-hub-contact';
            const contactTitle = document.createElement('h4');
            contactTitle.textContent = 'Contact Information';
            contactDiv.appendChild(contactTitle);
            if (rep.phone) {
                const phoneP = document.createElement('p');
                phoneP.innerHTML = '<strong>Phone:</strong> ';
                const phoneLink = document.createElement('a');
                phoneLink.href = 'tel:' + rep.phone;
                phoneLink.textContent = rep.phone;
                phoneP.appendChild(phoneLink);
                contactDiv.appendChild(phoneP);
            }
            if (rep.email) {
                const emailP = document.createElement('p');
                emailP.innerHTML = '<strong>Email:</strong> ';
                const emailLink = document.createElement('a');
                emailLink.href = 'mailto:' + rep.email;
                emailLink.textContent = rep.email;
                emailP.appendChild(emailLink);
                contactDiv.appendChild(emailP);
            }
            detail.appendChild(contactDiv);
        }

        // Email template
        const template = generateTemplate(rep, action);
        const templateDiv = document.createElement('div');
        templateDiv.className = 'rep-hub-template';
        const templateTitle = document.createElement('h4');
        templateTitle.textContent = 'Email Template';
        templateDiv.appendChild(templateTitle);

        const subjectField = document.createElement('div');
        subjectField.className = 'template-field';
        const subjectLabel = document.createElement('label');
        subjectLabel.textContent = 'Subject';
        subjectField.appendChild(subjectLabel);
        const subjectInput = document.createElement('input');
        subjectInput.type = 'text';
        subjectInput.value = template.subject;
        subjectInput.readOnly = true;
        subjectField.appendChild(subjectInput);
        templateDiv.appendChild(subjectField);

        const bodyField = document.createElement('div');
        bodyField.className = 'template-field';
        const bodyLabel = document.createElement('label');
        bodyLabel.textContent = 'Body';
        bodyField.appendChild(bodyLabel);
        const bodyTextarea = document.createElement('textarea');
        bodyTextarea.rows = 8;
        bodyTextarea.readOnly = true;
        bodyTextarea.value = template.body;
        bodyField.appendChild(bodyTextarea);
        templateDiv.appendChild(bodyField);

        const templateActions = document.createElement('div');
        templateActions.className = 'template-actions';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-primary';
        copyBtn.textContent = 'Copy to Clipboard';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(bodyTextarea.value).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
            });
        });
        templateActions.appendChild(copyBtn);
        if (rep.email) {
            const mailtoLink = document.createElement('a');
            mailtoLink.className = 'btn btn-outline';
            mailtoLink.href = `mailto:${rep.email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`;
            mailtoLink.textContent = 'Open in Email App';
            templateActions.appendChild(mailtoLink);
        }
        templateDiv.appendChild(templateActions);
        detail.appendChild(templateDiv);

        // Phone script
        if (rep.phone) {
            const phoneDiv = document.createElement('div');
            phoneDiv.className = 'rep-hub-template';
            const phoneTitle = document.createElement('h4');
            phoneTitle.textContent = 'Phone Script';
            phoneDiv.appendChild(phoneTitle);
            const phoneTextarea = document.createElement('textarea');
            phoneTextarea.rows = 6;
            phoneTextarea.readOnly = true;
            phoneTextarea.value = generatePhoneScript(rep, action);
            phoneDiv.appendChild(phoneTextarea);
            const phoneActions = document.createElement('div');
            phoneActions.className = 'template-actions';
            const phoneCopyBtn = document.createElement('button');
            phoneCopyBtn.className = 'btn btn-primary';
            phoneCopyBtn.textContent = 'Copy Script';
            phoneCopyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(phoneTextarea.value).then(() => {
                    phoneCopyBtn.textContent = 'Copied!';
                    setTimeout(() => { phoneCopyBtn.textContent = 'Copy Script'; }, 2000);
                });
            });
            phoneActions.appendChild(phoneCopyBtn);
            const phoneLink = document.createElement('a');
            phoneLink.className = 'btn btn-outline';
            phoneLink.href = 'tel:' + rep.phone;
            phoneLink.innerHTML = '&#128222; Open in Phone App';
            phoneActions.appendChild(phoneLink);
            phoneDiv.appendChild(phoneActions);
            detail.appendChild(phoneDiv);
        }

        card.appendChild(detail);

        // Expand/collapse toggle
        expandBtn.addEventListener('click', () => {
            const isOpen = detail.style.display !== 'none';
            detail.style.display = isOpen ? 'none' : '';
            expandBtn.textContent = isOpen ? 'Show Details' : 'Hide Details';
        });

        return card;
    }

    function generateTemplate(rep, action) {
        const title = rep.office.includes('Senate') ? 'Senator' : 'Representative';
        const lastName = rep.name.split(' ').pop();

        if (action.type === 'oppose-bill' && action.bill) {
            return {
                subject: `Please OPPOSE ${action.bill.billNumber} - ${action.bill.title.substring(0, 60)}`,
                body: `Dear ${title} ${lastName},

I am writing as a concerned constituent to urge you to OPPOSE ${action.bill.billNumber}, "${action.bill.title}".

This legislation undermines public health protections that keep our communities safe. As your constituent, I urge you to stand with science and evidence-based policy by voting NO on this bill.

Thank you for your time and service.

Sincerely,
[Your Name]
[Your City, ${rep.state}]`
            };
        }

        return {
            subject: 'Will you take the SAFE Action pledge on science and public health?',
            body: `Dear ${title} ${lastName},

I am writing as a concerned constituent to ask you to take the SAFE Action pledge on science and public health policy.

The SAFE Action pledge commits elected officials to supporting evidence-based public health measures, including maintaining strong vaccination programs that protect our communities.

Taking this pledge shows your constituents that you prioritize science and public health. You can take the pledge at: https://safeaction.org/pledge.html

Thank you for your time and service.

Sincerely,
[Your Name]
[Your City, ${rep.state}]`
        };
    }

    function generatePhoneScript(rep, action) {
        const title = rep.office.includes('Senate') ? 'Senator' : 'Representative';
        const lastName = rep.name.split(' ').pop();

        if (action.type === 'oppose-bill' && action.bill) {
            return `Hello, my name is [Your Name] and I'm a constituent from [Your City].

I'm calling to ask ${title} ${lastName} to please OPPOSE ${action.bill.billNumber}, "${action.bill.title}".

This bill would weaken important public health protections and I believe it puts our community at risk. I urge the ${title} to vote NO on this bill.

Thank you for taking my call.`;
        }

        return `Hello, my name is [Your Name] and I'm a constituent from [Your City].

I'm calling to ask ${title} ${lastName} to take the SAFE Action pledge on science and public health.

The pledge commits officials to supporting evidence-based public health measures, including strong vaccination programs. I believe this is important for our community.

Thank you for taking my call.`;
    }

    function openEmailAction(rep) {
        const action = rep.primaryAction || {};
        const template = generateTemplate(rep, action);

        if (rep.email) {
            window.open(`mailto:${rep.email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`);
        } else {
            navigator.clipboard.writeText(`Subject: ${template.subject}\n\n${template.body}`).then(() => {
                alert('Email template copied to clipboard! Find your representative\'s email on their official website.');
            });
        }
        trackAction('email');
    }

    function trackAction(type) {
        try {
            const key = 'safe_actions';
            const actions = JSON.parse(localStorage.getItem(key) || '{}');
            actions[type] = (actions[type] || 0) + 1;
            actions.total = (actions.total || 0) + 1;
            localStorage.setItem(key, JSON.stringify(actions));
        } catch (e) {}
    }
});

// ============================================
// Bill Browser (Browse Bills Tab)
// ============================================
var BillBrowser = {
    _initialized: false,
    _allBills: [],

    init: function() {
        if (this._initialized) return;
        this._initialized = true;

        // Populate state dropdown
        var stateSelect = document.getElementById('bb-state');
        if (stateSelect && typeof SAFE_CONFIG !== 'undefined') {
            var states = SAFE_CONFIG.STATES;
            Object.keys(states).forEach(function(code) {
                if (code === 'US') return; // Skip federal — bills are state-level
                var opt = document.createElement('option');
                opt.value = code;
                opt.textContent = states[code];
                stateSelect.appendChild(opt);
            });
        }

        // Add filter listeners
        var self = this;
        ['bb-state', 'bb-stance', 'bb-status', 'bb-impact'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function() { self.render(); });
        });
        var searchEl = document.getElementById('bb-search');
        if (searchEl) {
            var debounceTimer;
            searchEl.addEventListener('input', function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() { self.render(); }, 300);
            });
        }

        // Load data
        this.loadBills();
    },

    loadBills: function() {
        var self = this;
        var loading = document.getElementById('bb-loading');
        if (loading) loading.style.display = '';

        if (typeof LegislationAPI === 'undefined') {
            if (loading) loading.style.display = 'none';
            return;
        }

        LegislationAPI.getLegislation(null).then(function(bills) {
            self._allBills = bills || [];
            if (loading) loading.style.display = 'none';
            self.render();
        }).catch(function(err) {
            console.error('Bill browser load error:', err);
            if (loading) loading.style.display = 'none';
            self.render();
        });
    },

    getFilteredBills: function() {
        var state = (document.getElementById('bb-state') || {}).value || '';
        var stance = (document.getElementById('bb-stance') || {}).value || '';
        var status = (document.getElementById('bb-status') || {}).value || '';
        var impact = (document.getElementById('bb-impact') || {}).value || '';
        var search = ((document.getElementById('bb-search') || {}).value || '').toLowerCase().trim();

        return this._allBills.filter(function(bill) {
            if (state && bill.state !== state) return false;
            if (stance && bill.billType !== stance) return false;
            if (status === 'active') {
                if (bill.isActive !== 'Yes') return false;
            } else if (status && bill.status !== status) {
                return false;
            }
            if (impact && bill.impact !== impact) return false;
            if (search) {
                var haystack = [
                    bill.billNumber || '',
                    bill.title || '',
                    bill.summary || '',
                    bill.sponsor || '',
                    bill.state || ''
                ].join(' ').toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            return true;
        });
    },

    render: function() {
        var grid = document.getElementById('bb-grid');
        var countEl = document.getElementById('bb-count');
        var emptyEl = document.getElementById('bb-empty');
        if (!grid) return;

        var bills = this.getFilteredBills();

        // Update count
        if (countEl) {
            countEl.textContent = bills.length + ' bill' + (bills.length !== 1 ? 's' : '') + ' found';
        }

        // Clear grid
        grid.innerHTML = '';

        if (bills.length === 0) {
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        // Sort: high impact first, then by state
        var impactOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
        bills.sort(function(a, b) {
            var ia = impactOrder[a.impact] !== undefined ? impactOrder[a.impact] : 3;
            var ib = impactOrder[b.impact] !== undefined ? impactOrder[b.impact] : 3;
            if (ia !== ib) return ia - ib;
            return (a.state || '').localeCompare(b.state || '');
        });

        // Render cards
        var self = this;
        bills.forEach(function(bill) {
            grid.appendChild(self.buildCard(bill));
        });
    },

    buildCard: function(bill) {
        var card = document.createElement('a');
        card.href = 'action.html?bill=' + encodeURIComponent(bill.billId || '');
        card.className = 'bill-card';
        if (bill.billType === 'anti') card.classList.add('stance-oppose');
        else if (bill.billType === 'pro') card.classList.add('stance-support');
        else card.classList.add('stance-monitor');

        // Header
        var header = document.createElement('div');
        header.className = 'bill-card-header';

        var number = document.createElement('span');
        number.className = 'bill-card-number';
        number.textContent = bill.billNumber || 'Unknown';
        header.appendChild(number);

        var stateBadge = document.createElement('span');
        stateBadge.className = 'bill-card-state';
        stateBadge.textContent = bill.state || '';
        stateBadge.style.cssText = 'background:#3C3B6E;color:#fff;padding:0.15em 0.5em;border-radius:4px;font-size:0.75rem;font-weight:600;';
        header.appendChild(stateBadge);

        card.appendChild(header);

        // Title
        var title = document.createElement('h3');
        title.className = 'bill-card-title';
        title.textContent = bill.title || 'Untitled';
        card.appendChild(title);

        // Summary (truncated)
        if (bill.summary) {
            var summary = document.createElement('p');
            summary.className = 'bill-card-summary';
            var text = bill.summary;
            if (text.length > 120) text = text.substring(0, 120) + '...';
            summary.textContent = text;
            card.appendChild(summary);
        }

        // Meta row
        var meta = document.createElement('div');
        meta.className = 'bill-card-meta';

        var statusSpan = document.createElement('span');
        statusSpan.textContent = bill.status || 'Unknown';
        meta.appendChild(statusSpan);

        if (bill.impact) {
            var impactSpan = document.createElement('span');
            impactSpan.textContent = bill.impact + ' Priority';
            impactSpan.style.cssText = 'font-weight:600;' + (bill.impact === 'High' ? 'color:#dc2626;' : bill.impact === 'Medium' ? 'color:#d97706;' : 'color:#6b7280;');
            meta.appendChild(impactSpan);
        }

        card.appendChild(meta);

        // Footer with sponsor
        if (bill.sponsor) {
            var footer = document.createElement('div');
            footer.className = 'bill-card-footer';
            var sponsorText = document.createElement('span');
            sponsorText.textContent = 'Sponsor: ' + bill.sponsor;
            footer.appendChild(sponsorText);
            card.appendChild(footer);
        }

        return card;
    }
};
