// ============================================
// SAFE Action - Mailing List Signup
// Binds every .list-signup-form on the page.
// ============================================
(function () {
    function bindForm(form) {
        var status = form.querySelector('.list-signup-status');
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var emailInput = form.querySelector('input[name="email"]');
            var nameInput = form.querySelector('input[name="name"]');
            var hpInput = form.querySelector('input[name="website"]');
            var btn = form.querySelector('button[type="submit"]');
            var email = emailInput ? emailInput.value.trim() : '';
            if (!email) return;

            if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Joining...'; }
            if (status) { status.style.display = 'none'; status.classList.remove('error'); }
            try {
                var resp = await fetch('/api/list/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: email,
                        name: nameInput ? nameInput.value.trim() : '',
                        source: form.dataset.source || 'site',
                        website: hpInput ? hpInput.value : ''
                    })
                });
                var data = await resp.json();
                if (status) {
                    status.style.display = '';
                    if (resp.ok) {
                        status.textContent = data.message || 'Check your email to confirm your signup.';
                        form.querySelectorAll('input').forEach(function (i) { i.value = ''; });
                    } else {
                        status.classList.add('error');
                        status.textContent = data.error || 'Something went wrong. Please try again.';
                    }
                }
            } catch (err) {
                if (status) {
                    status.style.display = '';
                    status.classList.add('error');
                    status.textContent = 'Network error. Please try again.';
                }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Join'; }
            }
        });
    }
    document.querySelectorAll('.list-signup-form').forEach(bindForm);
})();
