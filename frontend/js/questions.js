/**
 * AQUA SAR — question bank for the chat assistant.
 *
 * ONE file, one bank: [{ id, question, keywords, answer(data), display, followUps }].
 * Today the answers are templates filled from getLakeData(). Later the same bank can serve as the cached
 * fallback answers for the LLM backend.
 *
 *   id        'Q02' …
 *   question  text shown on chips / sent by a chip click
 *   keywords  lowercase words used to match free text (section 7 of the spec)
 *   answer(d) -> { text, sources?: [{ source, url }] }   d = getLakeData() result
 *   display   what the Results panel shows: chart_trend | chart_core | table_years | table_core | table_sensors | none
 *   followUps two question ids
 *
 * Rules: no number is typed into a template. Every figure comes from `d` (via derive()) or from the text
 * of d.about_the_data. Never subtract NISAR from Sentinel-1 to describe change. Say "now mapped as".
 * Radar shows what changed, not why.
 */
import { derive } from './lakeData.js';

/* ------------------------------------------------------------- formatting */

const f1 = (x) => Number(x).toFixed(1);
const decimals = (x) => (String(x).split('.')[1] || '').length;
/** Keep the precision the JSON uses (at least one decimal): -2.71 -> "-2.71", -2 -> "-2.0". */
const num = (x) => Number(x).toFixed(Math.max(1, decimals(x)));
const abs = Math.abs;
const match = (re, str) => (str.match(re) || [])[1];

const fact = (d, id) => d.context_facts.find((f) => f.id === id);
const sourcesOf = (d, ids) => {
  const seen = new Set();
  return ids
    .map((id) => fact(d, id))
    .filter((f) => f && !seen.has(f.url) && seen.add(f.url))
    .map((f) => ({ source: f.source, url: f.url }));
};
const factText = (d, ids) => ids.map((id) => fact(d, id).text).join(' ');

/** Accuracy figures are read from the sentences in about_the_data, never typed here. */
function accuracy(d) {
  const a = d.about_the_data;
  return {
    s1Water: match(/about (\d+)% accurate for water/, a.sentinel1),
    s1Four: match(/about (\d+)% across four classes/, a.sentinel1),
    jrcMap: match(/About (\d+)% of what we map/, a.jrc_agreement),
    jrcRecover: match(/recover about (\d+)%/, a.jrc_agreement),
    f1: Number(match(/F1 ([\d.]+)/, a.nisar)).toFixed(2),
    four: Number(match(/accuracy ([\d.]+)/, a.nisar)).toFixed(2),
  };
}

/* ------------------------------------------------------------------- bank */

