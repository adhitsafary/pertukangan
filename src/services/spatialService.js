/**
 * Spatial Service: Menghitung jarak antara 2 koordinat (Haversine Formula)
 * Digunakan untuk geofencing check-in mulai kerja (< 50 meter) dan radius pencarian tukang.
 */

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radius bumi dalam meter
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Hasil dalam meter
}

/**
 * Validasi apakah posisi tukang berada dalam radius geofencing lokasi proyek
 */
function validateGeofence(workerLat, workerLon, projectLat, projectLon, maxRadiusMeters = 50) {
    const distanceMeters = calculateHaversineDistance(workerLat, workerLon, projectLat, projectLon);
    return {
        isWithinRadius: distanceMeters <= maxRadiusMeters,
        distanceMeters: Math.round(distanceMeters * 100) / 100
    };
}

module.exports = {
    calculateHaversineDistance,
    validateGeofence
};
