/**
 * Accurate IANA timezone resolver and local time formatter using `Intl.DateTimeFormat`.
 * Covers all 102 mapped countries in jurisdictions_map.json plus major unmapped countries,
 * with longitude-band disambiguation for multi-timezone countries and an integer nautical
 * UTC offset fallback for open-ocean custom points.
 */

export const ISO_TO_TZ = {
  // Southern Africa
  '710': 'Africa/Johannesburg',
  '426': 'Africa/Maseru',
  '748': 'Africa/Mbabane',
  '516': 'Africa/Windhoek',
  '072': 'Africa/Gaborone',
  '716': 'Africa/Harare',
  '894': 'Africa/Lusaka',
  '454': 'Africa/Blantyre',
  '508': 'Africa/Maputo',
  '450': 'Indian/Antananarivo',
  '024': 'Africa/Luanda',

  // North, East & West Africa
  '504': 'Africa/Casablanca',
  '732': 'Africa/El_Aaiun',
  '012': 'Africa/Algiers',
  '788': 'Africa/Tunis',
  '434': 'Africa/Tripoli',
  '818': 'Africa/Cairo',
  '729': 'Africa/Khartoum',
  '404': 'Africa/Nairobi',
  '834': 'Africa/Dar_es_Salaam',
  '800': 'Africa/Kampala',
  '706': 'Africa/Mogadishu',
  '262': 'Africa/Djibouti',
  '231': 'Africa/Addis_Ababa',
  '566': 'Africa/Lagos',
  '288': 'Africa/Accra',
  '686': 'Africa/Dakar',
  '466': 'Africa/Bamako',
  '478': 'Africa/Nouakchott',
  '562': 'Africa/Niamey',
  '768': 'Africa/Lome',
  '854': 'Africa/Ouagadougou',

  // Middle East
  '682': 'Asia/Riyadh',
  '784': 'Asia/Dubai',
  '634': 'Asia/Qatar',
  '414': 'Asia/Kuwait',
  '512': 'Asia/Muscat',
  '887': 'Asia/Aden',
  '400': 'Asia/Amman',
  '275': 'Asia/Hebron',
  '376': 'Asia/Jerusalem',
  '422': 'Asia/Beirut',
  '760': 'Asia/Damascus',
  '368': 'Asia/Baghdad',
  '364': 'Asia/Tehran',

  // Europe & Türkiye
  '792': 'Europe/Istanbul',
  '826': 'Europe/London',
  '372': 'Europe/Dublin',
  '250': 'Europe/Paris',
  '276': 'Europe/Berlin',
  '528': 'Europe/Amsterdam',
  '056': 'Europe/Brussels',
  '442': 'Europe/Luxembourg',
  '756': 'Europe/Zurich',
  '040': 'Europe/Vienna',
  '380': 'Europe/Rome',
  '724': 'Europe/Madrid',
  '620': 'Europe/Lisbon',
  '300': 'Europe/Athens',
  '578': 'Europe/Oslo',
  '752': 'Europe/Stockholm',
  '208': 'Europe/Copenhagen',
  '246': 'Europe/Helsinki',
  '616': 'Europe/Warsaw',
  '348': 'Europe/Budapest',
  '642': 'Europe/Bucharest',
  '100': 'Europe/Sofia',
  '008': 'Europe/Tirane',
  '070': 'Europe/Sarajevo',
  '191': 'Europe/Zagreb',
  '688': 'Europe/Belgrade',
  '499': 'Europe/Podgorica',
  '807': 'Europe/Skopje',
  '705': 'Europe/Ljubljana',
  '804': 'Europe/Kyiv',

  // South, Central & East Asia
  '356': 'Asia/Kolkata',
  '586': 'Asia/Karachi',
  '050': 'Asia/Dhaka',
  '144': 'Asia/Colombo',
  '004': 'Asia/Kabul',
  '398': 'Asia/Almaty',
  '860': 'Asia/Tashkent',
  '762': 'Asia/Dushanbe',
  '417': 'Asia/Bishkek',
  '795': 'Asia/Ashgabat',
  '031': 'Asia/Baku',
  '156': 'Asia/Shanghai',
  '158': 'Asia/Taipei',
  '392': 'Asia/Tokyo',
  '410': 'Asia/Seoul',
  '608': 'Asia/Manila',
  '458': 'Asia/Kuala_Lumpur',
  '096': 'Asia/Brunei',
  '764': 'Asia/Bangkok',
  '704': 'Asia/Ho_Chi_Minh',
  '702': 'Asia/Singapore',

  // Oceania & Americas
  '554': 'Pacific/Auckland',
  '242': 'Pacific/Fiji',
  '152': 'America/Santiago',
  '170': 'America/Bogota',
  '068': 'America/La_Paz',
  '328': 'America/Guyana',
  '740': 'America/Paramaribo',
  '780': 'America/Port_of_Spain',
  '076': 'America/Sao_Paulo',
  '032': 'America/Argentina/Buenos_Aires',
  '484': 'America/Mexico_City',
};

