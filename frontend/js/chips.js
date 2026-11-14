/**
 * Suggestion chips ONLY. The assistant's answers come from POST /chat (js/api.js sendChat);
 * nothing here produces an answer. Clicking a chip sends its question text like a typed message.
 *
 * topic = the backend's topic names: area_change, single_year, trend, forecast, core, nisar,
 *         data_source, accuracy, intro, fishing, farming, history, other.
 */
export const CHIPS = [
  { id: 'Q02', topic: 'area_change', question: 'How much water has the lake lost since 2019?' },
  { id: 'Q03', topic: 'trend', question: 'Is the lake still shrinking?' },
  { id: 'Q04', topic: 'core', question: 'What do you mean by the lake core?' },
  { id: 'Q05', topic: 'core', question: 'How much of the lake core is still open water?' },
  { id: 'Q06', topic: 'core', question: 'Where did the lost water go?' },
  { id: 'Q07', topic: 'core', question: 'How much vegetation is growing over the water?' },
  { id: 'Q08', topic: 'nisar', question: 'What is NISAR?' },
  { id: 'Q09', topic: 'nisar', question: 'Why do you use two satellites?' },
  { id: 'Q10', topic: 'nisar', question: 'Compare 2026: NISAR vs Sentinel-1' },
  { id: 'Q11', topic: 'accuracy', question: 'Which satellite should I trust?' },
  { id: 'Q12', topic: 'nisar', question: 'Why do the satellites disagree on vegetation?' },
  { id: 'Q13', topic: 'accuracy', question: 'How accurate is the map?' },
  { id: 'Q14', topic: 'forecast', question: 'Can you forecast the future?' },
  { id: 'Q15', topic: 'data_source', question: 'What does satellite radar actually see?' },
  { id: 'Q16', topic: 'data_source', question: 'How did you build this?' },
  { id: 'Q17', topic: 'data_source', question: 'What area do you cover?' },
  { id: 'Q18', topic: 'other', question: 'Why is the lake shrinking?' },
  { id: 'Q19', topic: 'fishing', question: 'Salinity and fish farms?' },
  { id: 'Q20', topic: 'history', question: 'How has the lake changed over the long term?' },
  { id: 'Q21', topic: 'fishing', question: 'Why does Burullus matter for fishing?' },
  { id: 'Q22', topic: 'farming', question: 'Does farming affect the lake?' },
  { id: 'Q23', topic: 'single_year', question: 'Which year had the biggest drop?' },
  { id: 'Q24', topic: 'area_change', question: 'Show me the table of all years' },
  { id: 'Q25', topic: 'trend', question: 'Plot the trend' },
];

export const getQuestion = (id) => CHIPS.find((c) => c.id === id) || null;

/** Which topics make a good follow-up after an answer on `topic` (in order of preference). */
const NEXT = {
  area_change: ['trend', 'core', 'nisar'],
  single_year: ['area_change', 'trend', 'core'],
  trend: ['forecast', 'core', 'nisar'],
  forecast: ['trend', 'accuracy', 'core'],
  core: ['nisar', 'accuracy', 'trend'],
  nisar: ['accuracy', 'core', 'data_source'],
  data_source: ['accuracy', 'nisar', 'area_change'],
  accuracy: ['nisar', 'data_source', 'trend'],
  intro: ['area_change', 'nisar', 'trend'],
  fishing: ['farming', 'history', 'area_change'],
  farming: ['fishing', 'history', 'area_change'],
  history: ['fishing', 'farming', 'trend'],
  other: ['area_change', 'nisar', 'trend'],
};
const GENERIC = ['area_change', 'nisar']; // greeting / off_topic / injection / unsupported / other_lake
const GENERIC_INTENTS = ['greeting', 'off_topic', 'injection', 'unsupported', 'other_lake'];

/** Exactly 2 chips (fewer only if the bank runs out), different topics, none already asked. `asked` = Set of ids. */
export function pickChips(intent, topic, asked) {
  const order = GENERIC_INTENTS.includes(intent) ? GENERIC : NEXT[topic] || NEXT.other;
  const all = [...new Set([...order, ...CHIPS.map((c) => c.topic)])];
  const out = [];
  const usedTopics = new Set();
  for (const t of all) {
    if (usedTopics.has(t)) continue;
    const c = CHIPS.find((x) => x.topic === t && !asked.has(x.id));
    if (c) { out.push(c); usedTopics.add(t); }
    if (out.length === 2) break;
  }
  return out;
}

/** The chip whose question text equals `text` (clicked or typed identically), or null. */
export const findChip = (text) => CHIPS.find((c) => c.question.toLowerCase() === String(text).trim().toLowerCase()) || null;
