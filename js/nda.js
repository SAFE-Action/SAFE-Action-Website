(function() {
    var volunteerId = null;
    var volunteerData = null;

    // NDA text (duplicated client-side for display — server has authoritative copy)
    var ndaSections = [
        {
            heading: '1. Definition of Confidential Information',
            body: '"Confidential Information" means any non-public information disclosed by SAFE Action (Science and Freedom for Everyone Action Fund) to the Volunteer, including but not limited to: internal communications, strategic plans, donor information, volunteer contact lists, unpublished research, software source code, database contents, operational procedures, and any information marked or reasonably understood to be confidential.'
        },
        {
            heading: '2. Non-Disclosure Obligations',
            body: 'The Volunteer agrees to: (a) hold all Confidential Information in strict confidence; (b) not disclose Confidential Information to any third party without prior written consent from SAFE Action; (c) use Confidential Information solely for the purpose of performing volunteer duties for SAFE Action; (d) take reasonable measures to protect the confidentiality of such information, using at least the same degree of care used to protect their own confidential information.'
        },
        {
            heading: '3. Exceptions',
            body: 'This Agreement does not apply to information that: (a) is or becomes publicly available through no fault of the Volunteer; (b) was known to the Volunteer prior to disclosure by SAFE Action; (c) is independently developed by the Volunteer without use of Confidential Information; (d) is required to be disclosed by law, regulation, or court order, provided the Volunteer gives prompt notice to SAFE Action.'
        },
        {
            heading: '4. Non-Compete During Engagement',
            body: 'During the period of active volunteer engagement with SAFE Action, the Volunteer agrees not to use Confidential Information to directly compete with SAFE Action\'s mission or operations, including launching competing advocacy platforms or soliciting SAFE Action\'s contacts for competing purposes. This clause does not restrict the Volunteer\'s right to engage in general civic advocacy or employment.'
        },
        {
            heading: '5. Return of Materials',
            body: 'Upon termination of the volunteer relationship or upon request by SAFE Action, the Volunteer shall promptly return or destroy all materials containing Confidential Information, including digital copies, and certify in writing that such return or destruction has been completed.'
        },
        {
            heading: '6. Term and Survival',
            body: 'This Agreement is effective as of the date of signature and shall remain in effect for the duration of the volunteer relationship and for a period of two (2) years following its termination, regardless of the reason for termination.'
        },
        {
            heading: '7. Remedies',
            body: 'The Volunteer acknowledges that any breach of this Agreement may cause irreparable harm to SAFE Action for which monetary damages may be inadequate. SAFE Action shall be entitled to seek equitable relief, including injunction and specific performance, in addition to any other remedies available at law.'
        },
        {
            heading: '8. Governing Law',
            body: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws provisions.'
        },
        {
            heading: '9. Entire Agreement',
            body: 'This Agreement constitutes the entire agreement between the parties regarding the subject matter hereof and supersedes all prior agreements, understandings, and communications, whether written or oral.'
        }
    ];

    function init() {
        var params = new URLSearchParams(window.location.search);
        var token = params.get('token');
        if (!token) {
            showState('error');
            return;
        }

        // Look up volunteer by NDA token via API (no client-side Firestore needed)
        fetch('/api/volunteer/nda/lookup?token=' + encodeURIComponent(token))
            .then(function(resp) {
                if (!resp.ok) throw new Error('Invalid token');
                return resp.json();
            })
            .then(function(data) {
                volunteerId = data.id;
                volunteerData = data;

                if (data.ndaSigned) {
                    showState('already-signed');
                    return;
                }

                renderNda();
                showState('content');
            })
            .catch(function() {
                showState('error');
            });
    }

    function showState(state) {
        ['loading', 'error', 'already-signed', 'content', 'success'].forEach(function(s) {
            var el = document.getElementById('nda-' + s);
            if (el) el.style.display = (s === state) ? '' : 'none';
        });
    }

    function renderNda() {
        document.getElementById('nda-volunteer-name').textContent = volunteerData.name;
        var container = document.getElementById('nda-sections');
        ndaSections.forEach(function(section) {
            var div = document.createElement('div');
            div.className = 'nda-section-block';
            var h = document.createElement('h3');
            h.textContent = section.heading;
            var p = document.createElement('p');
            p.textContent = section.body;
            div.appendChild(h);
            div.appendChild(p);
            container.appendChild(div);
        });

        // Enable sign button when checkbox is checked and name is typed
        var checkbox = document.getElementById('nda-agree');
        var nameInput = document.getElementById('nda-sig-name');
        var signBtn = document.getElementById('nda-sign-btn');

        function updateBtn() {
            signBtn.disabled = !(checkbox.checked && nameInput.value.trim().length > 0);
        }
        checkbox.addEventListener('change', updateBtn);
        nameInput.addEventListener('input', updateBtn);

        signBtn.addEventListener('click', submitSignature);
    }

    async function submitSignature() {
        var nameInput = document.getElementById('nda-sig-name');
        var errorDiv = document.getElementById('nda-sign-error');
        var signBtn = document.getElementById('nda-sign-btn');
        var name = nameInput.value.trim();

        if (!name) return;

        errorDiv.style.display = 'none';
        signBtn.disabled = true;
        signBtn.textContent = 'Signing...';

        try {
            var params = new URLSearchParams(window.location.search);
            var resp = await fetch('/api/volunteer/' + volunteerId + '/nda/sign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, token: params.get('token') })
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Failed to sign');
            showState('success');
        } catch (e) {
            errorDiv.textContent = e.message;
            errorDiv.style.display = 'block';
            signBtn.disabled = false;
            signBtn.textContent = 'I Agree & Sign';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