export function resolveIanaTimezone(iso, lon = 0) {
  const key = iso ? String(iso) : '';
  if (!key) return null;

  if (key === '840') {
    if (lon < -150) return 'Pacific/Honolulu';
    if (lon < -130) return 'America/Anchorage';
    if (lon < -114) return 'America/Los_Angeles';
    if (lon < -102) return 'America/Denver';
    if (lon < -85) return 'America/Chicago';
    return 'America/New_York';
  }
  if (key === '124') {
    if (lon < -114) return 'America/Vancouver';
    if (lon < -102) return 'America/Edmonton';
    if (lon < -88) return 'America/Winnipeg';
    if (lon < -64) return 'America/Toronto';
    return 'America/Halifax';
  }
  if (key === '036') {
    if (lon < 129) return 'Australia/Perth';
    if (lon < 141) return 'Australia/Adelaide';
    return 'Australia/Sydney';
  }
  if (key === '360') {
    if (lon < 115) return 'Asia/Jakarta';
    if (lon < 125) return 'Asia/Makassar';
    return 'Asia/Jayapura';
  }
  if (key === '643') {
    if (lon < 52) return 'Europe/Moscow';
    if (lon < 68) return 'Asia/Yekaterinburg';
    if (lon < 85) return 'Asia/Omsk';
    if (lon < 102) return 'Asia/Krasnoyarsk';
    if (lon < 120) return 'Asia/Irkutsk';
    if (lon < 138) return 'Asia/Yakutsk';
    return 'Asia/Vladivostok';
  }

  return ISO_TO_TZ[key] || null;
}

export function formatLocalTime(astroTime, { iso, tzIso, lon = 0, tz } = {}) {
  if (!astroTime || !astroTime.date) {
    return { text: '—', isExact: false, ianaTz: null };
  }
  const dt = astroTime.date;
  const ianaTz = tz || resolveIanaTimezone(iso || tzIso, lon);

  if (ianaTz) {
    try {
      let hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: ianaTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(dt);
      if (hhmm.startsWith('24:')) hhmm = '00:' + hhmm.slice(3);

      const tzPart = new Intl.DateTimeFormat('en-US', {
        timeZone: ianaTz,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(dt)
        .find((p) => p.type === 'timeZoneName')?.value;

      const utcOffset = tzPart ? (tzPart === 'GMT' ? 'UTC+0' : tzPart.replace('GMT', 'UTC')) : '';
      return {
        text: utcOffset ? `${hhmm} (${utcOffset})` : hhmm,
        isExact: true,
        ianaTz,
      };
    } catch {
      // Fallback below if browser lacks an IANA entry
    }
  }

  const off = Math.round(lon / 15);
  const localMs = dt.getTime() + off * 3600 * 1000;
  const d = new Date(localMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const sign = off >= 0 ? '+' : '';
  return {
    text: `${hh}:${mm} (UTC${sign}${off})`,
    isExact: false,
    ianaTz: null,
  };
}