export const QUESTIONS = [
  {
    id: 'Q02',
    question: 'How much water has the lake lost since 2019?',
    keywords: ['lost', 'loss', 'shrunk', 'shrink since', 'how much water'],
    display: 'chart_trend',
    followUps: ['Q03', 'Q06'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `Inside our ${v.studyArea} km² study area, the water surface (open water plus fish ponds) went from ${f1(v.w2019)} km² in ${v.min} to ${f1(v.w2026)} km² in ${v.max} (Sentinel-1): ` +
          `a loss of ${f1(abs(v.loss))} km², or ${f1(abs(v.lossPct))}%. The trend is about ${num(v.slope)} km² a year, with a likely range of ${num(v.slopeLo)} to ${num(v.slopeHi)}. ` +
          `Most of the drop (${f1(v.dropTo2023)} km²) happened between ${v.min} and 2023; the last three years look roughly flat.`,
      };
    },
  },
  {
    id: 'Q03',
    question: 'Is the lake still shrinking?',
    keywords: ['still shrinking', 'now', 'recent', 'continue'],
    display: 'chart_core',
    followUps: ['Q04', 'Q05'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `It depends where you look. Across the whole study area water is roughly flat since 2023 (${f1(v.w2023)} to ${f1(v.w2026)} km²). ` +
          `But the lake's permanent core keeps losing open water: ${f1(v.c2023)} to ${f1(v.c2026)} km² over the same years, about ${num(v.cSlope)} km² a year since ${v.min} ` +
          `(range ${num(v.cSlopeLo)} to ${num(v.cSlopeHi)}, which does not include zero). Water outside the core rose slightly after 2023, which hides part of the core's loss. We have not tested why.`,
      };
    },
  },
  {
    id: 'Q04',
    question: 'What do you mean by the lake core?',
    keywords: ['core', 'heart'],
    display: 'none',
    followUps: ['Q05', 'Q06'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `The core is the heart of the lake: ${f1(v.cArea)} km² that an independent Landsat dataset (JRC) maps as permanent water in 2019, 2020 and 2021 alike. ` +
          'It is a fixed area, so any change inside it is a real change, not a moving border. We use it because the edges of the lake, with fish ponds, shallow water and fields, change a lot from year to year.',
      };
    },
  },
  {
    id: 'Q05',
    question: 'How much of the lake core is still open water?',
    keywords: ['core open water', 'still water'],
    display: 'chart_core',
    followUps: ['Q06', 'Q10'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `In ${v.max} Sentinel-1 maps ${f1(v.c2026)} km² of the core as water (${f1(v.c2026Pct)}%), down from ${f1(v.c2019)} km² (${f1(v.c2019Pct)}%) in ${v.min}. ` +
          `NISAR, a second and independent satellite, gives ${f1(v.nCore)} km² (${f1(v.nCorePct)}%) for ${v.max}, within ${f1(v.coreGap)} km² of Sentinel-1. Water here means open water plus fish ponds.`,
      };
    },
  },
  {
    id: 'Q06',
    question: 'Where did the lost water go?',
    keywords: ['where did', 'went', 'replaced'],
    display: 'table_core',
    followUps: ['Q07', 'Q18'],
    answer: (d) => {
      const v = derive(d);
      const share = v.cVegGain / v.vegGain;
      const shareText = abs(share - 1 / 3) < 0.05 ? 'about a third' : `about ${Math.round(share * 100)}%`;
      return {
        text:
          `Inside the core, ${f1(abs(v.cLoss))} km² are no longer mapped as water since ${v.min}: ${f1(v.cVegGain)} km² are now mapped as vegetation and ${f1(v.cLandGain)} km² as land. ` +
          `Across the whole study area vegetation grew by ${f1(v.vegGain)} km² while water shrank, but only ${shareText} of that vegetation growth is over the core. Radar shows what changed, not why.`,
      };
    },
  },
  {
    id: 'Q07',
    question: 'How much vegetation is growing over the water?',
    keywords: ['vegetation', 'plants', 'growing', 'reeds'],
    display: 'table_core',
    followUps: ['Q12', 'Q10'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `Sentinel-1 maps ${f1(v.cVeg2026)} km² of vegetation inside the lake core in ${v.max}, up from ${f1(v.cVeg2019)} km² in ${v.min}. ` +
          `This counts dense vegetation only, so treat it as a minimum: a Sentinel-2 greenness check on a similar area gives larger numbers (${f1(v.s2First)} km² in ${v.s2FirstYear} to ${f1(v.s2Last)} km² in ${v.s2LastYear}). ` +
          `As a cross-check, ${v.greenPct}% of the Sentinel-1 core vegetation is also green in Sentinel-2 (October ${v.max}). We cannot name the plant species.`,
      };
    },
  },
  {
    id: 'Q08',
    question: 'What is NISAR?',
    keywords: ['nisar', 'what is nisar'],
    display: 'none',
    followUps: ['Q09', 'Q10'],
    answer: () => ({
      text:
        "NISAR is a NASA–ISRO radar satellite. Its L-band radar has a longer wavelength than Sentinel-1's C-band. Its calibrated data started releasing in July 2026 (observations from June 17, 2026), so there is no NISAR history before that. " +
        'We use scenes from June to October 2026 as our featured recent layer. The data is still provisional.',
    }),
  },
  {
    id: 'Q09',
    question: 'Why do you use two satellites?',
    keywords: ['two satellites', 'why both'],
    display: 'none',
    followUps: ['Q10', 'Q11'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `Sentinel-1 (C-band) has an archive going back years, so it gives us the ${v.min}–${v.max} history and the trend. NISAR (L-band) is new, so it gives an independent view of ${v.max}. ` +
          'Because they are different sensors, we compare them side by side but never subtract one from the other to claim change.',
      };
    },
  },
  {
    id: 'Q10',
    question: 'Compare 2026: NISAR vs Sentinel-1',
    keywords: ['compare', 'nisar vs', 'versus sentinel', '2026'],
    display: 'table_sensors',
    followUps: ['Q11', 'Q12'],
    answer: (d) => {
      const v = derive(d);
      const core = v.sensor('Water, lake core');
      const study = v.sensor('Water, whole study area');
      return {
        text:
          `For ${v.max} the two satellites agree where the lake is open water and differ at the edges. Inside the lake core Sentinel-1 gives ${f1(core.sentinel1_km2)} km² of water and NISAR ${f1(core.nisar_km2)} km², ` +
          `a gap of ${f1(v.coreGap)} km² (${f1(v.coreGapPct)}% of the core). Across the whole study area NISAR gives ${f1(study.nisar_km2)} km² against ${f1(study.sentinel1_km2)} km² for Sentinel-1; that gap comes from outside the core. ` +
          'They also split the non-water part differently (see the table). This is two sensors seeing the same lake differently, not a change over time.',
      };
    },
  },
  {
    id: 'Q11',
    question: 'Which satellite should I trust?',
    keywords: ['trust', 'which satellite', 'better'],
    display: 'none',
    followUps: ['Q13', 'Q14'],
    answer: (d) => {
      const v = derive(d);
      const a = accuracy(d);
      return {
        text:
          `Each has a role. Sentinel-1 gives the long record, and about ${a.jrcMap}% of what we map as water with it is also water in an independent Landsat dataset. ` +
          `NISAR is new and provisional, with one season of data; its water map scores ${a.f1} on F1 when water and fish ponds are merged. ` +
          `Where both can be checked, in the lake core, they agree within ${f1(v.coreGap)} km². We use Sentinel-1 for trends and NISAR as the ${v.max} cross-check.`,
      };
    },
  },
  {
    id: 'Q12',
    question: 'Why do the satellites disagree on vegetation?',
    keywords: ['disagree', 'differ', 'vegetation nisar'],
    display: 'table_sensors',
    followUps: ['Q07', 'Q11'],
    answer: (d) => {
      const v = derive(d);
      const veg = v.sensor('Vegetation, whole study area');
      return {
        text:
          `In ${v.max} Sentinel-1 maps ${f1(veg.sentinel1_km2)} km² of vegetation and NISAR ${f1(veg.nisar_km2)} km². Inside the core the gap is bigger: NISAR maps more of the non-water part as land (${f1(v.nCoreLand)} km²) than as vegetation (${f1(v.nCoreVeg)} km²). ` +
          `L-band and C-band react differently to plants, but we have not tested which one is closer to the truth. A Sentinel-2 check supports the Sentinel-1 number: ${v.greenPct}% of its core vegetation is green.`,
      };
    },
  },
  {
    id: 'Q13',
    question: 'How accurate is the map?',
    keywords: ['accurate', 'accuracy', 'reliable', 'validation'],
    display: 'none',
    followUps: ['Q15', 'Q16'],
    answer: (d) => {
      const a = accuracy(d);
      return {
        text:
          `Sentinel-1: about ${a.s1Water}% accurate for water versus non-water and about ${a.s1Four}% across four classes (tested on areas the model never saw). ` +
          `We also checked it against an independent Landsat dataset: about ${a.jrcMap}% of what we map as water is water there too, and we recover about ${a.jrcRecover}% of its permanent water. That is agreement, not ground truth. ` +
          `NISAR: F1 ${a.f1} for water (open water and fish ponds merged), ${a.four} accuracy across four classes, provisional data. We have no field measurements.`,
      };
    },
  },
  {
    id: 'Q14',
    question: 'Can you forecast the future?',
    keywords: ['forecast', 'predict', 'future', '2030'],
    display: 'chart_trend',
    followUps: ['Q03', 'Q06'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `We show a trend, not a prediction. Over ${v.min}–${v.max} the trend is ${num(v.slope)} km² a year (range ${num(v.slopeLo)} to ${num(v.slopeHi)}). ` +
          `When we tested it by training on ${d.trend_sentinel1_2019_2026.backtest.trained_on} and checking ${v.max - 1}–${v.max}, it overshot the decline by about ${f1(v.overshoot)} km², because the loss slowed after 2023. ` +
          `So we do not publish a number for future years. The core's trend (${num(v.cSlope)} km² a year) has been steadier.`,
      };
    },
  },
  {
    id: 'Q15',
    question: 'What does satellite radar actually see?',
    keywords: ['radar', 'sar', 'how does'],
    display: 'none',
    followUps: ['Q08', 'Q13'],
    answer: () => ({
      text:
        'Radar sends its own microwave pulses and measures what bounces back, so it works through clouds and at night. Calm open water reflects the signal away, so it looks dark. Plants and land scatter it back, so they look brighter. ' +
        'We turn those brightness patterns into maps of water, vegetation and land. Radar shows what changed on the surface, not why.',
    }),
  },
  {
    id: 'Q16',
    question: 'How did you build this?',
    keywords: ['how built', 'how did you', 'method', 'ai'],
    display: 'none',
    followUps: ['Q13', 'Q17'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `Four steps: (1) yearly Sentinel-1 radar composites and NISAR scenes from ${v.max}; (2) a Random Forest model, trained on points we labelled by hand, classifies water, vegetation and land; ` +
          '(3) we add up the area of each class per year; (4) a Theil-Sen trend with a range summarises the change. Every number you see comes from this pipeline. The AI assistant only explains those numbers. AI use is disclosed, as NASA requires.',
      };
    },
  },
  {
    id: 'Q17',
    question: 'What area do you cover?',
    keywords: ['area', 'study area', 'sea'],
    display: 'none',
    followUps: ['Q04', 'Q02'],
    answer: (d) => {
      const v = derive(d);
      return {
        text:
          `The study area is ${f1(v.studyArea)} km²: the lake plus a buffer around it, with the Mediterranean strip north of the sand bar removed (${f1(v.seaStrip)} km²), because sea water would otherwise be counted as lake water. ` +
          'That strip does not change over time, so removing it shifts the totals but not the trends.',
      };
    },
  },
  {
    id: 'Q18',
    question: 'Why is the lake shrinking?',
    keywords: ['why', 'cause'],
    display: 'none',
    followUps: ['Q19', 'Q20'],
    answer: (d) => ({
      text:
        'Radar can show what changed, not why. Published studies point to farmland and fish farms expanding, mostly in the west and south, nutrient-rich farm drainage, and lower salinity with reed spread. ' +
        'These are context from research, not measurements from our maps.',
      sources: sourcesOf(d, ['drainage', 'marsh', 'salinity_reeds']),
    }),
  },
  {
    id: 'Q19',
    question: 'Salinity and fish farms?',
    keywords: ['salinity', 'fish farm', 'fish pond'],
    display: 'none',
    followUps: ['Q21', 'Q20'],
    answer: (d) => ({
      text:
        'Radar cannot measure salinity, soil or fish catch. From published research: salinity falls toward the south and west of the lake, and fishermen link lower salinity and reed expansion to fewer fishing opportunities. ' +
        'Fish farms have also expanded around the lake. In our numbers open water and fish ponds are combined, because separating them reliably from radar was not possible.',
      sources: sourcesOf(d, ['salinity_reeds', 'change_1984_2019']),
    }),
  },
  {
    id: 'Q20',
    question: 'How has the lake changed over the long term?',
    keywords: ['history', 'long term', 'decades', '1972'],
    display: 'none',
    followUps: ['Q18', 'Q02'],
    answer: (d) => {
      const v = derive(d);
      const ids = ['area_1913', 'water_1972_2006', 'change_1984_2019'];
      return {
        text: `${factText(d, ids)} Those studies use other methods, classes and periods, so their numbers are not comparable with ours. Our record covers ${v.min}–${v.max}.`,
        sources: sourcesOf(d, ids),
      };
    },
  },
  {
    id: 'Q21',
    question: 'Why does Burullus matter for fishing?',
    keywords: ['fishing', 'fishermen', 'catch'],
    display: 'none',
    followUps: ['Q19', 'Q22'],
    answer: (d) => {
      const ids = ['fishing_share', 'fishermen', 'overfishing'];
      return {
        text: `${factText(d, ids)} Radar does not measure catch, so we do not link our water numbers to fish production.`,
        sources: sourcesOf(d, ids),
      };
    },
  },
  {
    id: 'Q22',
    question: 'Does farming affect the lake?',
    keywords: ['farm', 'rice', 'agriculture'],
    display: 'none',
    followUps: ['Q18', 'Q19'],
    answer: (d) => {
      const ids = ['rice', 'drainage', 'marsh'];
      return {
        text: `${factText(d, ids)} Our map does not separate farmland from other dry land.`,
        sources: sourcesOf(d, ids),
      };
    },
  },
  {
    id: 'Q23',
    question: 'Which year had the biggest drop?',
    keywords: ['biggest', 'worst year'],
    display: 'table_years',
    followUps: ['Q02', 'Q14'],
    answer: (d) => {
      const worst = d.years.filter((y) => y.water_change_yoy_km2 !== null).reduce((a, b) => (b.water_change_yoy_km2 < a.water_change_yoy_km2 ? b : a));
      return {
        text: `${worst.year} had the biggest yearly drop: ${f1(abs(worst.water_change_yoy_km2))} km² (${f1(abs(worst.water_change_yoy_pct))}%) compared with the year before. ${d.about_the_data.scene_note}`,
      };
    },
  },
  {
    id: 'Q24',
    question: 'Show me the table of all years',
    keywords: ['table', 'all years'],
    display: 'table_years',
    followUps: ['Q02', 'Q10'],
    answer: () => ({
      text: 'Here is the water area for every year. 2026 has two rows, one per satellite, and they are not directly comparable.',
    }),
  },
  {
    id: 'Q25',
    question: 'Plot the trend',
    keywords: ['plot', 'chart', 'trend'],
    display: 'chart_trend',
    followUps: ['Q14', 'Q03'],
    answer: (d) => {
      const v = derive(d);
      return {
        text: `Here is the water area for ${v.min}–${v.max} with its trend and range. The band is narrowest in the middle and widest at the ends. ${v.max} is shown for two satellites; they are not directly comparable.`,
      };
    },
  },
];

