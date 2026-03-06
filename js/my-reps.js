// ============================================
// SAFE Action - My Representatives Hub
// ============================================

const MyRepsHub = {
    _civicCache: null,
    _reps: [],
    _bills: [],
    STORAGE_KEY: 'safe_my_address',

    // ── Address Lookup ────────────────────────────

    async lookupAddress(address) {
        const apiKey = SAFE_CONFIG.GOOGLE_CIVIC_API_KEY;
        if (!apiKey) {
            console.warn('No Civic API key configured. Use state fallback.');
            return null;
        }

        const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || resp.statusText);
            }
            const data = await resp.json();
            this._civicCache = data;

            // Persist address
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                address: address,
                timestamp: Date.now(),
                officials: data.officials,
                offices: data.offices,
            }));

            return this._parseCivicResponse(data);
        } catch (e) {
            console.error('Civic API error:', e);
            return null;
        }
    },

    getSavedAddress() {
        try {
            const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
            if (stored && stored.address) {
                // Cache for 24 hours
                if (Date.now() - stored.timestamp < 24 * 60 * 60 * 1000) {
                    return stored;
                }
            }
        } catch (e) {}
        return null;
    },

    clearSavedAddress() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    _parseCivicResponse(data) {
        const officials = data.officials || [];
        const offices = data.offices || [];
        const reps = [];

        offices.forEach(office => {
            const level = this._classifyOfficeLevel(office);
            const body = this._classifyOfficeBody(office);
            const indices = office.officialIndices || [];

            indices.forEach(idx => {
                const official = officials[idx];
                if (!official) return;

                const party = (official.party || '').charAt(0);
                const partyFull = official.party || '';
                const phone = (official.phones || [])[0] || '';
                const email = (official.emails || [])[0] || '';
                const photoUrl = official.photoUrl || '';
                const urls = official.urls || [];
                const channels = official.channels || [];

                reps.push({
                    name: official.name,
                    party: party === 'R' ? 'R' : party === 'D' ? 'D' : party === 'I' ? 'I' : party,
                    partyFull: partyFull,
                    office: office.name,
                    level: level,
                    body: body,
                    phone: phone,
                    email: email,
                    photoUrl: photoUrl,
                    urls: urls,
                    channels: channels,
                    divisionId: office.divisionId || '',
                    state: this._extractState(office.divisionId || ''),
                });
            });
        });

        return reps;
    },

    _classifyOfficeLevel(office) {
        const levels = office.levels || [];
        if (levels.includes('country')) return 'Federal';
        if (levels.includes('administrativeArea1')) return 'State';
        if (levels.includes('locality') || levels.includes('administrativeArea2')) return 'Local';
        // Fallback: check division ID
        const div = office.divisionId || '';
        if (div.includes('state') && !div.includes('place') && !div.includes('county')) {
            return div.includes('cd:') ? 'Federal' : 'State';
        }
        return 'Other';
    },

    _classifyOfficeBody(office) {
        const name = (office.name || '').toLowerCase();
        if (name.includes('u.s. senate') || name.includes('united states senate')) return 'US Senate';
        if (name.includes('u.s. house') || name.includes('united states house')) return 'US House';
        if (name.includes('governor')) return 'Governor';
        if (name.includes('state senate') || name.includes('state upper')) return 'State Senate';
        if (name.includes('state house') || name.includes('state lower') || name.includes('state representative') || name.includes('assembly')) return 'State House';
        return office.name || '';
    },

    _extractState(divisionId) {
        // e.g. "ocd-division/country:us/state:tx/cd:10"
        const match = divisionId.match(/state:(\w{2})/i);
        return match ? match[1].toUpperCase() : '';
    },

    // ── Data Matching ─────────────────────────────

    async enrichReps(civicReps) {
        // Load all data sources in parallel
        const [seatsData, legislators, bills] = await Promise.all([
            fetch('data/seats.json').then(r => r.ok ? r.json() : { seats: [] }).catch(() => ({ seats: [] })),
            typeof IntelligenceAPI !== 'undefined' ? IntelligenceAPI.getLegislators().catch(() => []) : [],
            typeof LegislationAPI !== 'undefined' ? LegislationAPI.getLegislation(null).catch(() => []) : [],
        ]);

        const seats = seatsData.seats || [];
        this._bills = bills;

        return civicReps.map(rep => {
            // Match to seats.json
            const seatMatch = this._matchSeat(rep, seats);

            // Match to legislators.json intelligence
            const intelMatch = this._matchIntelligence(rep, legislators);

            // Find relevant bills
            const repBills = this._findRepBills(rep, bills);

            // Determine primary action
            const primaryAction = this._determinePrimaryAction(rep, intelMatch, repBills);

            return {
                ...rep,
                photoUrl: rep.photoUrl || (seatMatch?.incumbent?.photoUrl) || '',
                seat: seatMatch,
                intel: intelMatch,
                bills: repBills,
                primaryAction: primaryAction,
                candidates: seatMatch?.candidates || [],
            };
        });
    },

    _matchSeat(rep, seats) {
        const state = rep.state;
        if (!state) return null;

        // Try exact body match
        for (const seat of seats) {
            if (seat.state !== state) continue;

            if (rep.body === 'US Senate' && seat.body === 'US Senate') {
                // Match by incumbent name
                if (seat.incumbent && this._nameMatch(rep.name, seat.incumbent.name)) {
                    return seat;
                }
            }
            if (rep.body === 'US House' && seat.body === 'US House') {
                if (seat.incumbent && this._nameMatch(rep.name, seat.incumbent.name)) {
                    return seat;
                }
            }
            if (rep.body === 'Governor' && seat.body === 'Governor') {
                return seat;
            }
        }
        return null;
    },

    _matchIntelligence(rep, legislators) {
        if (!legislators || legislators.length === 0) return null;

        const repName = rep.name.toLowerCase().replace(/^(rep\.|sen\.|dr\.|hon\.)\s*/i, '');

        for (const leg of legislators) {
            const legName = leg.name.toLowerCase().replace(/^(rep\.|sen\.|dr\.|hon\.)\s*/i, '');
            if (this._nameMatch(repName, legName)) {
                return leg;
            }
        }
        return null;
    },

    _nameMatch(a, b) {
        if (!a || !b) return false;
        const normalize = s => s.toLowerCase().replace(/[^a-z\s]/g, '').trim();
        const na = normalize(a);
        const nb = normalize(b);
        if (na === nb) return true;
        // Check if last names match + first initial
        const partsA = na.split(/\s+/);
        const partsB = nb.split(/\s+/);
        const lastA = partsA[partsA.length - 1];
        const lastB = partsB[partsB.length - 1];
        if (lastA === lastB && partsA[0][0] === partsB[0][0]) return true;
        return false;
    },

    _findRepBills(rep, bills) {
        if (!bills || bills.length === 0) return [];
        const state = rep.state;

        return bills.filter(bill => {
            if (bill.isActive !== 'Yes') return false;
            // Federal rep -> federal bills + their state bills
            if (rep.level === 'Federal') {
                return bill.level === 'Federal' || bill.state === state;
            }
            // State rep -> their state bills
            return bill.state === state;
        }).sort((a, b) => {
            // High impact first
            const impactOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
            return (impactOrder[a.impact] || 2) - (impactOrder[b.impact] || 2);
        });
    },

    _determinePrimaryAction(rep, intel, bills) {
        const persuadability = intel?.persuadability;
        const score = persuadability?.score ?? 5;
        const category = persuadability?.category || 'unknown';

        // Priority 1: High-impact anti-science bill in committee
        const urgentBill = bills.find(b =>
            b.billType === 'anti' && b.impact === 'High' &&
            (b.status === 'In Committee' || b.status === 'Introduced')
        );
        if (urgentBill) {
            return {
                type: 'oppose-bill',
                priority: 1,
                label: `Urge to oppose ${urgentBill.billNumber}`,
                description: urgentBill.title,
                bill: urgentBill,
            };
        }

        // Priority 2: Any active anti-science bill
        const activeBill = bills.find(b => b.billType === 'anti' && b.isActive === 'Yes');
        if (activeBill) {
            return {
                type: 'oppose-bill',
                priority: 2,
                label: `Urge to oppose ${activeBill.billNumber}`,
                description: activeBill.title,
                bill: activeBill,
            };
        }

        // Priority 3: No pledge + fence-sitter or likely-win
        if (category === 'fence-sitter' || category === 'likely-win' || score >= 4) {
            return {
                type: 'ask-pledge',
                priority: 3,
                label: 'Ask to take the SAFE Action pledge',
                description: intel ? `${category} — ${persuadability?.reasoning?.substring(0, 100) || 'Persuadable target'}` : 'Help hold this official accountable on science policy',
            };
        }

        // Priority 4: Default pledge ask
        return {
            type: 'ask-pledge',
            priority: 4,
            label: 'Ask to take the SAFE Action pledge',
            description: 'Help hold this official accountable on science policy',
        };
    },

    // ── State Fallback ────────────────────────────

    async getRepsByState(stateCode) {
        const [seatsData, legislators, bills] = await Promise.all([
            fetch('data/seats.json').then(r => r.ok ? r.json() : { seats: [] }).catch(() => ({ seats: [] })),
            typeof IntelligenceAPI !== 'undefined' ? IntelligenceAPI.getLegislators(stateCode).catch(() => []) : [],
            typeof LegislationAPI !== 'undefined' ? LegislationAPI.getLegislation(stateCode).catch(() => []) : [],
        ]);

        const seats = (seatsData.seats || []).filter(s =>
            s.state === stateCode &&
            s.incumbent &&
            (s.body === 'US Senate' || s.body === 'US House' || s.body === 'Governor')
        );

        this._bills = bills;

        return seats.map(seat => {
            const inc = seat.incumbent || {};
            const rep = {
                name: inc.name || `${seat.body} ${seat.district || ''}`.trim(),
                party: inc.party || '?',
                partyFull: inc.party === 'R' ? 'Republican' : inc.party === 'D' ? 'Democrat' : inc.party || '',
                office: `${seat.body}${seat.district ? ' District ' + seat.district : ''}`,
                level: seat.level || 'Federal',
                body: seat.body,
                phone: '',
                email: '',
                photoUrl: inc.photoUrl || '',
                state: stateCode,
            };

            const intelMatch = this._matchIntelligence(rep, legislators);
            const repBills = this._findRepBills(rep, bills);
            const primaryAction = this._determinePrimaryAction(rep, intelMatch, repBills);

            return {
                ...rep,
                seat: seat,
                intel: intelMatch,
                bills: repBills,
                primaryAction: primaryAction,
                candidates: seat.candidates || [],
            };
        });
    },
};
