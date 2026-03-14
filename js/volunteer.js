(function() {
    const form = document.getElementById('volunteer-form');
    const successDiv = document.getElementById('volunteer-success');
    const errorDiv = document.getElementById('volunteer-error');
    const submitBtn = document.getElementById('volunteer-submit');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        errorDiv.style.display = 'none';

        // Collect form data
        const name = form.querySelector('[name="name"]').value.trim();
        const email = form.querySelector('[name="email"]').value.trim();
        const skills = Array.from(form.querySelectorAll('[name="skills"]:checked')).map(cb => cb.value);
        const interests = Array.from(form.querySelectorAll('[name="interests"]:checked')).map(cb => cb.value);
        const availability = form.querySelector('[name="availability"]').value;

        // Validate
        if (!name || !email || !skills.length || !availability) {
            errorDiv.textContent = 'Please fill in all required fields and select at least one skill.';
            errorDiv.style.display = 'block';
            return;
        }

        // Submit
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const resp = await fetch('/api/volunteer/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, skills, interests, availability })
            });
            const data = await resp.json();

            if (resp.ok) {
                form.style.display = 'none';
                successDiv.style.display = 'block';
            } else {
                errorDiv.textContent = data.error || 'Something went wrong. Please try again.';
                errorDiv.style.display = 'block';
            }
        } catch (err) {
            errorDiv.textContent = 'Network error. Please check your connection and try again.';
            errorDiv.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Application';
        }
    });
})();