export const getQuestion = (id) => QUESTIONS.find((q) => q.id === id) || null;

/** Used to fill the chips when the follow-ups were already asked. */
export const CHIP_PRIORITY = ['Q02', 'Q03', 'Q05', 'Q10', 'Q13', 'Q08', 'Q19', 'Q14'];

/* ------------------------------------------------------------ first message */

const MONTHS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };

/** Q01: the automatic first message (not a question). Chips: Q02, Q08. */
export function welcomeMessage(d) {
  const v = derive(d);
  const [, mon, year] = d.nisar_2026.badge.match(/(\w{3})\w* (\d{4})$/) || [];
  const when = mon ? `${MONTHS[mon] || mon} ${year}` : String(v.nisarYear);
  return {
    text:
      `Welcome! I'm your AQUA SAR guide. This is ${d.lake}, a coastal lake in Egypt's Nile Delta. We use radar satellites, which see through clouds and work at night, to measure how much of the lake is open water. ` +
      `The map shows NISAR (${when}). Drag the slider to see Sentinel-1 for ${v.min}–${v.max - 1}. Where would you like to start?`,
    followUps: ['Q02', 'Q08'],
  };
}

/* ---------------------------------------------------------------- matching */

export const FALLBACK = {
  text: "I can answer questions about the lake's water, the satellites and the data. Try one of these:",
  followUps: ['Q02', 'Q10'],
};

/**
 * Free text -> bank item. Score = number of keywords found (ties: longer matched text wins).
 * Returns { item, outsideYear } — item is null when nothing matches.
 */
export function matchQuestion(text, d) {
  const t = text.toLowerCase();
  const { min, max } = derive(d);
  let best = null;
  let bestScore = 0;
  let bestLen = 0;
  for (const item of QUESTIONS) {
    const hits = item.keywords.filter((k) => t.includes(k));
    const len = hits.reduce((a, k) => a + k.length, 0);
    if (hits.length > bestScore || (hits.length === bestScore && hits.length > 0 && len > bestLen)) {
      best = item;
      bestScore = hits.length;
      bestLen = len;
    }
  }
  const years = [...t.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
  const outsideYear = years.some((y) => y < min || y > max);
  return { item: best, outsideYear, min, max };
}
