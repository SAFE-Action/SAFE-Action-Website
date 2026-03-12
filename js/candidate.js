// ============================================
// SAFE Action - Candidate Detail Page
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('candidate-loading');
    const detailEl = document.getElementById('candidate-detail');
    const notFoundEl = document.getElementById('candidate-not-found');

    // Support both clean URLs (/candidates/sarah-mitchell) and legacy (?id=123)
    const params = new URLSearchParams(window.location.search);
    const candidateSlug = params.get('slug');
    const candidateId = params.get('id');

    if (!candidateSlug && !candidateId) {
        showNotFound();
        return;
    }

    try {
        var candidate;
        if (candidateSlug) {
            candidate = await SheetsAPI.getCandidateBySlug(candidateSlug);
        } else {
            candidate = await SheetsAPI.getCandidate(candidateId);
        }

        if (!candidate) {
            showNotFound();
            return;
        }

        // Populate the page
        populateDetail(candidate);
        setupShareButtons(candidate);

        // Update page title and meta for SEO
        document.title = candidate.firstName + ' ' + candidate.lastName + ' - SAFE Action Pledge';
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = 'See where ' + candidate.firstName + ' ' + candidate.lastName + ' (' + (candidate.party || '') + ', ' + (candidate.state || '') + ') stands on science and public health. View their SAFE Action pledge.';
        }
        // Set canonical URL to clean format
        var slug = typeof SheetsAPI !== 'undefined' ? SheetsAPI.getSlug(candidate) : '';
        if (slug) {
            var link = document.querySelector('link[rel="canonical"]') || document.createElement('link');
            link.rel = 'canonical';
            link.href = window.location.origin + '/candidates/' + slug;
            if (!link.parentNode) document.head.appendChild(link);
        }

        // Show detail, hide loading
        loadingEl.style.display = 'none';
        detailEl.style.display = '';

    } catch (error) {
        console.error('Error loading candidate:', error);
        showNotFound();
    }

    function populateDetail(c) {
        const initials = (c.firstName[0] || '') + (c.lastName[0] || '');
        const partyClass = c.party ? c.party.toLowerCase().replace(/\s+/g, '-') : '';

        // Avatar - use photo if available
        const avatarContainer = document.getElementById('candidate-avatar-container');
        if (c.photoUrl) {
            avatarContainer.innerHTML = `<img src="${escapeHtml(c.photoUrl)}" alt="${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}" class="candidate-avatar-img-lg">`;
        } else {
            const avatarEl = document.getElementById('candidate-avatar');
            avatarEl.textContent = initials;
        }

        // Name
        document.getElementById('candidate-name').textContent = `${c.firstName} ${c.lastName}`;

        // Party badge
        const partyEl = document.getElementById('candidate-party');
        partyEl.textContent = c.party;
        partyEl.className = `badge badge-party ${partyClass}`;

        // Position & Office
        document.getElementById('candidate-position').textContent = c.position;
        document.getElementById('candidate-office').textContent = c.office;

        // District
        if (c.district) {
            const districtEl = document.getElementById('candidate-district');
            districtEl.textContent = c.district;
            districtEl.style.display = '';
        }

        // City
        if (c.city) {
            const cityEl = document.getElementById('candidate-city');
            cityEl.textContent = c.city;
            cityEl.style.display = '';
        }

        // State
        if (c.state) {
            const stateEl = document.getElementById('candidate-state');
            if (stateEl) {
                stateEl.textContent = SAFE_CONFIG.STATES[c.state] || c.state;
                stateEl.style.display = '';
            }
        }

        // Contact
        const emailEl = document.getElementById('candidate-email');
        emailEl.textContent = c.email;
        emailEl.href = `mailto:${c.email}`;

        const phoneEl = document.getElementById('candidate-phone');
        phoneEl.textContent = c.phone;
        phoneEl.href = `tel:${c.phone.replace(/[^+\d]/g, '')}`;

        // Vaccine position
        document.getElementById('candidate-vaccine').textContent = c.vaccineSupport;

        // Questions
        document.getElementById('candidate-q1').textContent = c.question1 || 'No response provided.';

        if (c.question2) {
            document.getElementById('candidate-q2').textContent = c.question2;
            document.getElementById('q2-block').style.display = '';
        }

        if (c.question3) {
            document.getElementById('candidate-q3').textContent = c.question3;
            document.getElementById('q3-block').style.display = '';
        }
    }

    function setupShareButtons(c) {
        const fullName = `${c.firstName} ${c.lastName}`;
        // Use clean candidate URL for sharing
        var slug = typeof SheetsAPI !== 'undefined' ? SheetsAPI.getSlug(c) : '';
        var pageUrl = slug
            ? window.location.origin + '/candidates/' + slug
            : window.location.href;
        const shareText = `See where ${fullName} stands on science and public health issues. Check their SAFE Action pledge:`;

        // Twitter/X
        document.getElementById('candidate-share-twitter').addEventListener('click', () => {
            window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`,
                '_blank', 'width=550,height=420'
            );
        });

        // Facebook
        document.getElementById('candidate-share-facebook').addEventListener('click', () => {
            window.open(
                `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`,
                '_blank', 'width=550,height=420'
            );
        });

        // LinkedIn
        document.getElementById('candidate-share-linkedin').addEventListener('click', () => {
            window.open(
                `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`,
                '_blank', 'width=550,height=420'
            );
        });

        // Copy link
        document.getElementById('candidate-share-copy').addEventListener('click', (e) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(pageUrl).then(() => {
                    e.target.closest('.share-btn-lg').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copied!`;
                    setTimeout(() => {
                        e.target.closest('.share-btn-lg').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Copy Link`;
                    }, 2000);
                });
            }
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showNotFound() {
        loadingEl.style.display = 'none';
        notFoundEl.style.display = '';
    }
});
