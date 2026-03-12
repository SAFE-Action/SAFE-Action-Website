// ============================================
// SAFE Action - Google Sheets Integration
// ============================================

const SheetsAPI = {
    _cache: null,
    _cacheTime: 0,

    /**
     * Fetch all candidates from the Google Sheet
     */
    async getCandidates(forceRefresh = false) {
        // Return cached data if fresh enough
        if (!forceRefresh && this._cache && (Date.now() - this._cacheTime < SAFE_CONFIG.CACHE_DURATION)) {
            return this._cache;
        }

        if (!SAFE_CONFIG.IS_CONFIGURED) {
            console.warn('SAFE Action: Google Sheets not configured. Using demo data.');
            return this._getDemoData();
        }

        try {
            const response = await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL + '?action=getCandidates');
            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();

            if (data.error) throw new Error(data.error);

            this._cache = data.candidates || [];
            this._cacheTime = Date.now();
            return this._cache;
        } catch (error) {
            console.error('Error fetching candidates:', error);
            // Return cached data if available, otherwise empty
            return this._cache || [];
        }
    },

    /**
     * Generate a URL-friendly slug from a candidate name
     */
    getSlug(candidate) {
        var first = (candidate.firstName || '').toLowerCase().trim();
        var last = (candidate.lastName || '').toLowerCase().trim();
        return (first + '-' + last)
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    },

    /**
     * Get a single candidate by ID
     */
    async getCandidate(id) {
        const candidates = await this.getCandidates();
        return candidates.find(c => c.id === id) || null;
    },

    /**
     * Get a single candidate by name slug (e.g. "sarah-mitchell")
     */
    async getCandidateBySlug(slug) {
        if (!slug) return null;
        var candidates = await this.getCandidates();
        var normalized = slug.toLowerCase().trim();
        return candidates.find(function(c) {
            var candidateSlug = SheetsAPI.getSlug(c);
            return candidateSlug === normalized;
        }) || null;
    },

    /**
     * Submit a new pledge form
     */
    async submitPledge(formData) {
        if (!SAFE_CONFIG.IS_CONFIGURED) {
            console.warn('SAFE Action: Google Sheets not configured. Simulating submission.');
            return new Promise(resolve => {
                setTimeout(() => resolve({ success: true, message: 'Demo mode - not actually saved.' }), 1500);
            });
        }

        try {
            const response = await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'submitPledge',
                    ...formData
                })
            });

            // no-cors means we can't read the response, but if it didn't throw, it likely worked
            return { success: true };
        } catch (error) {
            console.error('Error submitting pledge:', error);
            throw error;
        }
    },

    /**
     * Demo data for testing before Google Sheets is connected
     */
    _getDemoData() {
        // Demo pledges for preview (replaced by real data once Google Sheet is connected)
        return [
            {
                id: 'demo-1',
                timestamp: '2026-03-10T14:30:00Z',
                firstName: 'Sarah',
                lastName: 'Mitchell',
                email: 'sarah.mitchell@casenate.gov',
                phone: '(916) 555-0142',
                party: 'Democrat',
                office: 'State Senator',
                position: 'State Senator, District 38',
                district: '38',
                city: 'San Diego',
                state: 'CA',
                photoUrl: '',
                vaccineSupport: 'Yes \u2014 I strongly support evidence-based vaccine policies and public health measures.',
                question1: 'I believe vaccines are one of the most important public health tools we have. As a legislator, I have consistently voted to strengthen school immunization requirements and oppose exemption-expansion bills. Science must guide our health policy, not fear or misinformation.',
                question2: 'If re-elected, I will work to ensure every family has access to accurate vaccine information from trusted medical sources. I plan to introduce legislation requiring transparent reporting of vaccination rates by school district so parents can make informed decisions based on real data.',
                question3: 'I am a former public health nurse and have seen firsthand the devastating effects of preventable diseases. I got into public service specifically to protect community health. I welcome questions from voters about my record on these issues.'
            },
            {
                id: 'demo-2',
                timestamp: '2026-03-09T10:15:00Z',
                firstName: 'James',
                lastName: 'Rodriguez',
                email: 'james.rodriguez@txhouse.gov',
                phone: '(512) 555-0198',
                party: 'Republican',
                office: 'State Representative',
                position: 'State Representative, District 14',
                district: '14',
                city: 'Houston',
                state: 'TX',
                photoUrl: '',
                vaccineSupport: 'Yes \u2014 I support childhood vaccination programs and evidence-based public health policy.',
                question1: 'As a father of three, I understand the importance of keeping our children healthy. I support the existing childhood vaccination schedule recommended by the CDC and AAP. While I respect individual liberty, I believe the scientific evidence overwhelmingly supports vaccination as safe and effective.',
                question2: 'I would work to increase funding for county health departments to provide free and low-cost vaccines to underserved communities. Access to preventive healthcare should not depend on your zip code. I also support strengthening our disease surveillance systems.',
                question3: 'I have a background in emergency management and understand how quickly preventable disease outbreaks can overwhelm our healthcare system. I believe we can protect both individual freedom and community health through smart, science-based policy.'
            },
            {
                id: 'demo-3',
                timestamp: '2026-03-08T16:45:00Z',
                firstName: 'Emily',
                lastName: 'Chen',
                email: 'emily.chen@council.nyc.gov',
                phone: '(212) 555-0167',
                party: 'Democrat',
                office: 'City Council',
                position: 'City Council Member, District 7',
                district: '7',
                city: 'New York',
                state: 'NY',
                photoUrl: '',
                vaccineSupport: 'Yes \u2014 I support strong public health infrastructure including vaccination programs.',
                question1: 'Public health is the foundation of a thriving city. I have championed our municipal vaccination clinics and fought against misinformation campaigns targeting immigrant communities. Every resident deserves access to life-saving vaccines regardless of income or immigration status.',
                question2: 'I am working to expand mobile vaccination units in underserved neighborhoods and partnering with community health workers who speak residents\u0027 languages. I also support comprehensive science education in our public schools to build health literacy from an early age.',
                question3: 'Before joining the City Council, I worked as an epidemiologist at the NYC Department of Health. I bring real scientific expertise to policy decisions and I am committed to making sure our city\u0027s health policies are grounded in evidence, not politics.'
            },
            {
                id: 'demo-4',
                timestamp: '2026-03-07T09:00:00Z',
                firstName: 'Robert',
                lastName: 'Thompson',
                email: 'robert.thompson@broward.org',
                phone: '(954) 555-0234',
                party: 'Independent',
                office: 'County Commissioner',
                position: 'County Commissioner, District 3',
                district: '3',
                city: 'Fort Lauderdale',
                state: 'FL',
                photoUrl: '',
                vaccineSupport: 'Yes \u2014 I support community water fluoridation and evidence-based public health measures.',
                question1: 'I believe local government has a responsibility to protect community health through proven public health measures. I have voted to maintain our county\u0027s water fluoridation program despite pressure from anti-fluoride activists. The science on fluoridation is settled \u2014 it\u0027s safe and it prevents tooth decay, especially in children who can\u0027t afford dental care.',
                question2: 'I plan to establish a county Science Advisory Board made up of local physicians, researchers, and public health professionals to review all health-related policy proposals before they come to a vote. Policy should be informed by experts, not lobbyists.',
                question3: 'I am a retired pediatrician with 30 years of clinical experience. I have seen too many children suffer from preventable conditions. I believe public officials have a duty to stand up for science even when it\u0027s politically inconvenient.'
            },
            {
                id: 'demo-5',
                timestamp: '2026-03-06T12:30:00Z',
                firstName: 'Maria',
                lastName: 'Gonzalez',
                email: 'maria.gonzalez@azschoolboard.gov',
                phone: '(480) 555-0312',
                party: 'Democrat',
                office: 'School Board',
                position: 'School Board President',
                district: '',
                city: 'Phoenix',
                state: 'AZ',
                photoUrl: '',
                vaccineSupport: 'Yes \u2014 I support school immunization requirements to protect all students.',
                question1: 'As a School Board President and mother of four, student health and safety is my top priority. I firmly support our district\u0027s immunization requirements for school enrollment. These requirements protect not just individual students but also children who cannot be vaccinated due to legitimate medical conditions.',
                question2: 'I am working to integrate more health science and critical thinking into our K-12 curriculum so students can evaluate health claims for themselves. I also support partnerships with local pediatricians to host school-based vaccination clinics for families who face transportation or cost barriers.',
                question3: 'I hold a Master\u0027s in Public Health from ASU and have volunteered with the Arizona Department of Health Services for over a decade. I ran for School Board because I believe every child deserves to learn in a safe, healthy environment supported by the best available science.'
            }
        ];
    }
};
