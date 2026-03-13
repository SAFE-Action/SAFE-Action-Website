// Vercel Serverless Function: Census Geocoder proxy for state legislative districts
// Supports address-based and coordinate-based lookups

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

    var street = req.query.street;
    var city = req.query.city;
    var state = req.query.state;
    var zip = req.query.zip;
    var lat = req.query.lat;
    var lng = req.query.lng;

    // Must have either address or coordinates
    if (!lat && (!street || !state)) {
        return res.status(400).json({ error: 'Provide street+state or lat+lng' });
    }

    try {
        var match = null;

        // Strategy 1: Address-based lookup
        if (street && state) {
            var addrParams = new URLSearchParams({
                street: street, city: city || '', state: state, zip: zip || '',
                benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json',
            });
            var addrUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/address?' + addrParams.toString();
            var addrResp = await fetch(addrUrl);
            if (addrResp.ok) {
                var addrData = await addrResp.json();
                match = addrData && addrData.result && addrData.result.addressMatches && addrData.result.addressMatches[0];
            }
        }

        // Strategy 2: Coordinate-based lookup (fallback or direct)
        if (!match && lat && lng) {
            var coordParams = new URLSearchParams({
                x: lng, y: lat,
                benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json',
            });
            var coordUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?' + coordParams.toString();
            var coordResp = await fetch(coordUrl);
            if (coordResp.ok) {
                var coordData = await coordResp.json();
                // Coordinate endpoint returns geographies directly in result
                var coordGeos = coordData && coordData.result && coordData.result.geographies;
                if (coordGeos) {
                    match = { geographies: coordGeos, matchedAddress: 'coordinates:' + lat + ',' + lng, coordinates: { x: parseFloat(lng), y: parseFloat(lat) } };
                }
            }
        }

        if (!match) {
            return res.status(200).json({ found: false, districts: [] });
        }

        var geos = match.geographies || {};
        var geoKeys = Object.keys(geos);
        var districts = [];

        // Find keys flexibly (Census prefixes with year like "2024 State Legislative...")
        var slduKey = geoKeys.find(function(k) { return k.indexOf('State Legislative Districts - Upper') !== -1; });
        var sldlKey = geoKeys.find(function(k) { return k.indexOf('State Legislative Districts - Lower') !== -1; });
        var cdKey = geoKeys.find(function(k) { return k.indexOf('Congressional Districts') !== -1; });

        if (slduKey && geos[slduKey] && geos[slduKey][0]) {
            var d = geos[slduKey][0];
            districts.push({ type: 'state-senate', number: d.DISTRICT || d.BASENAME || '', name: d.NAMELSAD || d.NAME || '' });
        }
        if (sldlKey && geos[sldlKey] && geos[sldlKey][0]) {
            var d = geos[sldlKey][0];
            districts.push({ type: 'state-house', number: d.DISTRICT || d.BASENAME || '', name: d.NAMELSAD || d.NAME || '' });
        }
        if (cdKey && geos[cdKey] && geos[cdKey][0]) {
            var d = geos[cdKey][0];
            districts.push({ type: 'cd', number: d.DISTRICT || d.BASENAME || d.CD || '', name: d.NAMELSAD || d.NAME || '' });
        }

        return res.status(200).json({
            found: true,
            matchedAddress: match.matchedAddress,
            coordinates: match.coordinates,
            districts: districts,
        });
    } catch (e) {
        console.error('Census geocoder error:', e);
        return res.status(500).json({ error: 'Census lookup failed', details: e.message });
    }
};
