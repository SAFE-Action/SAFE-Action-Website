// ============================================
// SAFE Action - Legislation & Representatives API
// ============================================
// Firestore-first with static JSON fallback.

const LegislationAPI = {
    _billCache: null,
    _billCacheTime: 0,
    _repCache: {},
    _repCacheTime: {},
    _templateCache: null,
    _db: null,

    // --- Firestore helper ---

    _getDb: function() {
        if (this._db) return this._db;
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                this._db = firebase.firestore();
                return this._db;
            }
        } catch (e) {
            console.warn('Firestore not available:', e.message);
        }
        return null;
    },

    // --- Legislation ---

    async getLegislation(state, forceRefresh = false) {
        var cacheKey = state || 'all';
        if (!forceRefresh && this._billCache && this._billCache[cacheKey] &&
            (Date.now() - this._billCacheTime < SAFE_CONFIG.CACHE_DURATION)) {
            return this._billCache[cacheKey];
        }

        // Try Firestore first
        var db = this._getDb();
        if (db) {
            try {
                var query = db.collection('bills');
                if (state && state !== 'ALL') {
                    query = query.where('state', '==', state);
                }
                var snapshot = await query.get();
                var bills = [];
                snapshot.forEach(function(doc) {
                    if (doc.id === '_metadata') return;
                    bills.push(doc.data());
                });
                if (!this._billCache) this._billCache = {};
                this._billCache[cacheKey] = bills;
                this._billCacheTime = Date.now();
                return bills;
            } catch (err) {
                console.warn('Firestore getLegislation failed, falling back to static:', err.message);
            }
        }

        // Fall back to static JSON
        return this._getStaticLegislation(state);
    },

    // --- Paginated Query (Firestore only, with static fallback) ---

    async queryBills(filters, pageSize, startAfterDoc) {
        var db = this._getDb();
        if (db) {
            try {
                var query = db.collection('bills');

                // Server-side filters
                if (filters.state) {
                    query = query.where('state', '==', filters.state);
                }
                if (filters.billType) {
                    query = query.where('billType', '==', filters.billType);
                }
                if (filters.status === 'active') {
                    query = query.where('isActive', '==', 'Yes');
                } else if (filters.status === 'dead') {
                    // Dead statuses need client-side filtering (Firestore can't do array-contains on field)
                } else if (filters.status) {
                    query = query.where('status', '==', filters.status);
                }
                if (filters.impact) {
                    query = query.where('impact', '==', filters.impact);
                }
                if (filters.category) {
                    query = query.where('category', '==', filters.category);
                }

                // Order and paginate
                query = query.orderBy('state').orderBy('billNumber');
                if (startAfterDoc) {
                    query = query.startAfter(startAfterDoc);
                }
                query = query.limit(pageSize + 1); // fetch one extra to check hasMore

                var snapshot = await query.get();
                var bills = [];
                var lastDoc = null;
                var docs = [];
                snapshot.forEach(function(doc) {
                    if (doc.id === '_metadata') return;
                    docs.push(doc);
                });

                var hasMore = docs.length > pageSize;
                if (hasMore) {
                    docs = docs.slice(0, pageSize);
                }

                docs.forEach(function(doc) {
                    bills.push(doc.data());
                    lastDoc = doc;
                });

                // Client-side dead status filter
                if (filters.status === 'dead') {
                    var deadStatuses = SAFE_CONFIG.DEAD_STATUSES || [];
                    bills = bills.filter(function(b) {
                        return deadStatuses.indexOf(b.status) !== -1;
                    });
                }

                // Client-side text search
                if (filters.search) {
                    var searchLower = filters.search.toLowerCase();
                    bills = bills.filter(function(b) {
                        var text = (b._searchText || [
                            b.billNumber || '',
                            b.title || '',
                            b.summary || '',
                            b.sponsor || '',
                            b.state || ''
                        ].join(' ').toLowerCase());
                        return text.indexOf(searchLower) !== -1;
                    });
                }

                return { bills: bills, lastDoc: lastDoc, hasMore: hasMore };
            } catch (err) {
                console.warn('Firestore queryBills failed, falling back to static:', err.message);
            }
        }

        // Static fallback — load all bills, filter client-side, simulate pagination
        var allBills = await this._getStaticLegislation(null);
        var filtered = this._clientFilter(allBills, filters);

        // Sort same as Firestore: state, then billNumber
        filtered.sort(function(a, b) {
            var sc = (a.state || '').localeCompare(b.state || '');
            if (sc !== 0) return sc;
            return (a.billNumber || '').localeCompare(b.billNumber || '');
        });

        // Simulate pagination with numeric offset
        var startIndex = startAfterDoc || 0; // For static fallback, startAfterDoc is a numeric index
        var page = filtered.slice(startIndex, startIndex + pageSize);
        var nextIndex = startIndex + pageSize;
        var hasMoreStatic = nextIndex < filtered.length;

        return { bills: page, lastDoc: hasMoreStatic ? nextIndex : null, hasMore: hasMoreStatic };
    },

    // --- Single Bill Lookup ---

    async getBill(billId) {
        // Check cache first
        if (this._billCache) {
            for (var key of Object.keys(this._billCache)) {
                var found = this._billCache[key].find(function(b) { return b.billId === billId; });
                if (found) return found;
            }
        }

        // Try Firestore direct lookup
        var db = this._getDb();
        if (db) {
            try {
                var doc = await db.collection('bills').doc(billId).get();
                if (doc.exists) return doc.data();
            } catch (err) {
                console.warn('Firestore getBill failed:', err.message);
            }
        }

        // Fall back to loading all static bills
        var allBills = await this._getStaticLegislation(null);
        return allBills.find(function(b) { return b.billId === billId; }) || null;
    },

    // --- Representatives ---

    async getRepresentatives(state, forceRefresh = false) {
        if (!forceRefresh && this._repCache[state] &&
            (Date.now() - (this._repCacheTime[state] || 0) < SAFE_CONFIG.CACHE_DURATION)) {
            return this._repCache[state];
        }

        // Try Firestore first
        var db = this._getDb();
        if (db) {
            try {
                var query = db.collection('legislators');
                if (state) {
                    query = query.where('state', '==', state);
                }
                var snapshot = await query.get();
                var reps = [];
                snapshot.forEach(function(doc) {
                    if (doc.id === '_metadata') return;
                    var l = doc.data();
                    reps.push({
                        name: l.name,
                        title: l.chamber === 'Senate' ? 'Sen.' : 'Rep.',
                        party: l.party,
                        phone: (l.contact || {}).phone || '',
                        email: (l.contact || {}).email || '',
                        contactForm: (l.contact || {}).contact_form || '',
                        website: (l.contact || {}).website || '',
                        level: l.level || '',
                        chamber: l.chamber || '',
                        office: l.office,
                        district: l.district,
                        state: l.state
                    });
                });
                this._repCache[state] = reps;
                this._repCacheTime[state] = Date.now();
                return reps;
            } catch (err) {
                console.warn('Firestore getRepresentatives failed, falling back to static:', err.message);
            }
        }

        // Fall back to static
        return this._getStaticRepresentatives(state);
    },

    // --- Action Templates ---

    async getTemplates(stance, forceRefresh = false) {
        if (!forceRefresh && this._templateCache) {
            if (stance) return this._templateCache.filter(function(t) { return t.stance === stance; });
            return this._templateCache;
        }

        var demos = this._getDemoTemplates();
        this._templateCache = demos;
        if (stance) return demos.filter(function(t) { return t.stance === stance; });
        return demos;
    },

    // --- Email Signup ---

    async submitEmailSignup(email, state, source) {
        if (!SAFE_CONFIG.IS_CONFIGURED) {
            return new Promise(function(resolve) {
                setTimeout(function() { resolve({ success: true, message: 'Demo mode' }); }, 800);
            });
        }

        try {
            await fetch(SAFE_CONFIG.GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ action: 'emailSignup', email: email, state: state, source: source })
            });
            return { success: true };
        } catch (error) {
            console.error('Error submitting email signup:', error);
            throw error;
        }
    },

    // --- Victories (Stopped Bills) ---

    async getVictories() {
        var allBills = await this.getLegislation(null);
        var deadStatuses = SAFE_CONFIG.DEAD_STATUSES;
        return allBills.filter(function(b) {
            return b.billType === 'anti' &&
                deadStatuses.indexOf(b.status) !== -1 &&
                b.stoppedWithAction;
        });
    },

    // --- Template Filling ---

    fillTemplate: function(template, data) {
        if (!template) return '';
        return template
            .replace(/\{REP_NAME\}/g, data.repName || '[Representative Name]')
            .replace(/\{REP_TITLE\}/g, data.repTitle || '[Title]')
            .replace(/\{BILL_NUMBER\}/g, data.billNumber || '[Bill Number]')
            .replace(/\{BILL_TITLE\}/g, data.billTitle || '[Bill Title]')
            .replace(/\{STATE\}/g, data.state || '[State]')
            .replace(/\{YOUR_NAME\}/g, data.yourName || '[Your Name]')
            .replace(/\{YOUR_CITY\}/g, data.yourCity || '[Your City]');
    },

    // --- Client-side filter helper (for static fallback) ---

    _clientFilter: function(bills, filters) {
        return bills.filter(function(bill) {
            if (filters.state && bill.state !== filters.state) return false;
            if (filters.billType && bill.billType !== filters.billType) return false;
            if (filters.status === 'active') {
                if (bill.isActive !== 'Yes') return false;
            } else if (filters.status === 'dead') {
                var deadStatuses = SAFE_CONFIG.DEAD_STATUSES || [];
                if (deadStatuses.indexOf(bill.status) === -1) return false;
            } else if (filters.status && bill.status !== filters.status) {
                return false;
            }
            if (filters.impact && bill.impact !== filters.impact) return false;
            if (filters.category && bill.category !== filters.category) return false;
            if (filters.search) {
                var searchLower = filters.search.toLowerCase();
                var haystack = [
                    bill.billNumber || '',
                    bill.title || '',
                    bill.summary || '',
                    bill.sponsor || '',
                    bill.state || ''
                ].join(' ').toLowerCase();
                if (haystack.indexOf(searchLower) === -1) return false;
            }
            return true;
        });
    },

    // --- Static Data (fallback) ---

    async _getStaticLegislation(state) {
        try {
            var resp = await fetch('data/bills.json');
            if (!resp.ok) return [];
            var data = await resp.json();
            var bills = data.bills || [];
            if (!state || state === 'ALL') return bills;
            return bills.filter(function(b) { return b.state === state; });
        } catch (e) {
            console.warn('No bill data available yet');
            return [];
        }
    },

    async _getStaticRepresentatives(state) {
        try {
            var resp = await fetch('data/legislators.json');
            if (!resp.ok) return [];
            var data = await resp.json();
            var legislators = data.legislators || [];
            if (!state) return legislators;
            var filtered = legislators.filter(function(l) { return l.state === state; });
            return filtered.map(function(l) {
                return {
                    name: l.name,
                    title: l.chamber === 'Senate' ? 'Sen.' : 'Rep.',
                    party: l.party,
                    phone: (l.contact || {}).phone || '',
                    email: (l.contact || {}).email || '',
                    contactForm: (l.contact || {}).contact_form || '',
                    website: (l.contact || {}).website || '',
                    level: l.level || '',
                    chamber: l.chamber || '',
                    office: l.office,
                    district: l.district,
                    state: l.state
                };
            });
        } catch (e) {
            console.warn('No legislator data available yet');
            return [];
        }
    },

    _getDemoTemplates: function() {
        return [
            {
                templateId: 'oppose-email-general',
                type: 'Email',
                stance: 'Oppose',
                subject: 'Please OPPOSE {BILL_NUMBER} - {BILL_TITLE}',
                body: 'Dear {REP_TITLE} {REP_NAME},\n\nI am writing as a concerned constituent from {YOUR_CITY}, {STATE} to urge you to OPPOSE {BILL_NUMBER}, the {BILL_TITLE}.\n\nThis legislation undermines public health by weakening vaccine requirements that protect our communities, especially our children. Vaccines are one of the greatest achievements in modern medicine and have saved millions of lives.\n\nI urge you to stand with science and protect the health of all {STATE} residents by opposing this bill.\n\nThank you for your time and service.\n\nSincerely,\n{YOUR_NAME}\n{YOUR_CITY}, {STATE}\n\nP.S. We invite all elected officials to share their science and public health positions publicly. Learn more and take the SAFE Action Pledge at https://scienceandfreedom.com/pledge.html',
                category: 'general'
            },
            {
                templateId: 'oppose-phone-general',
                type: 'Phone',
                stance: 'Oppose',
                subject: '',
                body: 'Hello, my name is {YOUR_NAME} and I\'m a constituent from {YOUR_CITY}.\n\nI\'m calling to ask {REP_TITLE} {REP_NAME} to please OPPOSE {BILL_NUMBER}, the {BILL_TITLE}.\n\nThis bill would weaken important public health protections and I believe it puts our community at risk. I urge the {REP_TITLE} to vote NO on this bill.\n\nThank you for taking my call.',
                category: 'general'
            },
            {
                templateId: 'support-email-general',
                type: 'Email',
                stance: 'Support',
                subject: 'Please SUPPORT {BILL_NUMBER} - {BILL_TITLE}',
                body: 'Dear {REP_TITLE} {REP_NAME},\n\nI am writing as a concerned constituent from {YOUR_CITY}, {STATE} to urge you to SUPPORT {BILL_NUMBER}, the {BILL_TITLE}.\n\nThis legislation strengthens public health protections and advances evidence-based policy for our communities. Supporting science is essential for the well-being of all {STATE} residents.\n\nI urge you to stand with science and vote YES on this important bill.\n\nThank you for your time and service.\n\nSincerely,\n{YOUR_NAME}\n{YOUR_CITY}, {STATE}\n\nP.S. We invite all elected officials to share their science and public health positions publicly. Learn more and take the SAFE Action Pledge at https://scienceandfreedom.com/pledge.html',
                category: 'general'
            },
            {
                templateId: 'support-phone-general',
                type: 'Phone',
                stance: 'Support',
                subject: '',
                body: 'Hello, my name is {YOUR_NAME} and I\'m a constituent from {YOUR_CITY}.\n\nI\'m calling to ask {REP_TITLE} {REP_NAME} to please SUPPORT {BILL_NUMBER}, the {BILL_TITLE}.\n\nThis bill advances evidence-based science policy and I believe it benefits our community. I urge the {REP_TITLE} to vote YES on this bill.\n\nThank you for taking my call.',
                category: 'general'
            }
        ];
    }
};
