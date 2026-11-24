/**
 * Prepare offline geographic datasets for whenIsEid:
 * - src/data/jurisdictions_map.json (mapped to world-atlas/countries-110m.json ISO IDs)
 * - src/data/cities.json (world cities + all 17 South African observation stations)
 * - src/data/sa_stations.json & src/data/sa_reports.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DATA = path.join(ROOT, 'src', 'data');
fs.mkdirSync(SRC_DATA, { recursive: true });

const ZONE_META = {
  local_sighting: {
    label: 'Local / Regional Sighting',
    color: '#10b981',
    defaultRule: 'Requires verified physical crescent sighting within national or shared regional horizon.',
  },
  follow_saudi: {
    label: 'Follows Saudi Arabia',
    color: '#38bdf8',
    defaultRule: 'Follows Saudi Supreme Court declarations (often aligned with Umm al-Qura criterion).',
    hub: { name: 'Makkah, Saudi Arabia', lat: 21.4225, lon: 39.8262 },
  },
  follow_turkey_diyanet: {
    label: 'Follows Turkey / ECFR',
    color: '#a855f7',
    defaultRule: 'Istanbul 2016 Unified Calendar: moon altitude > 5° and elongation > 8° at sunset anywhere on Earth.',
    hub: { name: 'Ankara, Turkey', lat: 39.9334, lon: 32.8597 },
  },
  regional_criteria: {
    label: 'Regional / Astronomical Criteria',
    color: '#f59e0b',
    defaultRule: 'Adopts regional governmental criteria (e.g., MABIMS 3° altitude / 6.4° elongation in SE Asia, or lag rules).',
  },
  split_communities: {
    label: 'Mixed / Split Communities',
    color: '#ec4899',
    defaultRule: 'Different Muslim councils/mosques follow either local sighting, Saudi announcements, or calculation.',
  },
};

// Explicit mapping keyed by world-atlas properties.name
const COUNTRY_OVERRIDES = {
  // Local Sighting (strict or national committees)
  'South Africa': { zone: 'local_sighting', authority: 'UUCSA / MJC / COSSA (Maankykers)', rule: 'Strict local naked-eye sighting across Western Cape, Gauteng, KZN & Eastern Cape stations.', center: [-29.0, 24.5], zoom: 5 },
  'Morocco': { zone: 'local_sighting', authority: 'Ministry of Habous & Islamic Affairs', rule: 'Nationwide physical sighting network (270+ observation posts).', center: [31.8, -7.1], zoom: 5 },
  'W. Sahara': { zone: 'local_sighting', authority: 'Regional Local Sighting', rule: 'Local western-horizon sighting.', center: [24.2, -13.0], zoom: 5 },
  'Pakistan': { zone: 'local_sighting', authority: 'Central Ruet-e-Hilal Committee', rule: 'Official national physical moonsighting.', center: [30.3, 69.3], zoom: 5 },
  'India': { zone: 'local_sighting', authority: 'Imarat-e-Shariah / Markazi Ruyat-e-Hilal', rule: 'Regional physical sighting committees (some Kerala groups follow calculation).', center: [21.1, 78.9], zoom: 4 },
  'Bangladesh': { zone: 'local_sighting', authority: 'National Moon Sighting Committee', rule: 'Official physical sighting within Bangladesh.', center: [23.7, 90.3], zoom: 6 },
  'Iran': { zone: 'local_sighting', authority: 'Office of the Supreme Leader Istehlal', rule: 'National optical & naked-eye crescent committees.', center: [32.4, 53.7], zoom: 5 },
  'Oman': { zone: 'local_sighting', authority: 'Ministry of Endowments & Religious Affairs', rule: 'Strict local sighting vetted by astronomical impossibility checks.', center: [21.5, 55.9], zoom: 5 },
  'Jordan': { zone: 'local_sighting', authority: 'Jordanian Ifta Department', rule: 'Official local/regional sighting committee.', center: [31.2, 36.5], zoom: 6 },
  'Yemen': { zone: 'local_sighting', authority: 'Local Sighting', rule: 'Physical crescent sighting.', center: [15.5, 48.5], zoom: 5 },
  'Australia': { zone: 'local_sighting', authority: 'ANIC / Moonsighting Australia', rule: 'Majority local sighting (some communities follow Saudi or Turkey).', center: [-25.3, 133.8], zoom: 4 },
  'New Zealand': { zone: 'local_sighting', authority: 'FIANZ Hilal Committee', rule: 'Local sighting or nearby Australian sighting.', center: [-41.3, 174.7], zoom: 5 },
  'Kenya': { zone: 'local_sighting', authority: 'Chief Kadhi of Kenya', rule: 'National/East African coastal physical sighting.', center: [-0.2, 37.9], zoom: 5 },
  'Tanzania': { zone: 'local_sighting', authority: 'BAKWATA / Zanzibar Mufti', rule: 'Local East African physical sighting.', center: [-6.3, 34.9], zoom: 5 },
  'Uganda': { zone: 'local_sighting', authority: 'Uganda Muslim Supreme Council', rule: 'Local/East African sighting.', center: [1.4, 32.3], zoom: 6 },
  'Namibia': { zone: 'local_sighting', authority: 'Namibia Islamic Judicial Council / Follows SA', rule: 'Local sighting / shares Southern African matla with South Africa.', center: [-22.6, 17.1], zoom: 5, hub: { name: 'Cape Town / Pretoria', lat: -29.0, lon: 24.5 } },
  'Botswana': { zone: 'local_sighting', authority: 'Botswana Muslim Association / Follows SA', rule: 'Local sighting / shares Southern African matla with South Africa.', center: [-22.3, 24.7], zoom: 5, hub: { name: 'Pretoria, South Africa', lat: -25.78, lon: 28.11 } },
  'Zimbabwe': { zone: 'local_sighting', authority: 'Zimbabwe Hilal Committee / SA Matla', rule: 'Local sighting and Southern African regional horizon.', center: [-19.0, 29.1], zoom: 5 },
  'Zambia': { zone: 'local_sighting', authority: 'Zambia Hilal Committee', rule: 'Local sighting (Lusaka/Copperbelt) & regional sharing.', center: [-13.1, 27.8], zoom: 5 },
  'Malawi': { zone: 'local_sighting', authority: 'Muslim Association of Malawi', rule: 'Local physical sighting.', center: [-13.2, 34.3], zoom: 6 },
  'Mozambique': { zone: 'local_sighting', authority: 'Conselho Islâmico de Moçambique', rule: 'Local coastal & regional Southern African sighting.', center: [-18.7, 35.5], zoom: 5 },
  'Madagascar': { zone: 'local_sighting', authority: 'Local Sighting', rule: 'Local island physical sighting.', center: [-18.8, 46.9], zoom: 5 },
  'Lesotho': { zone: 'local_sighting', authority: 'Follows South Africa (UUCSA/MJC)', rule: 'Shares Southern African horizon and UUCSA/MJC announcements.', center: [-29.6, 28.2], zoom: 7, hub: { name: 'South Africa (UUCSA)', lat: -29.0, lon: 24.5 } },
  'eSwatini': { zone: 'local_sighting', authority: 'Follows South Africa (UUCSA)', rule: 'Shares Southern African horizon and UUCSA announcements.', center: [-26.5, 31.5], zoom: 7, hub: { name: 'South Africa (UUCSA)', lat: -29.0, lon: 24.5 } },
  'Nigeria': { zone: 'local_sighting', authority: 'NSCIA (Sultan of Sokoto)', rule: 'Official Nigerian moonsighting reports.', center: [9.1, 8.7], zoom: 5 },
  'Ghana': { zone: 'local_sighting', authority: 'Office of the National Chief Imam', rule: 'Local physical sighting.', center: [7.9, -1.0], zoom: 6 },
  'Senegal': { zone: 'local_sighting', authority: 'CONACOC', rule: 'National physical crescent sighting.', center: [14.5, -14.4], zoom: 6 },
  'Niger': { zone: 'local_sighting', authority: 'Islamic Council of Niger', rule: 'Local physical sighting.', center: [17.6, 8.1], zoom: 5 },
  'Sri Lanka': { zone: 'local_sighting', authority: 'Colombo Grand Mosque', rule: 'Official national physical sighting.', center: [7.9, 80.7], zoom: 6 },
  'Chile': { zone: 'local_sighting', authority: 'Centro Islámico de Chile', rule: 'Local sighting on Pacific western horizon.', center: [-33.4, -70.6], zoom: 4 },
  'Colombia': { zone: 'local_sighting', authority: 'Follows Chile / Regional Sighting', rule: 'Adopts South American Pacific sighting (Chile).', center: [4.6, -74.1], zoom: 5, hub: { name: 'Santiago, Chile', lat: -33.45, lon: -70.67 } },
  'Guyana': { zone: 'local_sighting', authority: 'CIOG', rule: 'Local & Caribbean sighting.', center: [4.9, -58.9], zoom: 6 },
  'Suriname': { zone: 'local_sighting', authority: 'Local Sighting', rule: 'Local & Caribbean sighting.', center: [3.9, -56.0], zoom: 6 },
  'Trinidad and Tobago': { zone: 'local_sighting', authority: 'ASJA Moon Sighting Committee', rule: 'Local Caribbean sighting.', center: [10.7, -61.2], zoom: 8 },
  'Fiji': { zone: 'local_sighting', authority: 'Fiji Muslim League', rule: 'Local South Pacific sighting.', center: [-17.7, 178.0], zoom: 6 },

  // Follow Saudi Arabia
  'Saudi Arabia': { zone: 'follow_saudi', authority: 'Supreme Court of Saudi Arabia', rule: 'Official Saudi sighting testimonies (traditionally aligns with Umm al-Qura calendar).', center: [23.9, 45.1], zoom: 5 },
  'United Arab Emirates': { zone: 'follow_saudi', authority: 'UAE Moon-Sighting Committee', rule: 'Local committee generally aligning with Saudi/Gulf announcements.', center: [23.4, 53.8], zoom: 6 },
  'Qatar': { zone: 'follow_saudi', authority: 'Ministry of Endowments (Awqaf)', rule: 'Gulf/Saudi alignment.', center: [25.3, 51.2], zoom: 8 },
  'Kuwait': { zone: 'follow_saudi', authority: 'Kuwait Crescent Committee', rule: 'Gulf/Saudi alignment.', center: [29.3, 47.5], zoom: 7 },
  'Afghanistan': { zone: 'follow_saudi', authority: 'Supreme Court / Aligns with Saudi', rule: 'Frequently follows Saudi Arabia or regional reports.', center: [33.9, 67.7], zoom: 5 },
  'Iraq': { zone: 'follow_saudi', authority: 'Sunni Endowment (Saudi) / Shia Marja (Local)', rule: 'Sunni Endowment aligns with Saudi; Shia community follows local sighting.', center: [33.2, 43.7], zoom: 5 },
  'Syria': { zone: 'follow_saudi', authority: 'Syrian Sharia Courts', rule: 'Follows Saudi / Levant announcements.', center: [34.8, 39.0], zoom: 6 },
  'Lebanon': { zone: 'follow_saudi', authority: 'Dar al-Fatwa', rule: 'Follows Saudi Arabia (Shia follow local sighting).', center: [33.9, 35.8], zoom: 7 },
  'Palestine': { zone: 'follow_saudi', authority: 'Grand Mufti of Jerusalem', rule: 'Follows Saudi / regional announcements.', center: [31.9, 35.2], zoom: 7 },
  'Israel': { zone: 'follow_saudi', authority: 'Local Arab Muslim Councils', rule: 'Generally follows Saudi / Jerusalem Mufti.', center: [31.5, 34.8], zoom: 7 },
  'Sudan': { zone: 'follow_saudi', authority: 'Sudan Fiqh Council', rule: 'Follows Saudi / Red Sea sighting.', center: [15.5, 30.2], zoom: 5 },
  'Mauritania': { zone: 'follow_saudi', authority: 'National Crescent Commission', rule: 'Follows Saudi / regional reports.', center: [21.0, -10.9], zoom: 5 },
  'Somalia': { zone: 'follow_saudi', authority: 'Ministry of Religious Affairs', rule: 'Generally follows Saudi Arabia.', center: [5.1, 46.2], zoom: 5 },
  'Djibouti': { zone: 'follow_saudi', authority: 'Ministry of Islamic Affairs', rule: 'Follows Saudi Arabia.', center: [11.8, 42.6], zoom: 7 },
  'Mali': { zone: 'follow_saudi', authority: 'High Islamic Council of Mali', rule: 'Follows Saudi / West African announcements.', center: [17.6, -4.0], zoom: 5 },
  'Burkina Faso': { zone: 'follow_saudi', authority: 'FAIB', rule: 'Follows Saudi Arabia.', center: [12.2, -1.6], zoom: 6 },
  'Togo': { zone: 'follow_saudi', authority: 'Union Musulmane du Togo', rule: 'Follows Saudi Arabia.', center: [8.6, 0.8], zoom: 6 },
  'Kazakhstan': { zone: 'follow_saudi', authority: 'SAMK', rule: 'Follows Saudi / Turkic consensus.', center: [48.0, 66.9], zoom: 4 },
  'Uzbekistan': { zone: 'follow_saudi', authority: 'Muslim Board of Uzbekistan', rule: 'Follows Saudi / Central Asian consensus.', center: [41.4, 64.6], zoom: 5 },
  'Kyrgyzstan': { zone: 'follow_saudi', authority: 'Spiritual Administration', rule: 'Follows Saudi / Central Asian consensus.', center: [41.2, 74.8], zoom: 6 },
  'Tajikistan': { zone: 'follow_saudi', authority: 'Council of Ulema', rule: 'Follows Saudi / Central Asian consensus.', center: [38.9, 71.3], zoom: 6 },
  'Turkmenistan': { zone: 'follow_saudi', authority: 'Muftiate', rule: 'Follows Saudi Arabia.', center: [39.0, 59.6], zoom: 5 },
  'Azerbaijan': { zone: 'follow_saudi', authority: 'Caucasus Muslims Board', rule: 'Aligns with Saudi / regional announcements.', center: [40.1, 47.6], zoom: 6 },
  'Philippines': { zone: 'follow_saudi', authority: 'NCMF', rule: 'Local/Saudi alignment.', center: [12.9, 121.8], zoom: 5 },
  'Russia': { zone: 'follow_saudi', authority: 'Mufti Council of Russia', rule: 'Follows Saudi / Turkey consensus (Dagestan local).', center: [55.7, 37.6], zoom: 4 },
  'Sweden': { zone: 'follow_saudi', authority: 'Swedish Islamic Councils', rule: 'Majority follow Saudi Arabia or ECFR.', center: [59.3, 18.1], zoom: 4 },
  'Denmark': { zone: 'follow_saudi', authority: 'Danish Islamic Councils', rule: 'Majority follow Saudi Arabia or Turkey.', center: [55.7, 12.6], zoom: 6 },
  'Finland': { zone: 'follow_saudi', authority: 'Islamic Society of Finland', rule: 'Follows Saudi Arabia.', center: [60.2, 24.9], zoom: 5 },
  'Belgium': { zone: 'follow_saudi', authority: 'EMB', rule: 'Follows Saudi Arabia / ECFR.', center: [50.8, 4.3], zoom: 7 },
  'Netherlands': { zone: 'follow_saudi', authority: 'Turkish (Diyanet) & Moroccan/Saudi councils', rule: 'Follows Saudi/Morocco or Turkey Diyanet.', center: [52.1, 5.3], zoom: 7 },
  'Austria': { zone: 'follow_saudi', authority: 'IGGÖ', rule: 'Follows Saudi / Turkey Diyanet.', center: [47.5, 14.5], zoom: 6 },
  'Switzerland': { zone: 'follow_saudi', authority: 'FIDS', rule: 'Follows Saudi / ECFR.', center: [46.8, 8.2], zoom: 7 },
  'Italy': { zone: 'follow_saudi', authority: 'UCOII', rule: 'Follows Saudi / ECFR.', center: [41.9, 12.6], zoom: 5 },
  'Albania': { zone: 'follow_saudi', authority: 'Muslim Community of Albania', rule: 'Follows Saudi / Turkey Diyanet.', center: [41.1, 20.2], zoom: 7 },
  'Bulgaria': { zone: 'follow_saudi', authority: 'Chief Mufti of Bulgaria', rule: 'Follows Saudi / Turkey Diyanet.', center: [42.7, 25.5], zoom: 6 },
  'Romania': { zone: 'follow_saudi', authority: 'Muftiate of Romania', rule: 'Follows Saudi / Turkey Diyanet.', center: [45.9, 25.0], zoom: 6 },
  'Hungary': { zone: 'follow_saudi', authority: 'Hungarian Islamic Community', rule: 'Follows Saudi Arabia.', center: [47.2, 19.5], zoom: 6 },
  'Japan': { zone: 'follow_saudi', authority: 'Japan Islamic Trust', rule: 'Follows Saudi / Malaysia.', center: [36.2, 138.3], zoom: 5 },
  'Taiwan': { zone: 'follow_saudi', authority: 'Chinese Muslim Association', rule: 'Follows Saudi Arabia.', center: [23.7, 121.0], zoom: 7 },
  'Bolivia': { zone: 'follow_saudi', authority: 'Bolivian Islamic Center', rule: 'Follows Saudi Arabia.', center: [-16.3, -63.6], zoom: 5 },

  // Follow Turkey / ECFR Unified Global Calculation (Alt > 5°, Elong > 8°)
  'Turkey': { zone: 'follow_turkey_diyanet', authority: 'Diyanet (Presidency of Religious Affairs)', rule: '2016 Istanbul Unified Calendar: moon altitude > 5° & elongation > 8° at sunset anywhere on Earth.', center: [39.0, 35.2], zoom: 5 },
  'Germany': { zone: 'follow_turkey_diyanet', authority: 'DITIB / KRM / ECFR', rule: 'Majority Turkish-German councils follow Turkey Diyanet global calculation.', center: [51.2, 10.4], zoom: 5 },
  'Bosnia and Herz.': { zone: 'follow_turkey_diyanet', authority: 'Islamic Community in Bosnia & Herzegovina', rule: 'Follows Turkey Diyanet / ECFR global calculation.', center: [43.9, 17.7], zoom: 7 },
  'Croatia': { zone: 'follow_turkey_diyanet', authority: 'Mesihat of Croatia', rule: 'Follows Turkey Diyanet global calculation.', center: [45.1, 15.2], zoom: 6 },
  'Kosovo': { zone: 'follow_turkey_diyanet', authority: 'Islamic Community of Kosovo', rule: 'Follows Turkey Diyanet global calculation.', center: [42.6, 20.9], zoom: 8 },
  'Macedonia': { zone: 'follow_turkey_diyanet', authority: 'Islamic Religious Community', rule: 'Follows Turkey Diyanet global calculation.', center: [41.6, 21.7], zoom: 7 },
  'Montenegro': { zone: 'follow_turkey_diyanet', authority: 'Islamic Community of Montenegro', rule: 'Follows Turkey Diyanet global calculation.', center: [42.7, 19.4], zoom: 7 },
  'Serbia': { zone: 'follow_turkey_diyanet', authority: 'Islamic Community of Serbia', rule: 'Follows Turkey Diyanet global calculation.', center: [44.0, 21.0], zoom: 6 },
  'Slovenia': { zone: 'follow_turkey_diyanet', authority: 'Islamic Community in Slovenia', rule: 'Follows Turkey Diyanet global calculation.', center: [46.1, 14.9], zoom: 7 },
  'Luxembourg': { zone: 'follow_turkey_diyanet', authority: 'Shoura Luxembourg', rule: 'Follows ECFR / Turkey calculation.', center: [49.8, 6.1], zoom: 8 },
  'Ireland': { zone: 'follow_turkey_diyanet', authority: 'ICCI / ECFR', rule: 'ECFR global calculation (with local-sighting minority).', center: [53.4, -8.2], zoom: 6 },
  'Angola': { zone: 'follow_turkey_diyanet', authority: 'Angolan Islamic Community', rule: 'Follows Turkey / ECFR calculation per MCW listing.', center: [-11.2, 17.9], zoom: 5 },

  // Regional / National Astronomical Criteria
  'Indonesia': { zone: 'regional_criteria', authority: 'Kementerian Agama (MABIMS Neo-Criterion)', rule: 'MABIMS criterion: sunset moon altitude ≥ 3° & elongation ≥ 6.4° plus physical sighting.', center: [-2.5, 118.0], zoom: 4 },
  'Malaysia': { zone: 'regional_criteria', authority: 'JAKIM (MABIMS Neo-Criterion)', rule: 'MABIMS criterion: sunset moon altitude ≥ 3° & elongation ≥ 6.4° plus rukyah.', center: [4.2, 101.9], zoom: 5 },
  'Brunei': { zone: 'regional_criteria', authority: 'MORA Brunei (MABIMS)', rule: 'MABIMS criterion: 3° altitude & 6.4° elongation + local sighting.', center: [4.5, 114.7], zoom: 7 },
  'Egypt': { zone: 'regional_criteria', authority: 'Dar al-Ifta al-Misriyyah', rule: 'Conjunction before sunset & moonset ≥ 5 minutes after sunset, corroborated by observation posts.', center: [26.8, 30.8], zoom: 5 },
  'Algeria': { zone: 'regional_criteria', authority: 'Ministry of Religious Affairs', rule: 'National committee combining local sighting & astronomical feasibility.', center: [28.0, 1.7], zoom: 5 },
  'Tunisia': { zone: 'regional_criteria', authority: 'Mufti of the Republic', rule: 'National astronomical lag/age criteria + observation.', center: [33.9, 9.5], zoom: 6 },
  'Libya': { zone: 'regional_criteria', authority: 'Dar al-Ifta Libya', rule: 'Official national sighting & visibility criterion.', center: [26.3, 17.2], zoom: 5 },
  'Thailand': { zone: 'regional_criteria', authority: 'Chularatchamontri (Sheikhul Islam)', rule: 'Official national sighting announcement.', center: [15.8, 100.9], zoom: 5 },
  'China': { zone: 'regional_criteria', authority: 'Islamic Association of China', rule: 'Local sighting or regional Malaysian/East Asian alignment.', center: [35.8, 104.2], zoom: 4 },

  // Split Communities
  'United Kingdom': { zone: 'split_communities', authority: 'Wifaqul Ulama / New Crescent Society vs Saudi Followers', rule: 'Split: UK/Morocco local-sighting mosques vs Saudi-following mosques (often 1 day apart).', center: [53.5, -2.0], zoom: 5 },
  'United States of America': { zone: 'split_communities', authority: 'FCNA/ISNA (ECFR) vs Chicago/Central Hilal', rule: 'Split: ISNA/FCNA uses global 5°/8° calculation; Hilal committees require North American sighting.', center: [38.5, -96.0], zoom: 4 },
  'Canada': { zone: 'split_communities', authority: 'ISNA Canada vs Toronto Hilal Committee', rule: 'Split: ISNA follows global calculation; Toronto Hilal Committee requires local/regional sighting.', center: [56.1, -106.3], zoom: 3 },
  'France': { zone: 'split_communities', authority: 'CFCM (Calculation) vs GMP (Sighting)', rule: 'Split: CFCM uses 5°/8° calculation; Grand Mosque of Paris uses sighting.', center: [46.2, 2.2], zoom: 5 },
  'Spain': { zone: 'split_communities', authority: 'CIE / UCIDE', rule: 'Mixed local/Moroccan sighting and European calculation.', center: [40.4, -3.7], zoom: 5 },
  'Norway': { zone: 'split_communities', authority: 'Islamic Council Norway', rule: 'Mixed local/European/Muslim-country announcements.', center: [60.5, 8.5], zoom: 4 },
  'Poland': { zone: 'split_communities', authority: 'Muslim Religious Union', rule: 'Calculation / European coordination.', center: [51.9, 19.1], zoom: 5 },
};

function main() {
  const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'world-atlas', 'countries-110m.json'), 'utf8'));
  const geoms = topo.objects.countries.geometries;
  const countries = [];

  for (const g of geoms) {
    const name = g.properties?.name;
    const iso = g.id ? String(g.id) : null;
    if (!name || !iso || name === 'Antarctica') continue;
    const ov = COUNTRY_OVERRIDES[name];
    if (!ov) continue;
    const zmeta = ZONE_META[ov.zone];
    countries.push({
      iso,
      name,
      zone: ov.zone,
      zone_label: zmeta.label,
      color: zmeta.color,
      authority: ov.authority,
      rule_summary: ov.rule || zmeta.defaultRule,
      center: ov.center,
      zoom: ov.zoom || 5,
      follows_hub: ov.hub || zmeta.hub || null,
    });
  }

  fs.writeFileSync(
    path.join(SRC_DATA, 'jurisdictions_map.json'),
    JSON.stringify({ zones: ZONE_META, countries }, null, 2)
  );
  console.log(`Saved ${countries.length} mapped countries -> src/data/jurisdictions_map.json`);

  // Build cities & South African stations gazetteer
  const saSites = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sa_observation_sites.json'), 'utf8'));
  const saEntries = saSites.map((s) => ({
    name: s.name,
    city: s.city,
    country: 'South Africa',
    iso: '710',
    province: s.province,
    lat: s.lat,
    lon: s.lon,
    elevation_m: s.elevation_m || 0,
    organization: s.organization,
    source: s.source,
    notes: s.notes,
    is_sa_station: true,
    zone: 'local_sighting',
  }));

  const worldCities = [
    // Major SA cities (ensure plain city names also match directly in search!)
    { name: 'Cape Town', country: 'South Africa', iso: '710', lat: -33.9249, lon: 18.4241, elevation_m: 25 },
    { name: 'Johannesburg', country: 'South Africa', iso: '710', lat: -26.2041, lon: 28.0473, elevation_m: 1753 },
    { name: 'Pretoria', country: 'South Africa', iso: '710', lat: -25.7479, lon: 28.2293, elevation_m: 1339 },
    { name: 'Durban', country: 'South Africa', iso: '710', lat: -29.8587, lon: 31.0218, elevation_m: 20 },
    { name: 'Gqeberha (Port Elizabeth)', country: 'South Africa', iso: '710', lat: -33.9608, lon: 25.6022, elevation_m: 60 },
    { name: 'Polokwane', country: 'South Africa', iso: '710', lat: -23.9045, lon: 29.4689, elevation_m: 1312 },
    { name: 'Bloemfontein', country: 'South Africa', iso: '710', lat: -29.0852, lon: 26.1596, elevation_m: 1395 },
    { name: 'Kimberley', country: 'South Africa', iso: '710', lat: -28.7282, lon: 24.7499, elevation_m: 1197 },
    { name: 'Beaufort West', country: 'South Africa', iso: '710', lat: -32.3567, lon: 22.5830, elevation_m: 850 },
    { name: 'Pietermaritzburg', country: 'South Africa', iso: '710', lat: -29.6006, lon: 30.3794, elevation_m: 600 },
    // Southern Africa neighbors
    { name: 'Windhoek', country: 'Namibia', iso: '516', lat: -22.5609, lon: 17.0658, elevation_m: 1655 },
    { name: 'Gaborone', country: 'Botswana', iso: '072', lat: -24.6282, lon: 25.9231, elevation_m: 1014 },
    { name: 'Harare', country: 'Zimbabwe', iso: '716', lat: -17.8252, lon: 31.0335, elevation_m: 1490 },
    { name: 'Lusaka', country: 'Zambia', iso: '894', lat: -15.3875, lon: 28.3228, elevation_m: 1277 },
    { name: 'Maputo', country: 'Mozambique', iso: '508', lat: -25.9692, lon: 32.5732, elevation_m: 47 },
    { name: 'Maseru', country: 'Lesotho', iso: '426', lat: -29.3167, lon: 27.4833, elevation_m: 1600 },
    { name: 'Mbabane', country: 'eSwatini', iso: '748', lat: -26.3054, lon: 31.1367, elevation_m: 1243 },
    { name: 'Lilongwe', country: 'Malawi', iso: '454', lat: -13.9626, lon: 33.7741, elevation_m: 1050 },
    // Rest of Africa
    { name: 'Nairobi', country: 'Kenya', iso: '404', lat: -1.2921, lon: 36.8219, elevation_m: 1795 },
    { name: 'Mombasa', country: 'Kenya', iso: '404', lat: -4.0435, lon: 39.6682, elevation_m: 17 },
    { name: 'Dar es Salaam', country: 'Tanzania', iso: '834', lat: -6.7924, lon: 39.2083, elevation_m: 14 },
    { name: 'Zanzibar', country: 'Tanzania', iso: '834', lat: -6.1659, lon: 39.2026, elevation_m: 12 },
    { name: 'Kampala', country: 'Uganda', iso: '800', lat: 0.3476, lon: 32.5825, elevation_m: 1190 },
    { name: 'Mogadishu', country: 'Somalia', iso: '706', lat: 2.0469, lon: 45.3182, elevation_m: 9 },
    { name: 'Khartoum', country: 'Sudan', iso: '729', lat: 15.5007, lon: 32.5599, elevation_m: 382 },
    { name: 'Cairo', country: 'Egypt', iso: '818', lat: 30.0444, lon: 31.2357, elevation_m: 23 },
    { name: 'Alexandria', country: 'Egypt', iso: '818', lat: 31.2001, lon: 29.9187, elevation_m: 7 },
    { name: 'Tripoli', country: 'Libya', iso: '434', lat: 32.8872, lon: 13.1913, elevation_m: 10 },
    { name: 'Tunis', country: 'Tunisia', iso: '788', lat: 36.8065, lon: 10.1815, elevation_m: 4 },
    { name: 'Algiers', country: 'Algeria', iso: '012', lat: 36.7538, lon: 3.0588, elevation_m: 50 },
    { name: 'Rabat', country: 'Morocco', iso: '504', lat: 34.0209, lon: -6.8416, elevation_m: 50 },
    { name: 'Casablanca', country: 'Morocco', iso: '504', lat: 33.5731, lon: -7.5898, elevation_m: 27 },
    { name: 'Marrakesh', country: 'Morocco', iso: '504', lat: 31.6295, lon: -7.9811, elevation_m: 466 },
    { name: 'Dakar', country: 'Senegal', iso: '686', lat: 14.7167, lon: -17.4677, elevation_m: 22 },
    { name: 'Abuja', country: 'Nigeria', iso: '566', lat: 9.0765, lon: 7.3986, elevation_m: 476 },
    { name: 'Sokoto', country: 'Nigeria', iso: '566', lat: 13.0059, lon: 5.2476, elevation_m: 300 },
    { name: 'Lagos', country: 'Nigeria', iso: '566', lat: 6.5244, lon: 3.3792, elevation_m: 11 },
    { name: 'Accra', country: 'Ghana', iso: '288', lat: 5.6037, lon: -0.1870, elevation_m: 61 },
    // Middle East
    { name: 'Makkah', country: 'Saudi Arabia', iso: '682', lat: 21.4225, lon: 39.8262, elevation_m: 277 },
    { name: 'Madinah', country: 'Saudi Arabia', iso: '682', lat: 24.5247, lon: 39.5692, elevation_m: 608 },
    { name: 'Riyadh', country: 'Saudi Arabia', iso: '682', lat: 24.7136, lon: 46.6753, elevation_m: 612 },
    { name: 'Jeddah', country: 'Saudi Arabia', iso: '682', lat: 21.4858, lon: 39.1925, elevation_m: 12 },
    { name: 'Dubai', country: 'United Arab Emirates', iso: '784', lat: 25.2048, lon: 55.2708, elevation_m: 5 },
    { name: 'Abu Dhabi', country: 'United Arab Emirates', iso: '784', lat: 24.4539, lon: 54.3773, elevation_m: 10 },
    { name: 'Doha', country: 'Qatar', iso: '634', lat: 25.2854, lon: 51.5310, elevation_m: 10 },
    { name: 'Kuwait City', country: 'Kuwait', iso: '414', lat: 29.3759, lon: 47.9774, elevation_m: 16 },
    { name: 'Muscat', country: 'Oman', iso: '512', lat: 23.5880, lon: 58.3829, elevation_m: 20 },
    { name: 'Amman', country: 'Jordan', iso: '400', lat: 31.9454, lon: 35.9284, elevation_m: 850 },
    { name: 'Jerusalem', country: 'Palestine', iso: '275', lat: 31.7683, lon: 35.2137, elevation_m: 754 },
    { name: 'Beirut', country: 'Lebanon', iso: '422', lat: 33.8938, lon: 35.5018, elevation_m: 30 },
    { name: 'Damascus', country: 'Syria', iso: '760', lat: 33.5138, lon: 36.2765, elevation_m: 690 },
    { name: 'Baghdad', country: 'Iraq', iso: '368', lat: 33.3152, lon: 44.3661, elevation_m: 34 },
    { name: 'Tehran', country: 'Iran', iso: '364', lat: 35.6892, lon: 51.3890, elevation_m: 1190 },
    { name: 'Sanaa', country: 'Yemen', iso: '887', lat: 15.3694, lon: 44.1910, elevation_m: 2250 },
    // Europe & Turkey
    { name: 'Istanbul', country: 'Turkey', iso: '792', lat: 41.0082, lon: 28.9784, elevation_m: 40 },
    { name: 'Ankara', country: 'Turkey', iso: '792', lat: 39.9334, lon: 32.8597, elevation_m: 938 },
    { name: 'London', country: 'United Kingdom', iso: '826', lat: 51.5072, lon: -0.1276, elevation_m: 20 },
    { name: 'Birmingham', country: 'United Kingdom', iso: '826', lat: 52.4862, lon: -1.8904, elevation_m: 140 },
    { name: 'Bradford', country: 'United Kingdom', iso: '826', lat: 53.7960, lon: -1.7594, elevation_m: 150 },
    { name: 'Paris', country: 'France', iso: '250', lat: 48.8566, lon: 2.3522, elevation_m: 35 },
    { name: 'Berlin', country: 'Germany', iso: '276', lat: 52.5200, lon: 13.4050, elevation_m: 34 },
    { name: 'Frankfurt', country: 'Germany', iso: '276', lat: 50.1109, lon: 8.6821, elevation_m: 112 },
    { name: 'Amsterdam', country: 'Netherlands', iso: '528', lat: 52.3676, lon: 4.9041, elevation_m: 2 },
    { name: 'Brussels', country: 'Belgium', iso: '056', lat: 50.8503, lon: 4.3517, elevation_m: 13 },
    { name: 'Madrid', country: 'Spain', iso: '724', lat: 40.4168, lon: -3.7038, elevation_m: 650 },
    { name: 'Sarajevo', country: 'Bosnia and Herz.', iso: '070', lat: 43.8563, lon: 18.4131, elevation_m: 518 },
    { name: 'Tirana', country: 'Albania', iso: '008', lat: 41.3275, lon: 19.8187, elevation_m: 110 },
    { name: 'Dublin', country: 'Ireland', iso: '372', lat: 53.3498, lon: -6.2603, elevation_m: 20 },
    { name: 'Stockholm', country: 'Sweden', iso: '752', lat: 59.3293, lon: 18.0686, elevation_m: 15 },
    { name: 'Oslo', country: 'Norway', iso: '578', lat: 59.9139, lon: 10.7522, elevation_m: 23 },
    { name: 'Moscow', country: 'Russia', iso: '643', lat: 55.7558, lon: 37.6173, elevation_m: 156 },
    // South & SE Asia
    { name: 'Karachi', country: 'Pakistan', iso: '586', lat: 24.8607, lon: 67.0011, elevation_m: 8 },
    { name: 'Lahore', country: 'Pakistan', iso: '586', lat: 31.5204, lon: 74.3587, elevation_m: 217 },
    { name: 'Islamabad', country: 'Pakistan', iso: '586', lat: 33.6844, lon: 73.0479, elevation_m: 540 },
    { name: 'New Delhi', country: 'India', iso: '356', lat: 28.6139, lon: 77.2090, elevation_m: 216 },
    { name: 'Mumbai', country: 'India', iso: '356', lat: 19.0760, lon: 72.8777, elevation_m: 14 },
    { name: 'Hyderabad', country: 'India', iso: '356', lat: 17.3850, lon: 78.4867, elevation_m: 542 },
    { name: 'Dhaka', country: 'Bangladesh', iso: '050', lat: 23.8103, lon: 90.4125, elevation_m: 10 },
    { name: 'Colombo', country: 'Sri Lanka', iso: '144', lat: 6.9271, lon: 79.8612, elevation_m: 5 },
    { name: 'Kabul', country: 'Afghanistan', iso: '004', lat: 34.5553, lon: 69.2075, elevation_m: 1791 },
    { name: 'Jakarta', country: 'Indonesia', iso: '360', lat: -6.2088, lon: 106.8456, elevation_m: 8 },
    { name: 'Kuala Lumpur', country: 'Malaysia', iso: '458', lat: 3.1390, lon: 101.6869, elevation_m: 22 },
    { name: 'Bandar Seri Begawan', country: 'Brunei', iso: '096', lat: 4.9031, lon: 114.9398, elevation_m: 10 },
    { name: 'Bangkok', country: 'Thailand', iso: '764', lat: 13.7563, lon: 100.5018, elevation_m: 5 },
    // Americas & Oceania
    { name: 'New York', country: 'United States of America', iso: '840', lat: 40.7128, lon: -74.0060, elevation_m: 10 },
    { name: 'Chicago', country: 'United States of America', iso: '840', lat: 41.8781, lon: -87.6298, elevation_m: 180 },
    { name: 'Houston', country: 'United States of America', iso: '840', lat: 29.7604, lon: -95.3698, elevation_m: 15 },
    { name: 'Los Angeles', country: 'United States of America', iso: '840', lat: 34.0522, lon: -118.2437, elevation_m: 89 },
    { name: 'Toronto', country: 'Canada', iso: '124', lat: 43.6532, lon: -79.3832, elevation_m: 76 },
    { name: 'Ottawa', country: 'Canada', iso: '124', lat: 45.4215, lon: -75.6972, elevation_m: 70 },
    { name: 'Santiago', country: 'Chile', iso: '152', lat: -33.4489, lon: -70.6693, elevation_m: 570 },
    { name: 'Bogota', country: 'Colombia', iso: '170', lat: 4.7110, lon: -74.0721, elevation_m: 2640 },
    { name: 'Sydney', country: 'Australia', iso: '036', lat: -33.8688, lon: 151.2093, elevation_m: 19 },
    { name: 'Melbourne', country: 'Australia', iso: '036', lat: -37.8136, lon: 144.9631, elevation_m: 31 },
    { name: 'Perth', country: 'Australia', iso: '036', lat: -31.9505, lon: 115.8605, elevation_m: 20 },
    { name: 'Auckland', country: 'New Zealand', iso: '554', lat: -36.8485, lon: 174.7633, elevation_m: 26 },
  ];

  const zoneByIso = new Map(countries.map((c) => [c.iso, c.zone]));
  const citiesOut = [
    ...saEntries,
    ...worldCities.map((c) => ({
      ...c,
      city: c.name,
      is_sa_station: false,
      zone: zoneByIso.get(c.iso) || 'local_sighting',
    })),
  ];

  fs.writeFileSync(path.join(SRC_DATA, 'cities.json'), JSON.stringify(citiesOut, null, 2));
  fs.writeFileSync(path.join(SRC_DATA, 'sa_stations.json'), JSON.stringify(saSites, null, 2));

  const hwRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hilalwatch_sa_reports.json'), 'utf8'));
  fs.writeFileSync(
    path.join(SRC_DATA, 'sa_reports.json'),
    JSON.stringify(hwRaw.sa_reports || [], null, 2)
  );

  console.log(`Saved ${citiesOut.length} cities/stations -> src/data/cities.json`);
}

main();
