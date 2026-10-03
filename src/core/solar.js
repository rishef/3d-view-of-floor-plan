// Solar position (simplified NOAA / Astronomical Almanac algorithm, accurate to ~0.3°)
// and helpers for sunrise/sunset and directions in plan coordinates.

const RAD = Math.PI / 180;

/** Sun azimuth (deg clockwise from true north) and altitude (deg above horizon) for a UTC instant. */
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const g = RAD * (357.529 + 0.98560028 * d);
  const q = 280.459 + 0.98564736 * d;
  const L = RAD * (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = RAD * (23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const H = RAD * (gmst * 15 + lon) - ra; // local hour angle
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { azimuth: ((az / RAD) % 360 + 360) % 360, altitude: alt / RAD };
}

/** UTC instant for a local civil date ("YYYY-MM-DD") and minutes after local midnight. */
export function localToUTC(dateStr, minutes, utcOffsetHours) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (minutes - utcOffsetHours * 60) * 60000);
}

/** Sunrise, sunset and solar noon in local minutes; null when the sun never rises/sets that day. */
export function sunTimes(dateStr, lat, lon, utcOffsetHours) {
  const h0 = -0.833; // refraction + solar disc radius
  let prev = null;
  let sunrise = null, sunset = null, solarNoon = 0, maxAlt = -90;
  for (let m = 0; m <= 1440; m += 2) {
    const alt = sunPosition(localToUTC(dateStr, m, utcOffsetHours), lat, lon).altitude;
    if (prev) {
      const crossUp = prev.alt < h0 && alt >= h0;
      const crossDown = prev.alt >= h0 && alt < h0;
      const t = prev.m + ((h0 - prev.alt) / (alt - prev.alt)) * (m - prev.m);
      if (crossUp && sunrise === null) sunrise = t;
      if (crossDown) sunset = t;
    }
    if (alt > maxAlt) { maxAlt = alt; solarNoon = m; }
    prev = { m, alt };
  }
  return { sunrise, sunset, solarNoon, maxAltitude: maxAlt, polarDay: sunrise === null && maxAlt > h0, polarNight: maxAlt < h0 };
}

/** Unit vector pointing toward the sun in plan coordinates (x east-ish, y up the plan, z up). */
export function sunVectorPlan(azimuth, altitude, planTopBearing = 0) {
  const a = (azimuth - planTopBearing) * RAD;
  const c = Math.cos(altitude * RAD);
  return { x: Math.sin(a) * c, y: Math.cos(a) * c, z: Math.sin(altitude * RAD) };
}

export function formatClock(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassLabel = (bearing) => COMPASS16[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];

export const COMPASS8 = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
