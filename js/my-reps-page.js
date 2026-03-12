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

    // ── Personalization (name + city for templates) ──
    const PERSON_KEY = 'safe_user_info';
    function getUserInfo() {
        try {
            return JSON.parse(localStorage.getItem(PERSON_KEY)) || {};
        } catch(e) { return {}; }
    }
    function saveUserInfo(name, city) {
        localStorage.setItem(PERSON_KEY, JSON.stringify({ name: name, city: city }));
    }
    function getUserName() { return getUserInfo().name || ''; }
    function getUserCity() { return getUserInfo().city || ''; }


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

    // ── Google Places Autocomplete ──────────────────
    // Validates the API key works before loading the full Maps JS SDK,
    // to avoid Google's intrusive error dialogs when APIs aren't enabled.
    function initAddressAutocomplete() {
        if (!addressInput) return;

        var apiKey = SAFE_CONFIG.GOOGLE_MAPS_API_KEY || SAFE_CONFIG.GOOGLE_CIVIC_API_KEY;
        if (!apiKey) return;

        // First, test the key with a lightweight geocode request.
        // If it fails, don't load the Maps JS SDK at all (avoids error dialogs).
        fetch('https://maps.googleapis.com/maps/api/geocode/json?address=test&key=' + apiKey)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error_message && data.error_message.includes('not activated')) {
                    console.warn('Maps API not fully activated — skipping Places Autocomplete');
                    return;
                }
                loadPlacesScript(apiKey);
            })
            .catch(function() {
                // Network error — skip autocomplete silently
                console.warn('Could not validate Maps API key — skipping autocomplete');
            });
    }

    function loadPlacesScript(apiKey) {
        var script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + apiKey + '&libraries=places&callback=__initSAFEPlaces';
        script.async = true;
        script.defer = true;
        script.onerror = function() {
            console.warn('Google Places API not available');
        };

        window.__initSAFEPlaces = function() {
            try {
                var autocomplete = new google.maps.places.Autocomplete(addressInput, {
                    types: ['address'],
                    componentRestrictions: { country: 'us' },
                    fields: ['formatted_address', 'address_components']
                });

                autocomplete.addListener('place_changed', function() {
                    var place = autocomplete.getPlace();
                    if (place && place.formatted_address) {
                        addressInput.value = place.formatted_address;
                        setTimeout(function() {
                            if (addressForm) {
                                addressForm.dispatchEvent(new Event('submit', { cancelable: true }));
                            }
                        }, 100);
                    }
                });

                addressInput.setAttribute('placeholder', 'Start typing your address...');
            } catch (e) {
                console.warn('Places Autocomplete init failed:', e);
                cleanupPlacesWidget();
            }
        };

        document.head.appendChild(script);
    }

    function cleanupPlacesWidget() {
        var pacContainers = document.querySelectorAll('.pac-container');
        pacContainers.forEach(function(el) { el.remove(); });
        if (addressInput) {
            addressInput.removeAttribute('aria-expanded');
            addressInput.removeAttribute('aria-owns');
            addressInput.removeAttribute('aria-autocomplete');
            addressInput.classList.remove('pac-target-input');
        }
        // Hide any remaining Google-injected elements
        var style = document.createElement('style');
        style.textContent = '.pac-icon, .pac-container, .pac-item, .dismissButton, .gm-err-container, .gm-style-pbc { display: none !important; }';
        document.head.appendChild(style);
    }

    initAddressAutocomplete();

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

    function autofillCityFromAddress() {
        try {
            var saved = JSON.parse(localStorage.getItem(MyRepsHub.STORAGE_KEY));
            if (saved && saved.normalizedAddress) {
                var city = saved.normalizedAddress.city || '';
                var state = saved.normalizedAddress.state || saved.state || '';
                var cityState = city && state ? city + ', ' + state : city || state || '';
                if (cityState && !getUserCity()) {
                    saveUserInfo(getUserName(), cityState);
                }
                // Always update the city input if it's empty
                var cityInput = document.getElementById('email-all-city');
                if (cityInput && !cityInput.value) {
                    cityInput.value = cityState;
                    saveUserInfo(getUserName(), cityState);
                }
            }
        } catch (e) {}
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
        autofillCityFromAddress();
    }

    async function loadFromSaved(saved) {
        showLoading();
        // New saved format has state + districts instead of officials/offices
        if (saved.state) {
            const parsed = { state: saved.state, districts: saved.districts || [] };
            const reps = await MyRepsHub._loadRepsFromDivisions(parsed);
            hideLoading();
            renderReps(reps);
            autofillCityFromAddress();
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

    var _currentReps = [];

    function renderReps(reps) {
        if (!repGrid) return;
        _currentReps = reps;

        // Sort by action priority (most urgent first)
        reps.sort(function(a, b) { return (a.primaryAction ? a.primaryAction.priority : 9) - (b.primaryAction ? b.primaryAction.priority : 9); });

        // Update stats
        renderStats(reps);

        // Build name/city personalization bar (below stats, above everything else)
        buildPersonalizeBar();

        // Build "Email All" action bar
        buildEmailAllBar(reps);

        // Build cards via DOM methods
        repGrid.textContent = '';
        reps.forEach(function(rep, i) {
            var card = buildRepCard(rep, i, reps);
            repGrid.appendChild(card);
        });

        if (repSection) repSection.style.display = '';
        if (statsBar) statsBar.style.display = '';
    }

    function buildPersonalizeBar() {
        var existing = document.getElementById('personalize-bar');
        if (existing) existing.remove();

        var bar = document.createElement('div');
        bar.id = 'personalize-bar';
        bar.style.cssText = 'background:linear-gradient(135deg,#1a1a2e,#2d2d5e);border-radius:12px;padding:16px 20px;margin:16px 0 8px;border-left:4px solid #B22234;';

        var heading = document.createElement('strong');
        heading.style.cssText = 'color:#fff;font-size:0.95rem;display:block;margin-bottom:8px;';
        heading.textContent = 'Personalize Your Emails';
        bar.appendChild(heading);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';

        var nameGroup = document.createElement('div');
        nameGroup.style.cssText = 'flex:1;min-width:140px;';
        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Your Name';
        nameLabel.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;color:rgba(255,255,255,0.8);margin-bottom:4px;';
        nameGroup.appendChild(nameLabel);
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'email-all-name';
        nameInput.placeholder = 'Enter your name';
        nameInput.value = getUserName();
        nameInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;font-size:0.9rem;background:rgba(255,255,255,0.95);color:#1a1a2e;';
        nameInput.addEventListener('change', function() { saveUserInfo(nameInput.value.trim(), document.getElementById('email-all-city').value.trim()); });
        nameGroup.appendChild(nameInput);
        row.appendChild(nameGroup);

        var cityGroup = document.createElement('div');
        cityGroup.style.cssText = 'flex:1;min-width:140px;';
        var cityLabel = document.createElement('label');
        cityLabel.textContent = 'Your City';
        cityLabel.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;color:rgba(255,255,255,0.8);margin-bottom:4px;';
        cityGroup.appendChild(cityLabel);
        var cityInput = document.createElement('input');
        cityInput.type = 'text';
        cityInput.id = 'email-all-city';
        cityInput.placeholder = 'Enter your city';
        cityInput.value = getUserCity();
        cityInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;font-size:0.9rem;background:rgba(255,255,255,0.95);color:#1a1a2e;';
        cityInput.addEventListener('change', function() { saveUserInfo(document.getElementById('email-all-name').value.trim(), cityInput.value.trim()); });
        cityGroup.appendChild(cityInput);
        row.appendChild(cityGroup);

        bar.appendChild(row);

        // Insert after stats bar
        if (statsBar && statsBar.parentNode) {
            statsBar.parentNode.insertBefore(bar, statsBar.nextSibling);
        }
    }

    function validatePersonalizeInputs() {
        var nameInput = document.getElementById('email-all-name');
        var cityInput = document.getElementById('email-all-city');
        var name = nameInput ? nameInput.value.trim() : '';
        var city = cityInput ? cityInput.value.trim() : '';
        if (!name) { if (nameInput) { nameInput.focus(); nameInput.style.borderColor = '#B22234'; } return false; }
        if (!city) { if (cityInput) { cityInput.focus(); cityInput.style.borderColor = '#B22234'; } return false; }
        saveUserInfo(name, city);
        return true;
    }

    function buildEmailAllBar(reps) {
        var existing = document.getElementById('email-all-bar');
        if (existing) existing.remove();

        if (reps.length === 0) return;

        var bar = document.createElement('div');
        bar.id = 'email-all-bar';
        bar.className = 'email-all-bar';

        var inner = document.createElement('div');
        inner.className = 'email-all-inner';

        var text = document.createElement('div');
        text.className = 'email-all-text';
        var heading = document.createElement('strong');
        heading.textContent = 'Take Action Now';
        text.appendChild(heading);
        var desc = document.createElement('p');
        desc.textContent = 'Send each of your ' + reps.length + ' representatives a personalized email asking them to take the SAFE Action pledge on science.';
        text.appendChild(desc);
        inner.appendChild(text);

        var btnWrap = document.createElement('div');
        btnWrap.className = 'email-all-buttons';

        var emailAllBtn = document.createElement('button');
        emailAllBtn.className = 'btn btn-primary email-all-btn';
        emailAllBtn.textContent = 'Email All ' + reps.length + ' Reps';
        emailAllBtn.addEventListener('click', function() {
            if (!validatePersonalizeInputs()) return;
            emailAllReps(reps, emailAllBtn, bar);
        });
        btnWrap.appendChild(emailAllBtn);

        inner.appendChild(btnWrap);
        bar.appendChild(inner);

        // Insert before rep grid
        if (repGrid && repGrid.parentNode) {
            repGrid.parentNode.insertBefore(bar, repGrid);
        }
    }

    function emailAllReps(reps, startBtn, bar) {
        var idx = 0;
        var total = reps.length;
        var userName = getUserName();
        var userCity = getUserCity();

        // Replace the bar content with a step-by-step UI
        var inner = bar.querySelector('.email-all-inner');
        inner.textContent = '';

        // Progress header
        var progressHeader = document.createElement('div');
        progressHeader.className = 'email-all-text';
        inner.appendChild(progressHeader);

        // Current rep info area
        var repInfo = document.createElement('div');
        repInfo.className = 'email-all-rep-info';
        repInfo.style.cssText = 'background:rgba(255,255,255,0.1);border-radius:8px;padding:12px 16px;margin:8px 0;';
        inner.appendChild(repInfo);

        // Button area
        var btnArea = document.createElement('div');
        btnArea.className = 'email-all-buttons';
        btnArea.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
        inner.appendChild(btnArea);

        function showStep() {
            if (idx >= total) {
                // Collect all candidates from all reps
                var allCandidates = [];
                reps.forEach(function(rep) {
                    if (rep.candidates && rep.candidates.length > 0) {
                        rep.candidates.forEach(function(cand) {
                            // Avoid duplicates and skip if same as incumbent
                            if (cand.name && cand.name !== rep.name) {
                                allCandidates.push({
                                    name: cand.name,
                                    party: cand.party || '?',
                                    partyFull: cand.party === 'R' ? 'Republican' : cand.party === 'D' ? 'Democrat' : cand.party || '',
                                    office: rep.office + ' (Candidate)',
                                    email: cand.email || '',
                                    website: cand.website || '',
                                    contactForm: cand.contact_form || cand.contactForm || '',
                                });
                            }
                        });
                    }
                });

                if (allCandidates.length > 0) {
                    progressHeader.innerHTML = '<strong>Representatives Done!</strong><p>You contacted all ' + total + ' current representatives. There are also <strong>' + allCandidates.length + ' candidates</strong> running for office. Ask them to take the SAFE Action pledge too!</p>';
                    repInfo.style.display = 'none';
                    btnArea.textContent = '';

                    var emailCandsBtn = document.createElement('button');
                    emailCandsBtn.className = 'btn btn-primary';
                    emailCandsBtn.textContent = 'Email ' + allCandidates.length + ' Candidates';
                    emailCandsBtn.addEventListener('click', function() {
                        emailAllCandidates(allCandidates, bar);
                    });
                    btnArea.appendChild(emailCandsBtn);

                    var skipCandsBtn = document.createElement('button');
                    skipCandsBtn.className = 'btn btn-outline';
                    skipCandsBtn.style.cssText = 'border-color:rgba(255,255,255,0.4);color:rgba(255,255,255,0.8);';
                    skipCandsBtn.textContent = "I'm Done";
                    skipCandsBtn.addEventListener('click', function() {
                        buildEmailAllBar(_currentReps);
                    });
                    btnArea.appendChild(skipCandsBtn);
                } else {
                    progressHeader.innerHTML = '<strong>All Done!</strong><p>You contacted all ' + total + ' representatives. Thank you for taking action!</p>';
                    repInfo.style.display = 'none';
                    btnArea.textContent = '';
                    var doneBtn = document.createElement('button');
                    doneBtn.className = 'btn btn-primary';
                    doneBtn.textContent = 'Finished';
                    doneBtn.addEventListener('click', function() {
                        buildEmailAllBar(_currentReps);
                    });
                    btnArea.appendChild(doneBtn);
                }
                return;
            }

            var rep = reps[idx];
            progressHeader.innerHTML = '<strong>Representative ' + (idx + 1) + ' of ' + total + '</strong>';

            // Show rep details
            var partyLabel = rep.party === 'R' ? 'Republican' : rep.party === 'D' ? 'Democrat' : rep.partyFull || rep.party;
            repInfo.style.display = '';
            repInfo.innerHTML = '';
            var repName = document.createElement('div');
            repName.style.cssText = 'font-weight:700;font-size:1.05rem;color:#fff;';
            repName.textContent = rep.name;
            repInfo.appendChild(repName);
            var repDetail = document.createElement('div');
            repDetail.style.cssText = 'font-size:0.85rem;color:rgba(255,255,255,0.75);margin-top:2px;';
            repDetail.textContent = partyLabel + ' — ' + rep.office;
            repInfo.appendChild(repDetail);
            if (rep.email) {
                var repEmail = document.createElement('div');
                repEmail.style.cssText = 'font-size:0.85rem;color:rgba(255,255,255,0.6);margin-top:2px;';
                repEmail.textContent = rep.email;
                repInfo.appendChild(repEmail);
            }

            // Action buttons
            btnArea.textContent = '';

            // Determine contact URL: prefer contactForm, then try /contact on their website, then website root
            var contactUrl = rep.contactForm || '';
            if (!contactUrl && rep.website) {
                // Most congressional sites have a /contact page
                var base = rep.website.replace(/\/+$/, '');
                contactUrl = base + '/contact';
            }

            // Pre-generate the template for this rep
            var pledgeAction = { type: 'ask-pledge' };
            var template = generateTemplate(rep, pledgeAction, userName, userCity);
            var fullText = 'Subject: ' + template.subject + '\n\n' + template.body;

            // For reps WITH email: use a real <a href="mailto:..."> so the browser handles it natively
            // For reps WITHOUT email: use a button that opens the contact form
            var sendBtn;
            if (rep.email) {
                sendBtn = document.createElement('a');
                sendBtn.href = 'mailto:' + rep.email + '?subject=' + encodeURIComponent(template.subject) + '&body=' + encodeURIComponent(template.body);
                sendBtn.className = 'btn btn-primary';
                sendBtn.style.cssText = 'text-decoration:none;display:inline-block;';
                sendBtn.textContent = 'Open Email to ' + rep.name.split(' ').pop();
                sendBtn.target = '_blank';
            } else {
                sendBtn = document.createElement('button');
                sendBtn.className = 'btn btn-primary';
                sendBtn.textContent = 'Open Contact Form for ' + rep.name.split(' ').pop();
            }

            sendBtn.addEventListener('click', function() {
                // Copy to clipboard
                navigator.clipboard.writeText(fullText).catch(function() {});

                if (rep.email) {
                    showToast('Email template copied & opening Gmail for ' + rep.name);
                } else if (contactUrl) {
                    window.open(contactUrl, '_blank');
                    showToast('Template copied! Paste it into ' + rep.name.split(' ').pop() + "'s contact form.");
                } else {
                    showToast('Template copied to clipboard!');
                }
                trackAction('email');

                // Hide skip button
                if (skipBtn) skipBtn.style.display = 'none';

                // Only add "Next Rep" button once
                if (!btnArea.querySelector('.next-rep-btn')) {
                    if (!rep.email) {
                        var pasteNote = document.createElement('div');
                        pasteNote.style.cssText = 'font-size:0.85rem;color:rgba(255,255,255,0.7);margin:6px 0;';
                        pasteNote.textContent = 'The email template has been copied to your clipboard. Paste it into the contact form that just opened.';
                        btnArea.appendChild(pasteNote);
                    }

                    var nextBtn = document.createElement('button');
                    nextBtn.className = 'btn btn-primary next-rep-btn';
                    nextBtn.textContent = idx + 1 < total ? 'Next Rep (' + (total - idx - 1) + ' remaining)' : 'Finish';
                    nextBtn.addEventListener('click', function() {
                        idx++;
                        showStep();
                    });
                    btnArea.appendChild(nextBtn);
                }
            });
            btnArea.appendChild(sendBtn);

            var skipBtn = document.createElement('button');
            skipBtn.className = 'btn btn-outline';
            skipBtn.style.cssText = 'border-color:rgba(255,255,255,0.4);color:rgba(255,255,255,0.8);';
            skipBtn.textContent = 'Skip';
            skipBtn.addEventListener('click', function() {
                idx++;
                showStep();
            });
            btnArea.appendChild(skipBtn);
        }

        showStep();
    }

    var candidateSubjects = [
        'Will you take the SAFE Action pledge on science?',
        'A voter\'s request: support science and public health',
        'Will you commit to evidence-based health policy?',
        'Voters want to know: where do you stand on science?',
        'Please take the SAFE Action pledge for public health',
        'Science and public health matter to voters like me',
        'Can we count on your support for evidence-based policy?',
        'A question about your stance on science and health policy',
        'Supporting science: will you take the pledge?',
        'Public health matters — a request from a concerned voter',
    ];

    function generateCandidateTemplate(candidate, userName, userCity) {
        var title = candidate.office.includes('Senate') ? 'Senator' : 'Representative';
        var lastName = candidate.name.split(' ').pop();
        return {
            subject: pickRandom(candidateSubjects),
            body: 'Dear ' + candidate.name + ',\n\n' +
                'I am writing as a concerned voter in your district to ask you to take the SAFE Action pledge on science and public health policy.\n\n' +
                'The SAFE Action pledge commits candidates and elected officials to supporting evidence-based public health measures, including maintaining strong vaccination programs that protect our communities.\n\n' +
                'Taking this pledge shows voters that you prioritize science and public health. You can take the pledge at: https://scienceandfreedom.com/quiz.html\n\n' +
                'Thank you for your time.\n\n' +
                'Sincerely,\n' +
                (userName || '[Your Name]') + '\n' +
                (userCity || '[Your City]')
        };
    }

    function emailAllCandidates(candidates, bar) {
        var idx = 0;
        var total = candidates.length;
        var userName = getUserName();
        var userCity = getUserCity();

        var inner = bar.querySelector('.email-all-inner');
        inner.textContent = '';

        var progressHeader = document.createElement('div');
        progressHeader.className = 'email-all-text';
        inner.appendChild(progressHeader);

        var repInfo = document.createElement('div');
        repInfo.style.cssText = 'background:rgba(255,255,255,0.1);border-radius:8px;padding:12px 16px;margin:8px 0;';
        inner.appendChild(repInfo);

        var btnArea = document.createElement('div');
        btnArea.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
        inner.appendChild(btnArea);

        function showCandStep() {
            if (idx >= total) {
                progressHeader.innerHTML = '<strong>All Done!</strong><p>You contacted all ' + total + ' candidates. Thank you for going the extra mile!</p>';
                repInfo.style.display = 'none';
                btnArea.textContent = '';
                var doneBtn = document.createElement('button');
                doneBtn.className = 'btn btn-primary';
                doneBtn.textContent = 'Finished';
                doneBtn.addEventListener('click', function() {
                    buildEmailAllBar(_currentReps);
                });
                btnArea.appendChild(doneBtn);
                return;
            }

            var cand = candidates[idx];
            progressHeader.innerHTML = '<strong>Candidate ' + (idx + 1) + ' of ' + total + '</strong>';

            var partyLabel = cand.party === 'R' ? 'Republican' : cand.party === 'D' ? 'Democrat' : cand.partyFull || cand.party;
            repInfo.style.display = '';
            repInfo.innerHTML = '';
            var candName = document.createElement('div');
            candName.style.cssText = 'font-weight:700;font-size:1.05rem;color:#fff;';
            candName.textContent = cand.name;
            repInfo.appendChild(candName);
            var candDetail = document.createElement('div');
            candDetail.style.cssText = 'font-size:0.85rem;color:rgba(255,255,255,0.75);margin-top:2px;';
            candDetail.textContent = partyLabel + ' — ' + cand.office;
            repInfo.appendChild(candDetail);

            btnArea.textContent = '';

            var template = generateCandidateTemplate(cand, userName, userCity);
            var fullText = 'Subject: ' + template.subject + '\n\n' + template.body;

            // Determine contact method
            var contactUrl = cand.contactForm || '';
            if (!contactUrl && cand.website) {
                contactUrl = cand.website.replace(/\/+$/, '') + '/contact';
            }

            var sendBtn;
            if (cand.email) {
                sendBtn = document.createElement('a');
                sendBtn.href = 'mailto:' + cand.email + '?subject=' + encodeURIComponent(template.subject) + '&body=' + encodeURIComponent(template.body);
                sendBtn.className = 'btn btn-primary';
                sendBtn.style.cssText = 'text-decoration:none;display:inline-block;';
                sendBtn.textContent = 'Open Email to ' + cand.name.split(' ').pop();
                sendBtn.target = '_blank';
            } else {
                sendBtn = document.createElement('button');
                sendBtn.className = 'btn btn-primary';
                sendBtn.textContent = 'Copy Pledge Template';
            }

            sendBtn.addEventListener('click', function() {
                navigator.clipboard.writeText(fullText).catch(function() {});

                if (cand.email) {
                    showToast('Email opening for ' + cand.name);
                } else if (contactUrl) {
                    window.open(contactUrl, '_blank');
                    showToast('Template copied! Paste it into the contact form.');
                } else {
                    showToast('Pledge template copied to clipboard! Search for ' + cand.name + "'s website to send it.");
                }
                trackAction('email');

                if (skipBtn) skipBtn.style.display = 'none';

                if (!btnArea.querySelector('.next-rep-btn')) {
                    var nextBtn = document.createElement('button');
                    nextBtn.className = 'btn btn-primary next-rep-btn';
                    nextBtn.textContent = idx + 1 < total ? 'Next Candidate (' + (total - idx - 1) + ' remaining)' : 'Finish';
                    nextBtn.addEventListener('click', function() {
                        idx++;
                        showCandStep();
                    });
                    btnArea.appendChild(nextBtn);
                }
            });
            btnArea.appendChild(sendBtn);

            var skipBtn = document.createElement('button');
            skipBtn.className = 'btn btn-outline';
            skipBtn.style.cssText = 'border-color:rgba(255,255,255,0.4);color:rgba(255,255,255,0.8);';
            skipBtn.textContent = 'Skip';
            skipBtn.addEventListener('click', function() {
                idx++;
                showCandStep();
            });
            btnArea.appendChild(skipBtn);
        }

        showCandStep();
    }

    function renderStats(reps) {
        let totalBills = 0;
        let noPledge = 0;

        reps.forEach(rep => {
            if (rep.bills) {
                totalBills += rep.bills.filter(b => b.billType === 'anti').length;
            }
            noPledge++;
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

        var emailBtn;
        if (rep.email) {
            // Use a real <a> tag so the browser natively handles mailto (opens Gmail in Chrome)
            var repAction = rep.primaryAction || {};
            var repTemplate = generateTemplate(rep, repAction, getUserName(), getUserCity());
            emailBtn = document.createElement('a');
            emailBtn.href = 'mailto:' + rep.email + '?subject=' + encodeURIComponent(repTemplate.subject) + '&body=' + encodeURIComponent(repTemplate.body);
            emailBtn.target = '_blank';
            emailBtn.style.textDecoration = 'none';
            emailBtn.textContent = 'Email';
            emailBtn.addEventListener('click', function() {
                var ft = 'Subject: ' + repTemplate.subject + '\n\n' + repTemplate.body;
                navigator.clipboard.writeText(ft).catch(function() {});
                showToast('Email template copied & opening for ' + rep.name);
                trackAction('email');
            });
        } else {
            emailBtn = document.createElement('button');
            emailBtn.textContent = 'Contact';
            emailBtn.addEventListener('click', function() { openEmailAction(rep); });
        }
        emailBtn.className = 'btn btn-primary rep-hub-email-btn';
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
                    'Taking this pledge shows voters that you prioritize science and public health. You can take the pledge at: https://scienceandfreedom.com/quiz.html\n\n' +
                    'Thank you for your time.\n\n' +
                    'Sincerely,\n' + (getUserName() || '[Your Name]') + '\n' + (getUserCity() ? getUserCity() + ', ' + rep.state : '[Your City, ' + rep.state + ']');

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

        // Email template — with personalization inputs
        const templateDiv = document.createElement('div');
        templateDiv.className = 'rep-hub-template';
        const templateTitle = document.createElement('h4');
        templateTitle.textContent = 'Email Template';
        templateDiv.appendChild(templateTitle);

        // Name + City inputs
        const personalizeRow = document.createElement('div');
        personalizeRow.className = 'template-personalize';
        personalizeRow.style.cssText = 'display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;';

        const nameGroup = document.createElement('div');
        nameGroup.style.cssText = 'flex:1;min-width:150px;';
        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Your Name';
        nameLabel.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;color:#4A4A6A;margin-bottom:4px;';
        nameGroup.appendChild(nameLabel);
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Enter your name';
        nameInput.value = getUserName();
        nameInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;';
        nameGroup.appendChild(nameInput);
        personalizeRow.appendChild(nameGroup);

        const cityGroup = document.createElement('div');
        cityGroup.style.cssText = 'flex:1;min-width:150px;';
        const cityLabel = document.createElement('label');
        cityLabel.textContent = 'Your City';
        cityLabel.style.cssText = 'display:block;font-size:0.8rem;font-weight:600;color:#4A4A6A;margin-bottom:4px;';
        cityGroup.appendChild(cityLabel);
        const cityInput = document.createElement('input');
        cityInput.type = 'text';
        cityInput.placeholder = 'Enter your city';
        cityInput.value = getUserCity();
        cityInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;';
        cityGroup.appendChild(cityInput);
        personalizeRow.appendChild(cityGroup);

        templateDiv.appendChild(personalizeRow);

        // Generate template with user info
        const template = generateTemplate(rep, action, nameInput.value, cityInput.value);

        const subjectField = document.createElement('div');
        subjectField.className = 'template-field';
        const subjectLabel = document.createElement('label');
        subjectLabel.textContent = 'Subject';
        subjectField.appendChild(subjectLabel);
        const subjectInput = document.createElement('input');
        subjectInput.type = 'text';
        subjectInput.value = template.subject;
        subjectField.appendChild(subjectInput);
        templateDiv.appendChild(subjectField);

        const bodyField = document.createElement('div');
        bodyField.className = 'template-field';
        const bodyLabel = document.createElement('label');
        bodyLabel.textContent = 'Body';
        bodyField.appendChild(bodyLabel);
        const bodyTextarea = document.createElement('textarea');
        bodyTextarea.rows = 8;
        bodyTextarea.value = template.body;
        bodyField.appendChild(bodyTextarea);
        templateDiv.appendChild(bodyField);

        // Live-update template when name/city change
        function refreshTemplate() {
            const n = nameInput.value;
            const c = cityInput.value;
            saveUserInfo(n, c);
            const updated = generateTemplate(rep, action, n, c);
            subjectInput.value = updated.subject;
            bodyTextarea.value = updated.body;
            // Update phone script too if present
            const phoneTA = detail.querySelector('.phone-script-textarea');
            if (phoneTA) phoneTA.value = generatePhoneScript(rep, action, n, c);
        }
        nameInput.addEventListener('input', refreshTemplate);
        cityInput.addEventListener('input', refreshTemplate);

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
            mailtoLink.href = `mailto:${rep.email}?subject=${encodeURIComponent(subjectInput.value)}&body=${encodeURIComponent(bodyTextarea.value)}`;
            // Update mailto when clicking (use current values)
            mailtoLink.addEventListener('click', (e) => {
                mailtoLink.href = `mailto:${rep.email}?subject=${encodeURIComponent(subjectInput.value)}&body=${encodeURIComponent(bodyTextarea.value)}`;
            });
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
            phoneTextarea.className = 'phone-script-textarea';
            phoneTextarea.value = generatePhoneScript(rep, action, nameInput.value, cityInput.value);
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

    // Randomized subject lines so mass emails don't look like spam
    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var pledgeSubjects = [
        'Will you take the SAFE Action pledge on science and public health?',
        'A constituent request: take the SAFE Action pledge',
        'Please stand with science — take the SAFE Action pledge',
        'Supporting evidence-based health policy — will you take the pledge?',
        'Your constituents care about science — please take the SAFE Action pledge',
        'Request from a voter: support science and public health',
        'Can we count on you to support evidence-based public health?',
        'Science matters — will you take the SAFE Action pledge?',
        'Protecting public health: a request from your constituent',
        'Standing up for science in our community',
    ];

    var opposeSubjects = [
        'Please OPPOSE {bill} - {title}',
        'Vote NO on {bill}: protect public health',
        'Constituent request: oppose {bill}',
        '{bill} threatens public health — please vote NO',
        'Protect our community: oppose {bill}',
        'A voter\'s concern about {bill} - {title}',
        'Please stand against {bill} for public health',
        'Opposing {bill}: a request from your constituent',
    ];

    function generateTemplate(rep, action, userName, userCity) {
        const title = rep.office.includes('Senate') ? 'Senator' : 'Representative';
        const lastName = rep.name.split(' ').pop();

        if (action.type === 'oppose-bill' && action.bill) {
            var subj = pickRandom(opposeSubjects)
                .replace(/\{bill\}/g, action.bill.billNumber)
                .replace(/\{title\}/g, action.bill.title.substring(0, 60));
            return {
                subject: subj,
                body: `Dear ${title} ${lastName},

I am writing as a concerned constituent to urge you to OPPOSE ${action.bill.billNumber}, "${action.bill.title}".

This legislation undermines public health protections that keep our communities safe. As your constituent, I urge you to stand with science and evidence-based policy by voting NO on this bill.

Thank you for your time and service.

Sincerely,
${userName || '[Your Name]'}
${userCity ? userCity + ', ' + rep.state : '[Your City, ' + rep.state + ']'}`
            };
        }

        return {
            subject: pickRandom(pledgeSubjects),
            body: `Dear ${title} ${lastName},

I am writing as a concerned constituent to ask you to take the SAFE Action pledge on science and public health policy.

The SAFE Action pledge commits elected officials to supporting evidence-based public health measures, including maintaining strong vaccination programs that protect our communities.

Taking this pledge shows your constituents that you prioritize science and public health. You can take the pledge at: https://scienceandfreedom.com/quiz.html

Thank you for your time and service.

Sincerely,
${userName || '[Your Name]'}
${userCity ? userCity + ', ' + rep.state : '[Your City, ' + rep.state + ']'}`
        };
    }

    function generatePhoneScript(rep, action, userName, userCity) {
        const title = rep.office.includes('Senate') ? 'Senator' : 'Representative';
        const lastName = rep.name.split(' ').pop();

        if (action.type === 'oppose-bill' && action.bill) {
            return `Hello, my name is ${userName || '[Your Name]'} and I'm a constituent from ${userCity || '[Your City]'}.

I'm calling to ask ${title} ${lastName} to please OPPOSE ${action.bill.billNumber}, "${action.bill.title}".

This bill would weaken important public health protections and I believe it puts our community at risk. I urge the ${title} to vote NO on this bill.

Thank you for taking my call.`;
        }

        return `Hello, my name is ${userName || '[Your Name]'} and I'm a constituent from ${userCity || '[Your City]'}.

I'm calling to ask ${title} ${lastName} to take the SAFE Action pledge on science and public health.

The pledge commits officials to supporting evidence-based public health measures, including strong vaccination programs. I believe this is important for our community.

Thank you for taking my call.`;
    }

    function openEmailAction(rep) {
        var action = rep.primaryAction || {};
        var template = generateTemplate(rep, action, getUserName(), getUserCity());
        var fullText = 'Subject: ' + template.subject + '\n\n' + template.body;

        // Always copy to clipboard
        navigator.clipboard.writeText(fullText).catch(function() {});

        if (rep.email) {
            var mailtoUrl = 'mailto:' + rep.email + '?subject=' + encodeURIComponent(template.subject) + '&body=' + encodeURIComponent(template.body);
            var mailLink = document.createElement('a');
            mailLink.href = mailtoUrl;
            mailLink.style.display = 'none';
            document.body.appendChild(mailLink);
            mailLink.click();
            document.body.removeChild(mailLink);
            showToast('Email template copied & email opening for ' + rep.name + '...');
        } else {
            // Build contact form URL: prefer contactForm, then try /contact on website
            var url = rep.contactForm || '';
            if (!url && rep.website) {
                url = rep.website.replace(/\/+$/, '') + '/contact';
            }
            if (url) {
                window.open(url, '_blank');
                showToast('Template copied! Paste it into ' + rep.name.split(' ').pop() + "'s contact form.");
            } else {
                showToast('Template copied to clipboard!');
            }
        }
        trackAction('email');
    }

    function showToast(message) {
        var existing = document.querySelector('.safe-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'safe-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.classList.add('safe-toast-show'); }, 10);
        setTimeout(function() {
            toast.classList.remove('safe-toast-show');
            setTimeout(function() { toast.remove(); }, 300);
        }, 4000);
    }

    function trackAction(type) {
        try {
            // Use the same localStorage key as main.js so homepage counters update
            var BASE_ACTIONS = 1128;
            var BASE_EMAILS = 743;
            var BASE_CALLS = 385;
            var stored = JSON.parse(localStorage.getItem('safe_action_counts'));
            if (!stored || stored.total < BASE_ACTIONS) {
                stored = { total: BASE_ACTIONS, emails: BASE_EMAILS, calls: BASE_CALLS };
            }
            stored.total++;
            if (type === 'email') stored.emails++;
            if (type === 'call') stored.calls++;
            localStorage.setItem('safe_action_counts', JSON.stringify(stored));

            // Update daily action counts
            var dk = new Date().toISOString().split('T')[0];
            var daily;
            try { daily = JSON.parse(localStorage.getItem('safe_daily_actions')); } catch(e2) {}
            if (daily && daily.date && daily.date !== dk) {
                localStorage.setItem('safe_yesterday_actions', JSON.stringify(daily));
            }
            if (!daily || daily.date !== dk) daily = { date: dk, emails: 0, calls: 0, total: 0 };
            daily.total++;
            if (type === 'email') daily.emails++;
            if (type === 'call') daily.calls++;
            localStorage.setItem('safe_daily_actions', JSON.stringify(daily));

            // Update weekly action counts
            var now = new Date();
            var dayOfWeek = now.getDay();
            var mon = new Date(now);
            mon.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
            var wk = mon.toISOString().split('T')[0];
            var weekly;
            try { weekly = JSON.parse(localStorage.getItem('safe_weekly_actions')); } catch(e3) {}
            if (!weekly || weekly.week !== wk) weekly = { week: wk, emails: 0, calls: 0, total: 0 };
            weekly.total++;
            if (type === 'email') weekly.emails++;
            if (type === 'call') weekly.calls++;
            localStorage.setItem('safe_weekly_actions', JSON.stringify(weekly));

            // Update streak
            var streak;
            try { streak = JSON.parse(localStorage.getItem('safe_action_streak')); } catch(e4) {}
            if (!streak) streak = { days: 0, lastDate: '' };
            if (streak.lastDate !== dk) {
                var yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                var yd = yesterday.toISOString().split('T')[0];
                streak.days = (streak.lastDate === yd) ? streak.days + 1 : 1;
                streak.lastDate = dk;
                localStorage.setItem('safe_action_streak', JSON.stringify(streak));
            }
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

        // Type badge — only label STEM-related bills (anti/pro science)
        if (bill.billType === 'anti' || bill.billType === 'pro') {
            var typeBadge = document.createElement('span');
            if (bill.billType === 'anti') {
                typeBadge.className = 'badge badge-anti';
                typeBadge.textContent = 'ANTI-SCIENCE';
            } else {
                typeBadge.className = 'badge badge-pro';
                typeBadge.textContent = 'PRO-SCIENCE';
            }
            header.appendChild(typeBadge);
        }

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
