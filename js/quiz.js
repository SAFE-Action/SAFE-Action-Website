// ============================================
// SAFE Action - Quiz / Pledge Form
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('pledge-form');
    if (!form) return;
    const submitBtn = document.getElementById('submit-btn');
    const successMsg = document.getElementById('success-message');
    const errorMsg = document.getElementById('error-message');

    // Populate state dropdown
    const stateSelect = document.getElementById('state');
    if (stateSelect && typeof SAFE_CONFIG !== 'undefined') {
        Object.entries(SAFE_CONFIG.STATES).forEach(([code, name]) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            stateSelect.appendChild(opt);
        });
    }

    // Character counters
    setupCharCounter('question1', 'q1-count');
    setupCharCounter('question2', 'q2-count');
    setupCharCounter('question3', 'q3-count');

    // Email domain verification
    setupEmailVerification();

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();

        if (!validateForm()) return;

        // Disable button and show loading
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></span> Submitting...';
        errorMsg.style.display = 'none';

        try {
            const formData = {
                firstName: val('firstName'),
                lastName: val('lastName'),
                email: val('email'),
                phone: val('phone'),
                party: val('party'),
                office: val('office'),
                position: val('position'),
                district: val('district'),
                city: val('city'),
                state: val('state'),
                vaccineSupport: document.querySelector('input[name="vaccineSupport"]:checked')?.value || '',
                question1: val('question1'),
                question2: val('question2'),
                question3: val('question3')
            };

            await SheetsAPI.submitPledge(formData);

            // Show success
            form.style.display = 'none';
            successMsg.style.display = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });

        } catch (error) {
            console.error('Submission error:', error);
            errorMsg.style.display = '';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span class="btn-star">&#9733;</span> Submit Your Pledge <span class="btn-star">&#9733;</span>';
        }
    });

    function validateForm() {
        let isValid = true;

        // Required text fields
        const requiredFields = [
            { id: 'firstName', label: 'First name' },
            { id: 'lastName', label: 'Last name' },
            { id: 'email', label: 'Email' },
            { id: 'phone', label: 'Phone number' },
            { id: 'party', label: 'Party' },
            { id: 'office', label: 'Office' },
            { id: 'position', label: 'Position' },
            { id: 'state', label: 'State' },
            { id: 'question1', label: 'This question' }
        ];

        requiredFields.forEach(field => {
            const value = val(field.id);
            if (!value) {
                showError(field.id, `${field.label} is required.`);
                isValid = false;
            }
        });

        // Email validation
        const email = val('email');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('email', 'Please enter a valid email address.');
            isValid = false;
        } else if (email && isPersonalEmail(email)) {
            showError('email', 'Please use your official government or campaign email address.');
            isValid = false;
        }

        // Vaccine support radio
        const vaccineChecked = document.querySelector('input[name="vaccineSupport"]:checked');
        if (!vaccineChecked) {
            showError('vaccineSupport', 'Please select an option.');
            isValid = false;
        }

        // Scroll to first error
        if (!isValid) {
            const firstError = document.querySelector('.error');
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        return isValid;
    }

    function val(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function showError(id, message) {
        const el = document.getElementById(id);
        const errorEl = document.getElementById(id + '-error');
        if (el) el.classList.add('error');
        if (errorEl) errorEl.textContent = message;
    }

    function clearErrors() {
        document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
        document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    }

    function setupCharCounter(textareaId, counterId) {
        const textarea = document.getElementById(textareaId);
        const counter = document.getElementById(counterId);
        if (!textarea || !counter) return;

        textarea.addEventListener('input', () => {
            counter.textContent = textarea.value.length;
        });
    }

    // Personal email domain detection
    const PERSONAL_DOMAINS = [
        'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
        'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
        'live.com', 'msn.com', 'me.com', 'mac.com', 'comcast.net',
        'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'charter.net',
        'earthlink.net', 'optonline.net', 'frontier.com', 'windstream.net',
        'googlemail.com', 'yahoo.co.uk', 'hotmail.co.uk', 'btinternet.com',
        'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com', 'hushmail.com',
        'rocketmail.com', 'inbox.com', 'rediffmail.com'
    ];

    function isPersonalEmail(email) {
        const domain = email.split('@')[1]?.toLowerCase();
        return PERSONAL_DOMAINS.includes(domain);
    }

    function setupEmailVerification() {
        const emailInput = document.getElementById('email');
        const warningEl = document.getElementById('email-warning');
        if (!emailInput || !warningEl) return;

        emailInput.addEventListener('input', () => {
            const email = emailInput.value.trim();
            if (email && email.includes('@') && isPersonalEmail(email)) {
                warningEl.classList.add('show');
                emailInput.classList.add('warning');
            } else {
                warningEl.classList.remove('show');
                emailInput.classList.remove('warning');
            }
        });

        emailInput.addEventListener('blur', () => {
            const email = emailInput.value.trim();
            if (email && email.includes('@') && isPersonalEmail(email)) {
                warningEl.classList.add('show');
            }
        });
    }
});
