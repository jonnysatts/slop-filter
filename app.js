const APP_NAME = 'Slop Filter V3 Alpha';
const STORAGE_KEY = 'slop-filter-v3-alpha';

const HUMANIZER_RULES = window.SlopFilterHumanizerRules || {
  prefixPatterns: [],
  legacyGroups: {
    filler: [],
    structure: [],
    fictionTell: [],
    register: [],
  },
  transitions: [],
  rules: [],
};

const HUMANIZER_ENGINE = window.SlopFilterHumanizerEngine || {
  detectHumanizerPatterns: () => [],
  computeHumanizerScore: () => ({
    score: 100,
    hitCount: 0,
    hits: [],
    categoryTotals: {},
    topCategories: [],
    penalties: {},
  }),
  describeDocumentMode: (mode) => ({
    mode: mode || 'fiction',
    label: titleCaseToken(mode || 'fiction'),
    badgeLabel: `${titleCaseToken(mode || 'fiction')} mode`,
    summary: 'Use the document mode to protect the right kind of prose.',
    guardrails: [],
  }),
};

const FILLER_PREFIXES = HUMANIZER_RULES.prefixPatterns;
const AI_TELLS = HUMANIZER_RULES.legacyGroups;
const TRANSITIONS = HUMANIZER_RULES.transitions;

const PROGRESSIVE_TO_PAST = {
  standing: 'stood',
  staring: 'stared',
  looking: 'looked',
  watching: 'watched',
  waiting: 'waited',
  walking: 'walked',
  talking: 'talked',
  holding: 'held',
  feeling: 'felt',
  shaking: 'shook',
  turning: 'turned',
};

const EMOTION_TO_ADJECTIVE = {
  anxiety: 'anxious',
  fear: 'afraid',
  anger: 'angry',
  sadness: 'sad',
  worry: 'worried',
};

const SAMPLE_BATCHES = [
  {
    name: 'Chapter set - demo',
    docs: [
      {
        name: '01_opening-chapter.md',
        text: `It is important to note that the town had changed since the flood, though nobody said it aloud in the market.\n\nThe windows were still wet at dawn, and the gutters carried last night's paper cups down the hill.\n\nMara stood by the bakery door and pretended she was only waiting for bread, but she was really watching the bridge for a sign of her brother.`,
      },
      {
        name: '02_midpoint-chapter.md',
        text: `At the end of the day, the council meeting was supposed to settle the question, but it only made the room feel smaller.\n\nThree voices rose at once. Then silence. Then the old clock on the wall struck nine and everyone looked at their hands.\n\nJonah folded the agenda into a square and put it in his coat pocket, as if the paper itself could be persuaded to keep a secret.`,
      },
      {
        name: '03_closing-chapter.md',
        text: `Needless to say, the letter explained everything, which was both convenient and annoying.\n\nBy the time Lena found the envelope, the kettle had gone cold and the window light had narrowed to a strip across the table.\n\nShe read the last line twice, then set the page down carefully, as though it could still change its mind.`,
      },
    ],
    voiceSampleText: `The prose should feel grounded, observant, and specific. Keep the cadence calm, clear, and understated. Prefer concrete nouns, crisp sentences, and quiet emotional pressure over explanation.`,
  },
];

const CONTROL_IDS = {
  mode: 'modeSelect',
  budget: 'budgetSelect',
  panel: 'panelSelect',
  voiceMode: 'voiceModeSelect',
  documentMode: 'documentModeSelect',
  threshold: 'voiceThresholdInput',
  voiceSample: 'voiceSampleInput',
};

const state = {
  batches: [],
  activeBatchId: null,
  activeDocId: null,
  detailTab: 'overview',
  busy: false,
  saveTimer: null,
};

const $ = (id) => document.getElementById(id);

const MODE_LABELS = {
  preserve: 'Preserve batch voice',
  house: 'Apply house voice',
  hybrid: 'Hybrid',
  frozen: 'Frozen series voice',
};

const BUDGET_LABELS = {
  minimal: 'Minimal edit',
  medium: 'Medium edit',
  aggressive: 'Aggressive edit',
};

const PANEL_LABELS = {
  'local-lite': 'Local lite',
  'editorial-plus': 'Editorial plus',
  'full-panel': 'Full panel',
};

const VOICE_SOURCE_LABELS = {
  batch_only: 'Batch only',
  voice_pack_only: 'Voice pack only',
  hybrid: 'Hybrid voice',
  frozen_project_voice: 'Frozen project voice',
};

const DOCUMENT_MODE_LABELS = {
  fiction: 'Fiction',
  essay: 'Essay',
  marketing: 'Marketing',
  business: 'Business',
  worldbuilding: 'Worldbuilding',
};

function normaliseBatchSettings(settings = {}) {
  return {
    mode: 'hybrid',
    budget: 'medium',
    panel: 'local-lite',
    voiceMode: 'hybrid',
    documentMode: 'fiction',
    threshold: 66,
    voiceSampleText: '',
    ...settings,
  };
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function formatPercent(value, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

function formatSigned(value, digits = 0) {
  const fixed = Math.abs(value).toFixed(digits);
  return `${value >= 0 ? '+' : '−'}${fixed}`;
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function titleCaseToken(value) {
  return String(value || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCategoryList(items = []) {
  return items
    .map((item) => titleCaseToken(item.category || item))
    .join(', ');
}

function documentModeMeta(mode) {
  const resolvedMode = DOCUMENT_MODE_LABELS[mode] ? mode : 'fiction';
  return HUMANIZER_ENGINE.describeDocumentMode(resolvedMode);
}

function isNarrativeDocumentMode(mode) {
  return ['fiction', 'worldbuilding'].includes(mode);
}

function effectiveDocumentMode(doc, batch) {
  const candidate = doc?.modeOverride || batch?.settings?.documentMode || 'fiction';
  return DOCUMENT_MODE_LABELS[candidate] ? candidate : 'fiction';
}

function documentModeDirty(doc, batch) {
  if (!doc?.appliedDocumentMode) return false;
  return effectiveDocumentMode(doc, batch) !== doc.appliedDocumentMode;
}

function batchDocumentModeBadge(batch) {
  const modes = Array.from(new Set((batch?.docs || []).map((doc) => effectiveDocumentMode(doc, batch))));
  if (!modes.length) return documentModeMeta(batch?.settings?.documentMode || 'fiction').badgeLabel;
  if (modes.length === 1) return documentModeMeta(modes[0]).badgeLabel;
  return `Mixed modes (${modes.length})`;
}

function appendWarning(existing, addition) {
  if (!addition) return existing || '';
  if (!existing) return addition;
  return `${existing} · ${addition}`;
}

function slugify(value) {
  return String(value || 'batch')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'batch';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNowStamp() {
  const date = new Date();
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function countPhraseHits(text, phrases) {
  const source = text.toLowerCase();
  return phrases.reduce((acc, phrase) => {
    const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return acc + countMatches(source, pattern);
  }, 0);
}

function splitParagraphs(text) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const expanded = [];
  blocks.forEach((block) => {
    const headingMatch = block.match(/^(#{1,6}\s.+?)\n+([\s\S]+)$/);
    if (headingMatch) {
      expanded.push(headingMatch[1].trim());
      expanded.push(headingMatch[2].trim());
    } else {
      expanded.push(block);
    }
  });

  return expanded.filter(Boolean);
}

function splitSentences(text) {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function tokenizeWords(text) {
  return (text.match(/\b[\w’'-]+\b/g) || []).filter(Boolean);
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \u00A0]{2,}/g, ' ')
    .trim();
}

function vectorizeText(text, options = {}) {
  const documentMode = DOCUMENT_MODE_LABELS[options.mode] ? options.mode : 'fiction';
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);
  const words = tokenizeWords(text);
  const wordCount = words.length || 1;
  const sentenceWordCounts = sentences.map((sentence) => tokenizeWords(sentence).length || 1);
  const paragraphWordCounts = paragraphs.map((paragraph) => tokenizeWords(paragraph).length || 1);
  const uniqueWords = new Set(words.map((word) => word.toLowerCase())).size;
  const contractions = countMatches(text, /\b\w+'\w+\b/g);
  const dialogueSpans = countMatches(text, /["“”]/g) / 2;
  const emDashes = countMatches(text, /—/g);
  const semicolons = countMatches(text, /;/g);
  const questions = countMatches(text, /\?/g);
  const exclamations = countMatches(text, /!/g);
  const fragments = sentenceWordCounts.filter((count) => count < 5).length;
  const longSentences = sentenceWordCounts.filter((count) => count > 24).length;
  const fillerHits = countPhraseHits(text, AI_TELLS.filler) + countPhraseHits(text, TRANSITIONS);
  const structureHits = countPhraseHits(text, AI_TELLS.structure);
  const fictionHits = countPhraseHits(text, AI_TELLS.fictionTell);
  const registerHits = countPhraseHits(text, AI_TELLS.register);
  const repeatedWords = words.reduce((acc, word, index) => {
    if (index > 0 && word.toLowerCase() === words[index - 1].toLowerCase()) return acc + 1;
    return acc;
  }, 0);
  const avgSentence = mean(sentenceWordCounts);
  const avgParagraph = mean(paragraphWordCounts);
  const sentenceSpread = stdev(sentenceWordCounts);
  const paragraphSpread = stdev(paragraphWordCounts);
  const lexicalDiversity = uniqueWords / wordCount;
  const contractionRate = contractions / wordCount;
  const dialogueDensity = dialogueSpans / Math.max(1, paragraphs.length);
  const emDashRate = emDashes / Math.max(1, sentences.length);
  const semicolonRate = semicolons / Math.max(1, sentences.length);
  const questionRate = questions / Math.max(1, sentences.length);
  const exclamationRate = exclamations / Math.max(1, sentences.length);
  const fragmentRate = fragments / Math.max(1, sentences.length);
  const longSentenceRate = longSentences / Math.max(1, sentences.length);
  const repetitionRate = repeatedWords / wordCount;
  const modifierDensity = (
    countMatches(text, /\b(?:very|really|just|quite|rather|fairly|deeply|simply|clearly|obviously|truly|particularly|especially|remarkably|incredibly)\b/gi)
  ) / wordCount;
  const concreteDensity = (
    countMatches(text, /\b(?:stone|door|window|table|road|river|chair|hand|bread|road|bridge|paper|kettle|light|wall|coat|floor|market|street|room)\b/gi)
  ) / wordCount;
  const abstractDensity = (
    countMatches(text, /\b(?:truth|meaning|purpose|freedom|purpose|emotion|feeling|system|process|context|journey|landscape|universe|experience)\b/gi)
  ) / wordCount;
  const humanizer = HUMANIZER_ENGINE.computeHumanizerScore(text, {
    metrics: {
      wordCount,
      sentenceCount: sentences.length,
      avgSentence,
      sentenceSpread,
      dialogueDensity,
      questionRate,
      modifierDensity,
      concreteDensity,
      abstractDensity,
    },
    mode: documentMode,
  });

  const qualityScore = clamp(
    100
      - (
        fillerHits * 5
        + structureHits * 3
        + fictionHits * 4
        + registerHits * 5
        + repetitionRate * 120
        + Math.abs(avgSentence - 18) * 1.2
        + sentenceSpread * 0.7
        + paragraphSpread * 0.05
        + Math.max(0, longSentenceRate - 0.15) * 28
        + Math.max(0, fragmentRate - 0.1) * 20
      ),
    0,
    100,
  );

  const detectorRisk = clamp(
    16
      + fillerHits * 7.5
      + structureHits * 4.5
      + fictionHits * 5
      + registerHits * 6
      + repetitionRate * 140
      + modifierDensity * 100
      + Math.max(0, longSentenceRate - 0.16) * 24
      + Math.max(0, fragmentRate - 0.15) * 18,
    0,
    100,
  );

  return {
    paragraphs,
    sentences,
    words,
    wordCount,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    avgSentence,
    avgParagraph,
    sentenceSpread,
    paragraphSpread,
    lexicalDiversity,
    contractionRate,
    dialogueDensity,
    emDashRate,
    semicolonRate,
    questionRate,
    exclamationRate,
    fragmentRate,
    longSentenceRate,
    repetitionRate,
    modifierDensity,
    concreteDensity,
    abstractDensity,
    fillerHits,
    structureHits,
    fictionHits,
    registerHits,
    documentMode,
    humanizerScore: humanizer.score,
    humanizerHitCount: humanizer.hitCount,
    humanizerHits: humanizer.hits,
    humanizerCategoryTotals: humanizer.categoryTotals,
    humanizerTopCategories: humanizer.topCategories,
    qualityScore,
    detectorRisk,
  };
}

function profileFromVector(metrics) {
  return {
    avgSentence: clamp(metrics.avgSentence / 30, 0, 1),
    sentenceSpread: clamp(metrics.sentenceSpread / 18, 0, 1),
    avgParagraph: clamp(metrics.avgParagraph / 180, 0, 1),
    lexicalDiversity: clamp(metrics.lexicalDiversity, 0, 1),
    contractionRate: clamp(metrics.contractionRate * 10, 0, 1),
    dialogueDensity: clamp(metrics.dialogueDensity / 4, 0, 1),
    emDashRate: clamp(metrics.emDashRate * 2.5, 0, 1),
    semicolonRate: clamp(metrics.semicolonRate * 3.5, 0, 1),
    questionRate: clamp(metrics.questionRate * 3.5, 0, 1),
    exclamationRate: clamp(metrics.exclamationRate * 4, 0, 1),
    fragmentRate: clamp(metrics.fragmentRate, 0, 1),
    longSentenceRate: clamp(metrics.longSentenceRate, 0, 1),
    modifierDensity: clamp(metrics.modifierDensity * 10, 0, 1),
    concreteDensity: clamp(metrics.concreteDensity * 12, 0, 1),
    abstractDensity: clamp(metrics.abstractDensity * 12, 0, 1),
  };
}

function blendProfiles(a, b, weightB = 0.5) {
  if (!a && !b) return null;
  if (!a) return { ...b };
  if (!b) return { ...a };
  const out = {};
  Object.keys(a).forEach((key) => {
    out[key] = a[key] * (1 - weightB) + b[key] * weightB;
  });
  return out;
}

function centroid(profiles) {
  if (!profiles.length) return null;
  const keys = Object.keys(profiles[0]);
  const out = {};
  keys.forEach((key) => {
    out[key] = mean(profiles.map((profile) => profile[key]));
  });
  return out;
}

function profileDistance(a, b) {
  if (!a || !b) return 0;
  const keys = Object.keys(a);
  const deltas = keys.map((key) => Math.abs((a[key] ?? 0) - (b[key] ?? 0)));
  return mean(deltas);
}

function targetWeights(mode) {
  switch (mode) {
    case 'preserve':
      return { target: 0.25, batch: 0.75 };
    case 'house':
      return { target: 0.8, batch: 0.2 };
    case 'hybrid':
      return { target: 0.55, batch: 0.45 };
    case 'frozen':
      return { target: 0.7, batch: 0.3 };
    default:
      return { target: 0.5, batch: 0.5 };
  }
}

function modeIntensity(mode) {
  switch (mode) {
    case 'preserve':
      return 0.9;
    case 'house':
      return 1.12;
    case 'hybrid':
      return 1;
    case 'frozen':
      return 0.96;
    default:
      return 1;
  }
}

function budgetIntensity(budget) {
  switch (budget) {
    case 'minimal':
      return 0.72;
    case 'medium':
      return 1;
    case 'aggressive':
      return 1.42;
    default:
      return 1;
  }
}

function panelRiskWeight(panel) {
  switch (panel) {
    case 'editorial-plus':
      return 1.12;
    case 'full-panel':
      return 1.27;
    default:
      return 1;
  }
}

function createDoc(name, text, sourceType = 'text') {
  return {
    id: uid('doc'),
    name,
    sourceType,
    originalText: normalizeText(text),
    revisedText: '',
    reviewState: 'pending',
    annotations: [],
    notes: '',
    originalMetrics: null,
    revisedMetrics: null,
    originalProfile: null,
    revisedProfile: null,
    delta: null,
    residueAudit: null,
    acceptance: null,
    modeOverride: '',
    appliedDocumentMode: '',
    voice: null,
    outlier: false,
    reruns: 0,
    selected: false,
    status: 'queued',
    warning: sourceType !== 'text' ? 'Browser parsing not bundled for this file type.' : '',
  };
}

function createBatch({ name, docs = [], voiceSampleText = '', source = 'manual' }) {
  return {
    id: uid('batch'),
    name,
    source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: docs.length ? 'idle' : 'empty',
    progress: 0,
    settings: normaliseBatchSettings({ voiceSampleText }),
    docs,
    summary: null,
    targetProfile: null,
    batchProfile: null,
    notes: '',
  };
}

function activeBatch() {
  return state.batches.find((batch) => batch.id === state.activeBatchId) || null;
}

function activeDoc(batch = activeBatch()) {
  if (!batch) return null;
  return batch.docs.find((doc) => doc.id === state.activeDocId) || batch.docs[0] || null;
}

function syncControlsFromBatch(batch) {
  if (!batch) return;
  $(CONTROL_IDS.mode).value = batch.settings.mode;
  $(CONTROL_IDS.budget).value = batch.settings.budget;
  $(CONTROL_IDS.panel).value = batch.settings.panel;
  $(CONTROL_IDS.voiceMode).value = batch.settings.voiceMode;
  $(CONTROL_IDS.documentMode).value = batch.settings.documentMode;
  $(CONTROL_IDS.threshold).value = String(batch.settings.threshold);
  $(CONTROL_IDS.voiceSample).value = batch.settings.voiceSampleText || '';
}

function updateBatchFromControls(batch) {
  if (!batch) return;
  batch.settings.mode = $(CONTROL_IDS.mode).value;
  batch.settings.budget = $(CONTROL_IDS.budget).value;
  batch.settings.panel = $(CONTROL_IDS.panel).value;
  batch.settings.voiceMode = $(CONTROL_IDS.voiceMode).value;
  batch.settings.documentMode = $(CONTROL_IDS.documentMode).value;
  batch.settings.threshold = Number($(CONTROL_IDS.threshold).value || 66);
  batch.settings.voiceSampleText = $(CONTROL_IDS.voiceSample).value;
  updateSettingsPreview(batch.settings);
  saveSoon();
}

function updateSettingsPreview(settings = null) {
  const mode = settings?.mode || $(CONTROL_IDS.mode)?.value || 'preserve';
  const budget = settings?.budget || $(CONTROL_IDS.budget)?.value || 'medium';
  const panel = settings?.panel || $(CONTROL_IDS.panel)?.value || 'local-lite';
  const voiceMode = settings?.voiceMode || $(CONTROL_IDS.voiceMode)?.value || 'hybrid';
  const documentMode = settings?.documentMode || $(CONTROL_IDS.documentMode)?.value || 'fiction';
  const threshold = Number(settings?.threshold || $(CONTROL_IDS.threshold)?.value || 66);
  const modeMeta = documentModeMeta(documentMode);

  if ($('settingsModeChip')) $('settingsModeChip').textContent = MODE_LABELS[mode] || mode;
  if ($('settingsBudgetChip')) $('settingsBudgetChip').textContent = BUDGET_LABELS[budget] || budget;
  if ($('settingsVoiceChip')) $('settingsVoiceChip').textContent = VOICE_SOURCE_LABELS[voiceMode] || voiceMode;
  if ($('settingsDocumentModeChip')) $('settingsDocumentModeChip').textContent = modeMeta.label;
  if ($('thresholdValue')) $('thresholdValue').textContent = String(threshold);

  const modeText = {
    preserve: 'Keeps the uploaded chapters sounding like the same work while trimming obvious filler and synthetic cadence.',
    house: 'Pushes the batch toward the supplied house voice, even if that means stronger stylistic reshaping.',
    hybrid: 'Balances chapter-to-chapter consistency with your target voice so the batch tightens up without losing cohesion.',
    frozen: 'Locks the batch to a persistent project voice so future runs stay aligned with the same series identity.',
  }[mode] || 'Tune the rewrite pressure and voice policy before you run the batch.';

  const panelText = {
    'local-lite': 'Fastest pass, lighter scoring.',
    'editorial-plus': 'Stronger editorial heuristics.',
    'full-panel': 'Heaviest local scrutiny.',
  }[panel] || '';

  if ($('settingsPreviewText')) {
    $('settingsPreviewText').textContent = `${modeText} ${modeMeta.summary} ${panelText}`.trim();
  }
}

function saveSoon() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeBatchId: state.activeBatchId,
        activeDocId: state.activeDocId,
        detailTab: state.detailTab,
        batches: state.batches.map((batch) => ({
          id: batch.id,
          name: batch.name,
          source: batch.source,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          status: batch.status,
          progress: batch.progress,
          settings: batch.settings,
          summary: batch.summary,
          notes: batch.notes,
          targetProfile: batch.targetProfile,
          batchProfile: batch.batchProfile,
          docs: batch.docs.map((doc) => ({
            id: doc.id,
            name: doc.name,
            sourceType: doc.sourceType,
            originalText: doc.originalText,
            revisedText: doc.revisedText,
            reviewState: doc.reviewState,
            annotations: doc.annotations,
            notes: doc.notes,
            originalMetrics: doc.originalMetrics,
            revisedMetrics: doc.revisedMetrics,
            originalProfile: doc.originalProfile,
            revisedProfile: doc.revisedProfile,
            delta: doc.delta,
            residueAudit: doc.residueAudit,
            acceptance: doc.acceptance,
            modeOverride: doc.modeOverride,
            appliedDocumentMode: doc.appliedDocumentMode,
            voice: doc.voice,
            outlier: doc.outlier,
            reruns: doc.reruns,
            status: doc.status,
            warning: doc.warning,
          })),
        })),
      }));
    } catch (error) {
      // Local persistence is best-effort only.
    }
  }, 180);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.batches)) return false;
    state.activeBatchId = parsed.activeBatchId || null;
    state.activeDocId = parsed.activeDocId || null;
    state.detailTab = parsed.detailTab || 'overview';
    state.batches = parsed.batches.map((batch) => ({
      ...batch,
      settings: normaliseBatchSettings(batch.settings),
      docs: (batch.docs || []).map((doc) => ({
        modeOverride: '',
        appliedDocumentMode: '',
        ...doc,
      })),
    }));
    return state.batches.length > 0;
  } catch (error) {
    return false;
  }
}

function makeSampleBatch() {
  const sample = SAMPLE_BATCHES[0];
  const docs = sample.docs.map((doc, index) => createDoc(doc.name, doc.text, 'text'));
  const batch = createBatch({
    name: sample.name,
    docs,
    voiceSampleText: sample.voiceSampleText,
    source: 'demo',
  });
  batch.settings.mode = 'hybrid';
  batch.settings.budget = 'medium';
  batch.settings.panel = 'editorial-plus';
  batch.settings.voiceMode = 'hybrid';
  batch.settings.documentMode = 'fiction';
  batch.settings.threshold = 68;
  return batch;
}

function makeEmptyBatch(name = 'Untitled batch') {
  return createBatch({ name, docs: [], voiceSampleText: '', source: 'manual' });
}

function addBatch(batch) {
  state.batches.unshift(batch);
  state.activeBatchId = batch.id;
  state.activeDocId = batch.docs[0]?.id || null;
  state.detailTab = 'overview';
  syncControlsFromBatch(batch);
  renderAll();
  saveSoon();
}

function createAndSelectBatch() {
  const batch = makeEmptyBatch(`Batch ${state.batches.length + 1}`);
  addBatch(batch);
}

function selectBatch(batchId) {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) return;
  state.activeBatchId = batch.id;
  state.activeDocId = batch.docs[0]?.id || null;
  state.detailTab = 'overview';
  syncControlsFromBatch(batch);
  renderAll();
}

function selectDoc(docId) {
  const batch = activeBatch();
  if (!batch) return;
  const doc = batch.docs.find((item) => item.id === docId);
  if (!doc) return;
  state.activeDocId = doc.id;
  renderAll();
}

function selectTab(tab) {
  state.detailTab = tab;
  renderInspector(activeBatch());
  updateTabState();
}

function updateTabState() {
  document.querySelectorAll('.tab[data-action="tab"]').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === state.detailTab);
  });
}

function docDisplayState(doc, batch = activeBatch()) {
  if (doc.status === 'blocked') return { label: 'Blocked', cls: 'danger' };
  if (doc.status === 'processing') return { label: 'Running', cls: 'info' };
  if (documentModeDirty(doc, batch)) return { label: 'Needs rerun', cls: 'warn' };
  if (doc.acceptance?.reverted) return { label: 'Kept original', cls: 'warn' };
  if (doc.reviewState === 'approved') return { label: 'Approved', cls: 'good' };
  if (doc.reviewState === 'rejected') return { label: 'Rejected', cls: 'danger' };
  if (doc.outlier) return { label: 'Outlier', cls: 'warn' };
  if (doc.reviewState === 'needs-review') return { label: 'Needs review', cls: 'warn' };
  if (doc.status === 'complete') return { label: 'Ready', cls: 'info' };
  return { label: 'Pending', cls: '' };
}

function scorePill(value, highGood = true) {
  const cls = highGood
    ? value >= 70 ? 'good' : value >= 50 ? 'warn' : 'danger'
    : value <= 35 ? 'good' : value <= 55 ? 'warn' : 'danger';
  return { cls, label: `${Math.round(value)}${highGood ? '/100' : ''}` };
}

function pluralize(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function docWasProcessed(doc) {
  return Boolean(doc.originalMetrics && doc.revisedMetrics);
}

function docHasRewrite(doc) {
  if (!docWasProcessed(doc)) return false;
  return normalizeText(doc.revisedText || '') !== normalizeText(doc.originalText || '');
}

function docHasMaterialRewrite(doc) {
  if (!docHasRewrite(doc)) return false;
  const qualityDelta = Math.abs(doc.delta?.qualityDelta || 0);
  const riskDelta = Math.abs(doc.delta?.riskDelta || 0);
  const humanizerDelta = Math.abs(doc.delta?.humanizerDelta || 0);
  const wordDelta = Math.abs(doc.delta?.wordDelta || 0);
  const sentenceDelta = Math.abs(doc.delta?.sentenceDelta || 0);
  return qualityDelta >= 0.75 || riskDelta >= 0.75 || humanizerDelta >= 1 || wordDelta >= 12 || sentenceDelta >= 1;
}

function averageVoiceScore(batch) {
  const docs = batch.docs.filter((doc) => Number.isFinite(doc.voice?.score));
  return docs.length ? mean(docs.map((doc) => doc.voice.score)) : 0;
}

function buildBatchOutcome(batch) {
  const summary = batch.summary || {};
  const totalDocs = batch.docs.length;
  const processed = summary.analysedCount || batch.docs.filter(docWasProcessed).length;
  const changed = batch.docs.filter(docHasMaterialRewrite).length;
  const touched = batch.docs.filter(docHasRewrite).length;
  const outliers = summary.outliers || 0;
  const approved = summary.approved || 0;
  const rejected = summary.rejected || 0;
  const residueAlerts = summary.residueAlerts || 0;
  const gateReverts = summary.gateReverts || 0;
  const modePendingCount = batch.docs.filter((doc) => documentModeDirty(doc, batch)).length;
  const pendingReview = batch.docs.filter((doc) => doc.reviewState !== 'approved' && doc.reviewState !== 'rejected').length;
  const priorityReview = batch.docs.filter((doc) => doc.outlier || docHasMaterialRewrite(doc) || doc.reviewState === 'rejected' || documentModeDirty(doc, batch) || (doc.residueAudit?.accepted && (doc.residueAudit?.finalFindings?.length || 0) > 0)).length;
  const avgVoice = averageVoiceScore(batch);

  let description = 'Load a batch of related chapters, marketing copy, or notes, then run the local analysis loop.';
  let nextStep = 'Import files, then run the batch.';
  let badgeLabel = 'Ready';
  let badgeClass = 'info';

  if (!totalDocs) {
    badgeLabel = 'Empty';
    badgeClass = 'warn';
    description = 'No documents are loaded yet. Import Markdown or text files to start a batch.';
    nextStep = 'Add files on the left, then run the batch.';
  } else if (batch.status === 'running') {
    badgeLabel = 'Running';
    badgeClass = 'info';
    description = `The batch is processing ${pluralize(totalDocs, 'document')}. ${processed} finished so far.`;
    nextStep = 'Let the run finish, then review the queue for changed files or outliers.';
  } else if (!processed) {
    badgeLabel = 'Ready';
    badgeClass = 'info';
    description = `${pluralize(totalDocs, 'document')} loaded. This batch has not been processed yet.`;
    nextStep = 'Run the batch to score the originals and generate revised drafts.';
  } else if (!changed) {
    badgeLabel = 'Processed';
    badgeClass = 'warn';
    description = `The batch ran across ${pluralize(processed, 'document')}, but it did not produce any meaningful rewrites with the current settings.`;
    nextStep = touched
      ? 'Open a document to inspect the light edits, or rerun with a stronger edit budget.'
      : 'Inspect the annotations, then rerun with a stronger edit budget or different voice settings.';
  } else {
    badgeLabel = outliers ? 'Needs review' : 'Processed';
    badgeClass = outliers ? 'warn' : 'good';
    description = outliers
      ? `${pluralize(changed, 'document')} changed materially after the run. ${pluralize(outliers, 'document')} ${outliers === 1 ? 'is' : 'are'} flagged as voice outliers.`
      : `${pluralize(changed, 'document')} changed materially after the run. No voice outliers were flagged.`;
    nextStep = outliers
      ? 'Review the outliers first, then rerun or approve them.'
      : pendingReview
        ? 'Review the changed documents and approve the keepers.'
        : 'The batch is ready to export or spot-check.';
  }

  const runValue = batch.status === 'running' ? `${batch.progress}%` : processed ? 'Yes' : 'Not yet';
  const runNote = !totalDocs
    ? 'No files are loaded in this batch yet.'
    : processed
      ? `Processed ${processed} of ${totalDocs} files.`
      : `${totalDocs} files are loaded and waiting to run.`;

  let changeValue = 'Awaiting run';
  let changeNote = 'Rewrites and score deltas appear after the first run.';
  if (processed) {
    changeValue = changed ? `${changed} changed` : 'No material rewrites';
    if (changed) {
      changeNote = `${touched} touched overall. Avg quality ${formatSigned(summary.qualityDelta || 0, 1)}, risk ${formatSigned(summary.riskDelta || 0, 1)}, Humanizer ${formatSigned(summary.humanizerDelta || 0, 1)}.${gateReverts ? ` ${gateReverts} kept original by gate.` : ''}${modePendingCount ? ` ${modePendingCount} mode override${modePendingCount === 1 ? '' : 's'} waiting on rerun.` : ''}${residueAlerts ? ` ${residueAlerts} residue alert${residueAlerts === 1 ? '' : 's'} remain.` : ''}`;
    } else if (touched) {
      changeNote = `Light rewrites were generated, but the score movement stayed minor. Humanizer ${formatSigned(summary.humanizerDelta || 0, 1)}.${gateReverts ? ` ${gateReverts} kept original by gate.` : ''}${modePendingCount ? ` ${modePendingCount} mode override${modePendingCount === 1 ? '' : 's'} waiting on rerun.` : ''}`;
    } else {
      changeNote = 'The run completed without generating revised drafts worth keeping yet.';
    }
  }

  let nextValue = 'Run batch';
  if (batch.status === 'running') nextValue = 'In progress';
  else if (!processed) nextValue = 'Run batch';
  else if (outliers) nextValue = `${outliers} outlier${outliers === 1 ? '' : 's'}`;
  else if (priorityReview) nextValue = `${priorityReview} priority review`;
  else if (processed) nextValue = 'Export ready';

  return {
    totalDocs,
    processed,
    changed,
    touched,
    outliers,
    approved,
    rejected,
    pendingReview,
    priorityReview,
    avgVoice,
    description,
    nextStep,
    badgeLabel,
    badgeClass,
    runValue,
    runNote,
    changeValue,
    changeNote,
    nextValue,
  };
}

function buildDocOutcome(doc, batch) {
  const processed = docWasProcessed(doc);
  const touched = docHasRewrite(doc);
  const material = docHasMaterialRewrite(doc);
  const reverted = Boolean(doc.acceptance?.reverted);
  const modePending = documentModeDirty(doc, batch);
  const currentMode = effectiveDocumentMode(doc, batch);
  const qualityDelta = doc.delta?.qualityDelta || 0;
  const riskDelta = doc.delta?.riskDelta || 0;
  const humanizerDelta = doc.delta?.humanizerDelta || 0;
  const voiceScore = doc.voice?.score || 0;
  const words = doc.originalMetrics?.wordCount || 0;
  const sentences = doc.originalMetrics?.sentenceCount || 0;

  let summary = 'Loaded, but not processed yet.';
  let nextStep = 'Run the batch to generate a revised version.';
  let changeLabel = 'Waiting';
  let changeClass = '';

  if (doc.status === 'processing') {
    summary = 'This document is being processed right now.';
    nextStep = 'Wait for the run to finish before reviewing it.';
    changeLabel = 'Running';
    changeClass = 'info';
  } else if (processed && modePending) {
    summary = `Document mode changed to ${DOCUMENT_MODE_LABELS[currentMode] || currentMode}. Rerun this file to apply the new safety policy.`;
    nextStep = `Rerun this file so the ${DOCUMENT_MODE_LABELS[currentMode] || currentMode} pass can rescore and rewrite it.`;
    changeLabel = 'Mode pending';
    changeClass = 'warn';
  } else if (processed && reverted) {
    summary = 'The acceptance gate kept the original because the rewrite did not clear the quality floor.';
    nextStep = doc.acceptance?.reasons?.[0] || 'Rerun this file with a stronger budget or inspect the original.';
    changeLabel = 'Original kept';
    changeClass = 'warn';
  } else if (processed && material) {
    summary = `Meaningful rewrite generated. Quality ${formatSigned(qualityDelta, 1)} and detector risk ${formatSigned(riskDelta, 1)}.`;
    nextStep = doc.outlier
      ? 'Check the voice tab before approving this rewrite.'
      : 'Review the revised draft and approve it if the voice still holds.';
    changeLabel = 'Changed';
    changeClass = 'good';
  } else if (processed && touched) {
    summary = 'A light rewrite was generated, but the movement stayed minor.';
    nextStep = 'Inspect the revised draft or rerun this file with a stronger budget.';
    changeLabel = 'Light rewrite';
    changeClass = 'info';
  } else if (processed) {
    summary = 'Processed with no material rewrite under the current settings.';
    nextStep = 'Inspect the annotations or rerun this file with a stronger budget.';
    changeLabel = 'No material rewrite';
    changeClass = 'warn';
  }

  if (processed && doc.outlier) {
    summary += ` Voice ${Math.round(voiceScore)} and flagged as an outlier.`;
  } else if (processed && doc.voice) {
    summary += ` Voice ${Math.round(voiceScore)} and in band.`;
  }

  if (processed && doc.residueAudit?.accepted && (doc.residueAudit?.finalFindings?.length || 0) > 0) {
    summary += ` ${doc.residueAudit.finalFindings.length} residue finding${doc.residueAudit.finalFindings.length === 1 ? '' : 's'} remain.`;
    nextStep = 'Check the residue audit before approving this rewrite.';
  }

  if (doc.reviewState === 'approved') {
    nextStep = 'This file is approved. Export the batch or spot-check the final text.';
  } else if (doc.reviewState === 'rejected') {
    nextStep = 'This file is rejected. Rerun it if you want another attempt.';
  }

  return {
    processed,
    touched,
    material,
    qualityDelta,
    riskDelta,
    humanizerDelta,
    voiceScore,
    words,
    sentences,
    summary,
    nextStep,
    changeLabel,
    changeClass,
    thresholdClass: voiceScore >= batch.settings.threshold ? 'good' : 'warn',
    modePending,
    currentMode,
  };
}

function buildAnnotations(text, options = {}) {
  const documentMode = DOCUMENT_MODE_LABELS[options.mode] ? options.mode : 'fiction';
  const narrativeMode = isNarrativeDocumentMode(documentMode);
  const annotations = [];
  const sentences = splitSentences(text);
  const humanizerHits = HUMANIZER_ENGINE.detectHumanizerPatterns(text, { mode: documentMode }).slice(0, 6);

  humanizerHits.forEach((hit) => {
    annotations.push({
      type: hit.category,
      original: hit.excerpt,
      reason: hit.hint,
    });
  });

  sentences.forEach((sentence) => {
    const lower = sentence.toLowerCase();
    if (FILLER_PREFIXES.some((pattern) => pattern.test(sentence))) {
      annotations.push({
        type: 'filler',
        original: sentence,
        reason: 'The sentence opens with a stock explanatory lead-in that delays the actual point.',
      });
    }
    if (AI_TELLS.structure.some((phrase) => lower.includes(phrase))) {
      annotations.push({
        type: 'structure',
        original: sentence,
        reason: 'This sentence uses a predictable explanatory structure that reads as synthetic.',
      });
    }
    if (narrativeMode && AI_TELLS.fictionTell.some((phrase) => lower.includes(phrase))) {
      annotations.push({
        type: 'fiction-tell',
        original: sentence,
        reason: 'The sentence announces emotion or intent instead of letting the scene carry it.',
      });
    }
    if (!narrativeMode && AI_TELLS.register.some((phrase) => lower.includes(phrase))) {
      annotations.push({
        type: 'register',
        original: sentence,
        reason: 'The prose shifts into over-general, documentary-like register.',
      });
    }
    if (tokenizeWords(sentence).length > 28 && /[—;:]/.test(sentence)) {
      annotations.push({
        type: 'rhythm',
        original: sentence,
        reason: 'Sentence length and punctuation make the cadence feel manufactured rather than organic.',
      });
    }
  });

  if (annotations.length < 3) {
    const textLower = text.toLowerCase();
    const fillerHits = countPhraseHits(textLower, AI_TELLS.filler);
    if (fillerHits > 0) {
      annotations.push({
        type: 'filler',
        original: text.split(/\n+/).slice(0, 1).join(' '),
        reason: 'There are enough filler patterns in the passage to justify a tighter rewrite pass.',
      });
    }
  }

  return annotations.slice(0, 12);
}

function stripWrappingPunctuation(text) {
  return text.replace(/^[\s,;:.-]+/, '').replace(/[\s,;:.-]+$/, '').trim();
}

function capitaliseSentence(text) {
  return text
    .trim()
    .replace(/^([\"“‘(\[]?)([a-z])/, (match, prefix, char) => `${prefix}${char.toUpperCase()}`)
    .replace(/(^|[.!?]\s+)(["“‘(\[]?)([a-z])/g, (match, lead, prefix, char) => `${lead}${prefix}${char.toUpperCase()}`);
}

function tightenProgressiveVerb(text) {
  return text.replace(/\b([A-Z][a-z]+|[Hh]e|[Ss]he|[Tt]hey|[Ww]e|I)\s+(was|were)\s+([a-z]+ing)\b/g, (match, subject, aux, gerund) => {
    const replacement = PROGRESSIVE_TO_PAST[gerund.toLowerCase()];
    if (!replacement) return match;
    return `${subject} ${replacement}`;
  });
}

function collapseRepeatedSubjectClause(text) {
  return text.replace(
    /\b(the [a-z][a-z\s'-]{1,30}|[A-Z][a-z]+)\s+was\s+([^,]+),\s+\1\s+was\s+([^,]+),\s+and\s+\1\s+was\s+([^.!?]+)([.!?])?/gi,
    (match, subject, partA, partB, partC, terminal = '.') => `${capitaliseSentence(subject)} was ${stripWrappingPunctuation(partA)}, ${stripWrappingPunctuation(partB)}, and ${stripWrappingPunctuation(partC)}${terminal || '.'}`,
  );
}

function smoothSentenceEnding(text) {
  let out = text;
  out = out.replace(/\b(in many ways|in some ways|needless to say)\b/gi, '');
  out = out.replace(/\bthe kind of ([a-z]+) that\b/gi, 'the $1 that');
  out = out.replace(/\bit was the ([a-z]+) that\b/gi, 'the $1 that');
  out = out.replace(/\bthe ([a-z]+) that (made|kept)\b/gi, 'the $1 $2');
  out = out.replace(/\bmore than words ever could\b/gi, 'more than words could');
  out = out.replace(/\bin a way that was almost cinematic\b/gi, '');
  out = out.replace(/\bsomething important was about to happen\b/gi, 'something was about to happen');
  out = out.replace(/\bfelt a wave of ([a-z]+)\b/gi, 'felt $1');
  out = out.replace(/\bfelt a sense of ([a-z]+)\b/gi, 'felt $1');
  out = out.replace(/\bfelt (anxiety|fear|anger|sadness|worry)\b/gi, (match, emotion) => `felt ${EMOTION_TO_ADJECTIVE[emotion.toLowerCase()] || emotion}`);
  out = out.replace(/\bknew that\b/gi, 'knew');
  out = out.replace(/\bdeeply\s+(significant|important|obvious)\b/gi, '$1');
  out = out.replace(/\ba powerful reminder(?: that)?\b/gi, 'a sign');
  out = out.replace(/\bin a state of total disorder\b/gi, 'in total disorder');
  out = out.replace(/^It was as if\s+(.+?)([.!?])?$/i, (match, clause, terminal = '.') => `${capitaliseSentence(clause)}${terminal || '.'}`);
  out = out.replace(/,\s+and\s+(he|she|they|we|i)\s+was\s+([a-z]+ing)\b/gi, (match, subject, gerund) => {
    const replacement = PROGRESSIVE_TO_PAST[gerund.toLowerCase()];
    return replacement ? ` and ${replacement}` : match;
  });
  out = out.replace(/(^|[.!?]\s+)And\s+/g, '$1');
  out = out.replace(/,\s*(was|were|is|are)\b/gi, ' $1');
  return out;
}

function applyHumanizerSentenceTransforms(text, hits, options = {}) {
  let out = text;
  const categories = new Set((hits || []).map((hit) => hit.category));
  const hitIds = new Set((hits || []).map((hit) => hit.id));
  const aggressive = Boolean(options.aggressive);
  const documentMode = DOCUMENT_MODE_LABELS[options.documentMode] ? options.documentMode : 'fiction';
  const narrativeMode = isNarrativeDocumentMode(documentMode);
  const marketingMode = documentMode === 'marketing';

  if (categories.has('communication')) {
    out = out.replace(/^(?:here'?s|here is)\s+(?:a|the)\s+(?:revised|updated)\s+version[:.]?\s*$/i, '');
    out = out.replace(/^let me know if you(?:'d| would) like[^.?!]*[.?!]?\s*$/i, '');
    out = out.replace(/\b(?:great|excellent|fantastic|brilliant)\s+question[,.!\s]*/gi, '');
    out = out.replace(/\b(?:you are absolutely right|excellent point)\b[,.!\s]*/gi, '');
    out = out.replace(/\b(?:here'?s|here is)\s+(?:a|the)\s+(?:revised|updated)\s+version:?/gi, '');
    out = out.replace(/\blet me know if you(?:'d| would) like[^.?!]*[.?!]*/gi, '');
    out = out.replace(/\bas an ai[^.?!]*[.?!]*/gi, '');
  }

  if (categories.has('hedging')) {
    out = out.replace(/\b(?:in many ways|in some ways|to some extent|arguably|it seems that|it appears that|may perhaps|can often)\b/gi, '');
    if (!narrativeMode) {
      out = out.replace(/\b(?:in conclusion|ultimately|there is no doubt that)\b/gi, '');
      out = out.replace(/\bserves as a reminder(?: that)?\b/gi, 'shows');
      out = out.replace(/\bthis highlights the importance of\b/gi, 'this shows');
      out = out.replace(/\bthis underscores the need for\b/gi, 'this shows');
    }
  }

  if (categories.has('style') || categories.has('language')) {
    out = out.replace(marketingMode ? /\b(?:world-class|breathtaking|stunning)\b/gi : /\b(?:world-class|breathtaking|stunning|vibrant|renowned)\b/gi, '');
    out = out.replace(/\bnestled within\b/gi, 'in');
    out = out.replace(/\brich cultural heritage\b/gi, 'history');
    out = out.replace(/\bdelve into\b/gi, 'examine');
    out = out.replace(/\bnavigate\b/gi, 'handle');
    out = out.replace(/\bshowcase\b/gi, 'show');
    out = out.replace(/\bleverage\b/gi, 'use');
    out = out.replace(/\bfoster\b/gi, 'build');
    out = out.replace(/\bunderscore\b/gi, 'show');
    if (!narrativeMode) {
      out = out.replace(/\bthe landscape of the story\b/gi, 'the story');
      out = out.replace(/\blandscape of the story\b/gi, 'story');
      out = out.replace(/\blandscape of\b/gi, '');
    }
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
    if (!narrativeMode || aggressive) {
      out = out.replace(/\s*—\s*/g, aggressive ? '. ' : ', ');
    }
  }

  if (categories.has('content') && !narrativeMode) {
    out = out.replace(/\b(?:plays a crucial role|vital role)\b/gi, 'role');
    out = out.replace(/\bimportant milestone\b/gi, 'milestone');
    if (hitIds.has('significance_inflation')) {
      out = out.replace(/\bpivotal moment\b/gi, 'turning point');
      out = out.replace(/\b(?:stands as a testament to|is a testament to)\b/gi, 'shows');
      out = out.replace(/\bmark(?:ing|s)? a significant step\b/gi, 'marking a shift');
    }
  }

  if (categories.has('structure')) {
    out = out.replace(/\b(?:on the one hand|on the other hand)\b/gi, '');
    out = out.replace(/\b(?:the key takeaway is that|what this means is|to put it simply)\b/gi, '');
  }

  if (categories.has('soul')) {
    out = out.replace(/\b(?:very|really|quite)\b/gi, '');
    out = out.replace(/\bthe kind of ([a-z]+) that\b/gi, 'the $1 that');
  }

  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\s+,/g, ',');
  out = out.replace(/,\s*,+/g, ', ');
  return out.trim();
}

function applyHumanizerParagraphTransforms(text, hits, options = {}) {
  let out = text;
  const categories = new Set((hits || []).map((hit) => hit.category));
  const aggressive = Boolean(options.aggressive);
  const documentMode = DOCUMENT_MODE_LABELS[options.documentMode] ? options.documentMode : 'fiction';
  const narrativeMode = isNarrativeDocumentMode(documentMode);

  if (!narrativeMode && (categories.has('hedging') || categories.has('structure'))) {
    out = out.replace(/(^|[.!?]\s+)(?:in conclusion|ultimately),?\s+/gi, '$1');
  }

  if (categories.has('style') && aggressive && !narrativeMode) {
    out = out.replace(/\s*—\s*/g, '. ');
  }

  if (!narrativeMode && categories.has('content')) {
    out = out.replace(/\bthis can be seen as\b/gi, 'this is');
  }

  return out.trim();
}

function replaceFirstOccurrence(source, target, replacement) {
  if (!target) return source;
  const index = source.indexOf(target);
  if (index === -1) return source;
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`;
}

function applyResidueAuditFixes(text, audit, settings) {
  if (!audit?.findings?.length) {
    return { text, appliedFixes: [] };
  }

  const strength = budgetIntensity(settings.budget) * modeIntensity(settings.mode);
  const aggressive = strength > 1.2;
  let output = text;
  const appliedFixes = [];

  audit.findings.forEach((finding) => {
    const excerpt = String(finding.excerpt || '').trim();
    if (!excerpt) return;
    let replacement = applyHumanizerSentenceTransforms(excerpt, [finding], {
      medium: true,
      aggressive,
      documentMode: settings.documentMode || 'fiction',
    });
    replacement = replacement.replace(/\bin a way that felt ([a-z]+)\b/gi, '$1');
    replacement = replacement.replace(/\bas if the ([a-z]+) itself was trying to\b/gi, 'as if the $1 meant to');
    replacement = replacement.replace(/\btrying to tell\b/gi, 'meant to tell');
    replacement = tightenProgressiveVerb(replacement);
    replacement = smoothSentenceEnding(replacement);
    replacement = finaliseRewriteText(replacement);

    const before = normalizeText(excerpt);
    const after = normalizeText(replacement);
    if (after === before) return;

    const updated = replaceFirstOccurrence(output, excerpt, replacement ? replacement : '');
    if (updated !== output) {
      output = updated;
      appliedFixes.push({
        category: finding.category,
        before: excerpt,
        after: replacement || '[removed]',
        priority: finding.priority || 'medium',
      });
    }
  });

  if (audit.findings.some((finding) => finding.category === 'communication')) {
    const cleaned = output
      .replace(/(^|\n\n)\s*(?:here'?s|here is)\s+(?:a|the)\s+(?:revised|updated)\s+version[:.]?\s*/gim, '$1')
      .replace(/\s*let me know if you(?:'d| would) like[^.?!]*[.?!]*/gi, '')
      .replace(/\s*as an ai[^.?!]*[.?!]*/gi, '');
    if (cleaned !== output) {
      output = cleaned;
      appliedFixes.push({
        category: 'communication',
        before: 'assistant framing',
        after: '[removed]',
        priority: 'high',
      });
    }
  }

  return {
    text: finaliseRewriteText(output),
    appliedFixes,
  };
}

function evaluateAcceptanceGate(originalMetrics, revisedMetrics, originalText, revisedText, settings, residueAudit) {
  const qualityDelta = (revisedMetrics?.qualityScore || 0) - (originalMetrics?.qualityScore || 0);
  const riskDelta = (originalMetrics?.detectorRisk || 0) - (revisedMetrics?.detectorRisk || 0);
  const humanizerDelta = (revisedMetrics?.humanizerScore || 0) - (originalMetrics?.humanizerScore || 0);
  const wordRatio = (revisedMetrics?.wordCount || 0) / Math.max(1, originalMetrics?.wordCount || 1);
  const sameText = normalizeText(originalText) === normalizeText(revisedText);
  const minWordRatio = settings.budget === 'aggressive' ? 0.35 : settings.budget === 'medium' ? 0.42 : 0.5;
  const reasons = [];

  if (sameText) {
    return {
      accepted: true,
      reverted: false,
      reasons: ['No material rewrite was needed.'],
    };
  }

  if (qualityDelta < -1.5) reasons.push('Quality dropped below the acceptance floor.');
  if (riskDelta < -0.5) reasons.push('Detector risk got worse after rewrite.');
  if (humanizerDelta < -0.5) reasons.push('Humanizer score regressed after rewrite.');
  if (wordRatio < minWordRatio && qualityDelta < 8 && humanizerDelta < 8) reasons.push('Rewrite cut too much material for the current edit budget.');
  if (qualityDelta < 0.5 && riskDelta < 0.5 && humanizerDelta < 0.5) reasons.push('Rewrite did not improve quality, risk, or Humanizer score enough to keep.');
  if (residueAudit?.status === 'residue-detected' && (residueAudit.findings || []).some((finding) => finding.priority === 'high') && humanizerDelta < 2) {
    reasons.push('High-priority residue remained after the second pass.');
  }

  return {
    accepted: reasons.length === 0,
    reverted: reasons.length > 0,
    reasons: reasons.length ? reasons : ['Rewrite cleared the acceptance gate.'],
  };
}

function collapseRepeatedLeadRun(sentences) {
  const merged = [];
  for (let index = 0; index < sentences.length; index += 1) {
    if (index + 2 < sentences.length) {
      const trio = sentences.slice(index, index + 3);
      const tokenised = trio.map((sentence) => tokenizeWords(sentence));
      const sharedLead = tokenised[0].slice(0, 2).join(' ');
      const isRepeat =
        sharedLead &&
        tokenised.every((tokens) => tokens.length >= 3 && tokens.slice(0, 2).join(' ').toLowerCase() === sharedLead.toLowerCase()) &&
        tokenised.every((tokens) => tokens.length <= 6);

      if (isRepeat) {
        const leadWords = tokenised[0].slice(0, 2).join(' ');
        const tails = trio.map((sentence) => tokenizeWords(sentence).slice(2).join(' ').replace(/[.?!]+$/, '').trim());
        merged.push(capitaliseSentence(`${leadWords} ${tails[0]}, then ${tails[1]}, then ${tails[2]}.`));
        index += 2;
        continue;
      }
    }
    merged.push(sentences[index]);
  }
  return merged;
}

function finaliseRewriteText(text) {
  let out = text;
  out = out.replace(/\s+([,.;!?])/g, '$1');
  out = out.replace(/,\s*,+/g, ', ');
  out = out.replace(/,\s*(was|were|is|are)\b/gi, ' $1');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\.\s+\./g, '.');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n +/g, '\n');
  out = out.replace(/ +\n/g, '\n');
  return capitaliseSentence(out.trim());
}

function rewriteSentence(sentence, settings) {
  let out = sentence.trim();
  const strength = budgetIntensity(settings.budget) * modeIntensity(settings.mode);
  const aggressive = strength > 1.2;
  const medium = strength >= 0.9;
  const documentMode = settings.documentMode || 'fiction';
  const narrativeMode = isNarrativeDocumentMode(documentMode);
  const humanizerHits = HUMANIZER_ENGINE.detectHumanizerPatterns(out, { mode: documentMode });
  const humanizerCategories = new Set(humanizerHits.map((hit) => hit.category));

  if (/^#{1,6}\s/.test(out)) return out;

  if (humanizerCategories.has('hedging') || humanizerCategories.has('communication')) {
    FILLER_PREFIXES.forEach((pattern) => {
      out = out.replace(pattern, '');
    });
  }

  const directReplacements = [
    ...(!narrativeMode ? [
      [/^(?:there is|there are)\s+/i, ''],
      [/^(?:there was|there were)\s+/i, ''],
    ] : []),
    [/\b(?:very|really|just|quite|basically|simply|actually|clearly|obviously|literally)\b/gi, ''],
    [/\b(?:in order to)\b/gi, 'to'],
    [/\b(?:due to the fact that)\b/gi, 'because'],
    [/\b(?:at this point in time)\b/gi, 'now'],
    [/\b(?:for the most part)\b/gi, 'mostly'],
    [/\b(?:kind of|sort of)\b/gi, ''],
    [/\b(?:a little bit)\b/gi, 'a little'],
    [/\b(?:the truth is|the reality is)\b/gi, ''],
  ];

  directReplacements.forEach(([pattern, replacement]) => {
    out = out.replace(pattern, replacement);
  });

  if (medium) {
    out = out.replace(/\s{2,}/g, ' ');
    out = out.replace(/\b(?:remarkably|significantly|particularly|especially|incredibly|extremely)\b/gi, '');
    if (!narrativeMode) {
      out = out.replace(/\b(?:moreover|furthermore|therefore|however)\b/gi, '');
    }
    out = out.replace(/\s+,/g, ',');
    out = out.replace(/,\s*,+/g, ', ');
  }

  if (aggressive && !narrativeMode) {
    out = out.replace(/\s*(?:and then|then)\s+/gi, ' ');
    out = out.replace(/\s*—\s*/g, '. ');
    out = out.replace(/;\s*/g, '. ');
    out = out.replace(/\b(?:felt a sense of|felt a wave of)\b/gi, 'felt');
    out = out.replace(/,\s+(he|she|they|we|i)\b/gi, '. $1');
  }

  out = applyHumanizerSentenceTransforms(out, humanizerHits, { medium, aggressive, documentMode });
  out = tightenProgressiveVerb(out);
  out = smoothSentenceEnding(out);
  out = out.replace(/\s+([,.;!?])/g, '$1');
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/^\s*[,:;.-]+\s*/, '');
  out = capitaliseSentence(out);
  return out || capitaliseSentence(sentence.trim());
}

function rewriteParagraph(paragraph, settings) {
  if (/^#{1,6}\s/.test(paragraph.trim())) return paragraph.trim();
  const documentMode = settings.documentMode || 'fiction';
  const paragraphHits = HUMANIZER_ENGINE.detectHumanizerPatterns(paragraph, { mode: documentMode });
  const sentences = splitSentences(paragraph);
  if (!sentences.length) return paragraph;
  const rewritten = sentences.map((sentence) => rewriteSentence(sentence, settings));
  const repaired = collapseRepeatedLeadRun(rewritten).map((sentence) => collapseRepeatedSubjectClause(sentence));
  let output = repaired.join(' ');
  output = applyHumanizerParagraphTransforms(output, paragraphHits, {
    aggressive: budgetIntensity(settings.budget) * modeIntensity(settings.mode) > 1.2,
    documentMode,
  });
  output = output.replace(/\bI am not\b/gi, "I'm not");
  output = output.replace(/\bdo not\b/gi, "don't");
  output = output.replace(/\bcannot\b/gi, "can't");
  output = output.replace(/(^|[.!?]\s+)And\s+/g, '$1');
  return finaliseRewriteText(output);
}

function rewriteText(text, settings, sampleProfile = null) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return text;

  const rewritten = paragraphs.map((paragraph) => rewriteParagraph(paragraph, settings));
  let output = rewritten.join('\n\n');

  if (sampleProfile) {
    const profile = sampleProfile;
    const avgSentence = profile.avgSentence * 30;
    if (settings.mode !== 'preserve' && avgSentence < 15) {
      output = output.replace(/([,;])\s+/g, '$1 ');
      output = output.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');
    }
    if (profile.contractionRate > 0.25) {
      output = output
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bdoes not\b/gi, "doesn't")
        .replace(/\bcannot\b/gi, "can't");
    }
  }

  return finaliseRewriteText(output);
}

function buildTargetProfile(batch, batchProfile) {
  const sampleText = normalizeText(batch.settings.voiceSampleText || '');
  const sampleProfile = sampleText
    ? profileFromVector(vectorizeText(sampleText, { mode: batch.settings.documentMode }))
    : null;
  const weights = targetWeights(batch.settings.mode);

  switch (batch.settings.voiceMode) {
    case 'batch_only':
      return batchProfile;
    case 'voice_pack_only':
      return sampleProfile || batchProfile;
    case 'hybrid':
      return blendProfiles(batchProfile, sampleProfile, weights.target);
    case 'frozen_project_voice':
      return sampleProfile || batchProfile;
    default:
      return batchProfile;
  }
}

function voiceAssessment(docProfile, batchProfile, targetProfile, batch) {
  const batchDistance = profileDistance(docProfile, batchProfile);
  const targetDistance = profileDistance(docProfile, targetProfile);
  const weights = targetWeights(batch.settings.mode);
  const targetSimilarity = clamp(100 - targetDistance * 160, 0, 100);
  const batchSimilarity = clamp(100 - batchDistance * 160, 0, 100);
  const score = clamp(targetSimilarity * weights.target + batchSimilarity * weights.batch, 0, 100);
  return {
    score,
    batchSimilarity,
    targetSimilarity,
    batchDistance,
    targetDistance,
  };
}

function computeBatchSummary(batch) {
  const docs = batch.docs.filter((doc) => doc.originalMetrics && doc.revisedMetrics);
  const qualityDelta = mean(docs.map((doc) => doc.delta?.qualityDelta || 0));
  const riskDelta = mean(docs.map((doc) => doc.delta?.riskDelta || 0));
  const humanizerDelta = mean(docs.map((doc) => doc.delta?.humanizerDelta || 0));
  const voiceVariance = mean(docs.map((doc) => doc.voice?.batchDistance || 0)) * 100;
  const targetGap = mean(docs.map((doc) => doc.voice?.targetDistance || 0)) * 100;
  const outliers = docs.filter((doc) => doc.outlier).length;
  const approved = docs.filter((doc) => doc.reviewState === 'approved').length;
  const rejected = docs.filter((doc) => doc.reviewState === 'rejected').length;
  const revisedHumanizerScore = mean(docs.map((doc) => doc.revisedMetrics?.humanizerScore || 0));
  const humanizerCategoryTotals = {};
  const residueAlerts = docs.filter((doc) => doc.residueAudit?.accepted && (doc.residueAudit?.finalFindings?.length || 0) > 0).length;
  const gateReverts = docs.filter((doc) => doc.acceptance?.reverted).length;

  docs.forEach((doc) => {
    Object.entries(doc.revisedMetrics?.humanizerCategoryTotals || {}).forEach(([category, count]) => {
      humanizerCategoryTotals[category] = (humanizerCategoryTotals[category] || 0) + count;
    });
  });

  const topHumanizerCategories = Object.entries(humanizerCategoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));

  batch.summary = {
    documentCount: batch.docs.length,
    analysedCount: docs.length,
    qualityDelta,
    riskDelta,
    humanizerDelta,
    voiceVariance,
    targetGap,
    outliers,
    approved,
    rejected,
    revisedHumanizerScore,
    topHumanizerCategories,
    residueAlerts,
    gateReverts,
  };
}

async function runBatch(batch, onlyDocIds = null) {
  if (!batch || state.busy) return;
  state.busy = true;
  batch.status = 'running';
  batch.progress = 0;
  renderAll();

  const docs = onlyDocIds
    ? batch.docs.filter((doc) => onlyDocIds.includes(doc.id))
    : batch.docs;

  const sampleProfile = batch.settings.voiceSampleText
    ? profileFromVector(vectorizeText(batch.settings.voiceSampleText, { mode: batch.settings.documentMode }))
    : null;

  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];
    const docMode = effectiveDocumentMode(doc, batch);
    const docSettings = { ...batch.settings, documentMode: docMode };
    if (doc.sourceType !== 'text' || !doc.originalText.trim()) {
      doc.status = 'blocked';
      doc.warning = doc.warning || 'No in-browser text available for analysis.';
      batch.progress = Math.round(((index + 1) / docs.length) * 100);
      renderAll();
      await sleep(25);
      continue;
    }

    doc.status = 'processing';
    doc.warning = '';
    renderAll();
    await sleep(30);

    doc.originalText = normalizeText(doc.originalText);
    doc.originalMetrics = vectorizeText(doc.originalText, { mode: docMode });
    doc.originalProfile = profileFromVector(doc.originalMetrics);
    doc.annotations = buildAnnotations(doc.originalText, { mode: docMode });
    let candidateText = rewriteText(doc.originalText, docSettings, sampleProfile);
    let candidateMetrics = vectorizeText(candidateText, { mode: docMode });
    const initialResidue = HUMANIZER_ENGINE.auditResidualAISignals(candidateText, {
      metrics: candidateMetrics,
      mode: docMode,
    });
    const residuePass = initialResidue.requiresSecondPass
      ? applyResidueAuditFixes(candidateText, initialResidue, docSettings)
      : { text: candidateText, appliedFixes: [] };

    if (normalizeText(residuePass.text) !== normalizeText(candidateText)) {
      candidateText = residuePass.text;
      candidateMetrics = vectorizeText(candidateText, { mode: docMode });
    }

    const finalResidue = HUMANIZER_ENGINE.auditResidualAISignals(candidateText, {
      metrics: candidateMetrics,
      mode: docMode,
    });
    const acceptance = evaluateAcceptanceGate(
      doc.originalMetrics,
      candidateMetrics,
      doc.originalText,
      candidateText,
      docSettings,
      finalResidue,
    );

    doc.acceptance = acceptance;
    doc.appliedDocumentMode = docMode;
    doc.residueAudit = {
      requiresSecondPass: initialResidue.requiresSecondPass,
      initialHitCount: initialResidue.hitCount,
      finalHitCount: finalResidue.hitCount,
      initialFindings: initialResidue.findings,
      finalFindings: finalResidue.findings,
      topCategories: finalResidue.topCategories,
      appliedFixes: residuePass.appliedFixes,
      improved: finalResidue.hitCount < initialResidue.hitCount || residuePass.appliedFixes.length > 0,
      accepted: acceptance.accepted,
      reverted: acceptance.reverted,
      reasons: acceptance.reasons,
      mode: docMode,
    };

    if (acceptance.accepted) {
      doc.revisedText = candidateText;
      doc.revisedMetrics = candidateMetrics;
      doc.revisedProfile = profileFromVector(doc.revisedMetrics);
      if ((finalResidue.findings || []).length > 0) {
        doc.warning = appendWarning(doc.warning, `${finalResidue.findings.length} residue finding${finalResidue.findings.length === 1 ? '' : 's'} remain after the second pass.`);
      }
    } else {
      doc.revisedText = doc.originalText;
      doc.revisedMetrics = doc.originalMetrics;
      doc.revisedProfile = doc.originalProfile;
      doc.warning = appendWarning(doc.warning, acceptance.reasons[0]);
    }

    doc.delta = {
      qualityDelta: doc.revisedMetrics.qualityScore - doc.originalMetrics.qualityScore,
      riskDelta: doc.originalMetrics.detectorRisk - doc.revisedMetrics.detectorRisk,
      humanizerDelta: doc.revisedMetrics.humanizerScore - doc.originalMetrics.humanizerScore,
      wordDelta: doc.revisedMetrics.wordCount - doc.originalMetrics.wordCount,
      sentenceDelta: doc.revisedMetrics.sentenceCount - doc.originalMetrics.sentenceCount,
    };
    doc.status = 'complete';
    doc.reviewState = doc.reviewState === 'approved' || doc.reviewState === 'rejected'
      ? doc.reviewState
      : 'pending';
    doc.reruns += 0;
    batch.progress = Math.round(((index + 1) / docs.length) * 100);
    renderAll();
    await sleep(30);
  }

  const analysedDocs = batch.docs.filter((doc) => doc.revisedProfile);
  batch.batchProfile = centroid(analysedDocs.map((doc) => doc.revisedProfile));
  batch.targetProfile = buildTargetProfile(batch, batch.batchProfile);

  analysedDocs.forEach((doc) => {
    doc.voice = voiceAssessment(doc.revisedProfile, batch.batchProfile, batch.targetProfile, batch);
    doc.outlier = doc.voice.score < batch.settings.threshold || doc.voice.batchDistance > 0.22;
    if (doc.reviewState !== 'approved' && doc.reviewState !== 'rejected') {
      doc.reviewState = doc.outlier ? 'needs-review' : 'pending';
    }
  });

  computeBatchSummary(batch);
  batch.status = 'complete';
  batch.progress = 100;
  batch.updatedAt = Date.now();
  state.busy = false;

  if (!batch.docs.some((doc) => doc.id === state.activeDocId)) {
    state.activeDocId = batch.docs[0]?.id || null;
  }
  renderAll();
  saveSoon();
}

async function rerunDoc(batch, docId, budget = null) {
  if (!batch || state.busy) return;
  const doc = batch.docs.find((item) => item.id === docId);
  if (!doc || doc.sourceType !== 'text' || !doc.originalText.trim()) return;
  const previousBudget = batch.settings.budget;
  if (budget) batch.settings.budget = budget;
  doc.reruns += 1;
  doc.reviewState = 'pending';
  await runBatch(batch, [doc.id]);
  batch.settings.budget = previousBudget;
  renderAll();
}

function setDocModeOverride(batch, docId, overrideMode) {
  if (!batch) return;
  const doc = batch.docs.find((item) => item.id === docId);
  if (!doc) return;
  doc.modeOverride = DOCUMENT_MODE_LABELS[overrideMode] ? overrideMode : '';
  if (doc.reviewState === 'approved') {
    doc.reviewState = 'pending';
  }
  batch.updatedAt = Date.now();
  renderAll();
  saveSoon();
}

function markDoc(batch, docId, stateValue) {
  if (!batch) return;
  const doc = batch.docs.find((item) => item.id === docId);
  if (!doc) return;
  doc.reviewState = stateValue;
  if (stateValue === 'approved') doc.outlier = false;
  if (stateValue === 'rejected') doc.outlier = true;
  renderAll();
  saveSoon();
}

function markAll(batch, stateValue) {
  if (!batch) return;
  batch.docs.forEach((doc) => {
    if (doc.status !== 'blocked') {
      doc.reviewState = stateValue;
      if (stateValue === 'approved') doc.outlier = false;
    }
  });
  renderAll();
  saveSoon();
}

function rerunOutliers(batch) {
  if (!batch || state.busy) return;
  const outlierDocs = batch.docs.filter((doc) => doc.outlier && doc.status !== 'blocked').map((doc) => doc.id);
  if (!outlierDocs.length) return;
  runBatch(batch, outlierDocs);
}

function removeAllDocs(batch) {
  if (!batch) return;
  batch.docs = [];
  batch.status = 'empty';
  batch.progress = 0;
  batch.summary = null;
  batch.batchProfile = null;
  batch.targetProfile = null;
  state.activeDocId = null;
  renderAll();
  saveSoon();
}

function addFilesToBatch(files, batch = activeBatch()) {
  if (!batch) {
    batch = makeEmptyBatch('Imported batch');
    addBatch(batch);
  }

  const incoming = Array.from(files || []);
  if (!incoming.length) return;

  const existingNames = new Set(batch.docs.map((doc) => doc.name.toLowerCase()));
  const textFiles = incoming.filter((file) => /\.(md|txt)$/i.test(file.name));
  const unsupported = incoming.filter((file) => !/\.(md|txt)$/i.test(file.name));

  textFiles.forEach((file) => {
    if (existingNames.has(file.name.toLowerCase())) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      batch.docs.push(createDoc(file.name, event.target.result, 'text'));
      batch.status = 'idle';
      state.activeDocId = batch.docs[batch.docs.length - 1]?.id || state.activeDocId;
      renderAll();
      saveSoon();
    };
    reader.readAsText(file);
  });

  unsupported.forEach((file) => {
    if (existingNames.has(file.name.toLowerCase())) return;
    batch.docs.push({
      ...createDoc(file.name, '', 'unsupported'),
      warning: 'This alpha imports Markdown and plain text directly. Convert this file to `.md` or `.txt` first.',
    });
  });

  if (unsupported.length || textFiles.length) {
    batch.status = 'idle';
    batch.updatedAt = Date.now();
    if (!state.activeDocId && batch.docs[0]) state.activeDocId = batch.docs[0].id;
    renderAll();
    saveSoon();
  }
}

function addPastedSample(batch) {
  if (!batch) return;
  const text = normalizeText($(CONTROL_IDS.voiceSample).value);
  if (!text) return;
  const name = `voice-sample-${batch.docs.length + 1}.md`;
  batch.docs.push(createDoc(name, text, 'text'));
  batch.status = 'idle';
  state.activeDocId = batch.docs[batch.docs.length - 1].id;
  renderAll();
  saveSoon();
}

function humanizeDuration(dateValue) {
  const started = new Date(dateValue);
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(started);
}

function renderBatchList() {
  const container = $('batchList');
  if (!state.batches.length) {
    container.innerHTML = `
      <div class="batch-card">
        <div class="batch-name">No batches yet</div>
        <div class="batch-meta">Create a batch or load the demo set to start reviewing score deltas and voice consistency.</div>
        <div class="batch-stats">
          <span class="badge info">Empty workspace</span>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.batches.map((batch) => {
    const summary = batch.summary || {};
    const statusBadge = batch.status === 'running'
      ? '<span class="badge info">Running</span>'
      : batch.status === 'complete'
        ? '<span class="badge good">Complete</span>'
        : batch.status === 'empty'
          ? '<span class="badge warn">Empty</span>'
          : '<span class="badge">Idle</span>';
    return `
      <button class="batch-card ${batch.id === state.activeBatchId ? 'is-active' : ''}" data-action="select-batch" data-batch-id="${batch.id}">
        <div class="batch-card-top">
          <div class="batch-name">${escapeHtml(batch.name)}</div>
          ${statusBadge}
        </div>
        <div class="batch-meta">${batch.docs.length} doc${batch.docs.length === 1 ? '' : 's'} · updated ${humanizeDuration(batch.updatedAt)}</div>
        <div class="batch-stats">
          <span class="badge ${summary.qualityDelta > 0 ? 'good' : summary.qualityDelta < 0 ? 'danger' : ''}">ΔQ ${formatSigned(summary.qualityDelta || 0, 1)}</span>
          <span class="badge ${summary.riskDelta > 0 ? 'good' : summary.riskDelta < 0 ? 'danger' : ''}">ΔRisk ${formatSigned(summary.riskDelta || 0, 1)}</span>
          <span class="badge ${summary.outliers > 0 ? 'warn' : 'good'}">${summary.outliers || 0} outlier${(summary.outliers || 0) === 1 ? '' : 's'}</span>
        </div>
      </button>
    `;
  }).join('');
}

function renderEmptyWorkspace() {
  $('workspaceStatus').textContent = 'Ready';
  $('workspaceCounts').textContent = '0 documents';
  $('batchTitle').textContent = 'Start with a batch';
  $('batchDescription').textContent = 'Import Markdown or text files, run the batch once, then review what changed in a calmer, single-document flow.';
  $('heroMetrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Did it run?</div>
      <div class="metric-value">Not yet</div>
      <div class="metric-note">No batch has been processed yet.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">What changed</div>
      <div class="metric-value">Awaiting run</div>
      <div class="metric-note">Score deltas and revised drafts appear after the first run.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">What next</div>
      <div class="metric-value">Import files</div>
      <div class="metric-note">Drag in `.md` or `.txt` files, or load the demo batch with one click.</div>
    </div>
  `;
  $('batchBadges').innerHTML = `
    <span class="badge">No active batch</span>
    <span class="badge info">Awaiting documents</span>
  `;
  $('summaryGrid').innerHTML = `
    <div class="summary-card">
      <div class="metric-label">Batch jobs</div>
      <div class="summary-value">0</div>
      <div class="summary-sub">Create a workspace to track a run from ingestion through export.</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Score deltas</div>
      <div class="summary-value">-</div>
      <div class="summary-sub">Quality, detector risk, and voice changes will appear after the first run.</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Voice consistency</div>
      <div class="summary-value">-</div>
      <div class="summary-sub">Choose batch-only, house voice, hybrid, or frozen series mode.</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Export</div>
      <div class="summary-value">Ready</div>
      <div class="summary-sub">Bundle reports, revised documents, and diffs into a zip export.</div>
    </div>
  `;
  $('docTable').innerHTML = `
    <div class="empty-state" style="min-height:320px;">
      <div>
        <h3>No documents loaded</h3>
        <p>Use the drop zone on the left to import a batch, or create a demo workspace to see a full run, review, and export flow.</p>
        <div class="button-row">
          <button class="btn btn-primary" data-action="new-sample">Load demo batch</button>
          <button class="btn" data-action="create-batch">New batch</button>
        </div>
      </div>
    </div>
  `;
  $('docQueueHint').textContent = 'Load files to build the review queue.';
  $('docInspector').innerHTML = `
    <div class="empty-state" style="min-height:460px;">
      <div>
        <h3>Document review will appear here</h3>
        <p>Pick a document to compare original vs revised text, inspect diffs, review voice drift, and approve or reject changes.</p>
      </div>
    </div>
  `;
  $('docTitle').textContent = 'Select a document';
  $('docBadges').innerHTML = '';
  $('exportPanel').innerHTML = `
    <div class="export-card">
      <div>
        <strong>Nothing to export yet</strong>
        <span>Once a batch is processed, export options will generate CSV, JSON, markdown, and a zip bundle.</span>
      </div>
      <span class="badge">Waiting</span>
    </div>
  `;
}

function renderSummaryGrid(batch) {
  const summary = batch.summary || {};
  const outcome = buildBatchOutcome(batch);
  const modeMeta = documentModeMeta(batch.settings.documentMode);
  const overrideCount = batch.docs.filter((doc) => doc.modeOverride).length;
  const avgQuality = outcome.processed
    ? mean(batch.docs.filter((doc) => doc.revisedMetrics).map((doc) => doc.revisedMetrics.qualityScore))
    : 0;
  const avgRisk = outcome.processed
    ? mean(batch.docs.filter((doc) => doc.revisedMetrics).map((doc) => doc.revisedMetrics.detectorRisk))
    : 0;
  const avgHumanizer = outcome.processed
    ? mean(batch.docs.filter((doc) => doc.revisedMetrics).map((doc) => doc.revisedMetrics.humanizerScore))
    : 0;
  const topCategories = formatCategoryList(summary.topHumanizerCategories || []);

  $('summaryGrid').innerHTML = `
    <div class="summary-card">
      <div class="metric-label">Processed</div>
      <div class="summary-value">${outcome.processed}/${outcome.totalDocs}</div>
      <div class="summary-sub">${batch.status === 'running' ? 'Run in progress' : 'Batch ready'} · ${outcome.changed} materially changed · ${outcome.approved} approved</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Humanizer delta</div>
      <div class="summary-value ${outcome.processed ? (summary.humanizerDelta || 0) >= 0 ? 'good' : 'danger' : ''}">${outcome.processed ? formatSigned(summary.humanizerDelta || 0, 1) : 'Awaiting run'}</div>
      <div class="summary-sub">${outcome.processed ? `Avg revised ${formatNumber(avgHumanizer, 1)} / 100${topCategories ? ` · top patterns ${topCategories}` : ''} · ${modeMeta.label} mode · ${summary.residueAlerts || 0} residue alert${(summary.residueAlerts || 0) === 1 ? '' : 's'}` : 'Run the batch to generate revised drafts and Humanizer scoring.'}</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Priority review</div>
      <div class="summary-value ${outcome.processed ? outcome.priorityReview ? 'warn' : 'good' : ''}">${outcome.processed ? outcome.priorityReview : 'Run first'}</div>
      <div class="summary-sub">${outcome.processed ? `${outcome.pendingReview} still pending overall · ${summary.gateReverts || 0} kept original by gate · avg risk ${formatSigned(summary.riskDelta || 0, 1)}` : 'Review starts after the first run completes.'}</div>
    </div>
    <div class="summary-card">
      <div class="metric-label">Voice check</div>
      <div class="summary-value ${outcome.processed ? outcome.outliers ? 'warn' : 'good' : ''}">${outcome.processed ? outcome.outliers ? `${outcome.outliers} outlier${outcome.outliers === 1 ? '' : 's'}` : 'In band' : 'Awaiting run'}</div>
      <div class="summary-sub">${outcome.processed ? `Avg voice ${formatNumber(outcome.avgVoice, 0)} · threshold ${batch.settings.threshold} · ${overrideCount} override${overrideCount === 1 ? '' : 's'} active · revised quality ${formatNumber(avgQuality, 1)} / 100 · risk ${formatNumber(avgRisk, 1)} / 100` : 'Voice scoring appears after the batch has been processed.'}</div>
    </div>
  `;
}

function renderHero(batch) {
  const outcome = buildBatchOutcome(batch);
  const documentModeBadge = batchDocumentModeBadge(batch);

  $('batchTitle').textContent = batch.name;
  $('batchDescription').textContent = `${outcome.description} ${outcome.nextStep}`;
  $('workspaceStatus').textContent = batch.status === 'running'
    ? 'Running'
    : batch.status === 'complete'
      ? 'Complete'
      : batch.status === 'empty'
        ? 'Empty'
        : 'Ready';
  $('workspaceCounts').textContent = batch.docs.length
    ? outcome.processed
      ? `${outcome.processed}/${outcome.totalDocs} processed · ${outcome.priorityReview} priority review`
      : `${outcome.totalDocs} loaded · not yet run`
    : '0 documents';
  $('heroMetrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Did it run?</div>
      <div class="metric-value">${outcome.runValue}</div>
      <div class="metric-note">${outcome.runNote}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">What changed</div>
      <div class="metric-value ${outcome.changed ? 'good' : 'warn'}">${outcome.changeValue}</div>
      <div class="metric-note">${outcome.changeNote}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">What next</div>
      <div class="metric-value ${outcome.outliers ? 'warn' : outcome.processed ? 'good' : ''}">${outcome.nextValue}</div>
      <div class="metric-note">${outcome.nextStep}</div>
    </div>
  `;
  $('batchBadges').innerHTML = `
    <span class="badge ${outcome.badgeClass}">${escapeHtml(outcome.badgeLabel)}</span>
    <span class="badge">${escapeHtml(MODE_LABELS[batch.settings.mode] || batch.settings.mode)}</span>
    <span class="badge">${escapeHtml(BUDGET_LABELS[batch.settings.budget] || batch.settings.budget)}</span>
    <span class="badge info">${escapeHtml(documentModeBadge)}</span>
    <span class="badge">${escapeHtml(VOICE_SOURCE_LABELS[batch.settings.voiceMode] || batch.settings.voiceMode)}</span>
  `;
}

function renderDocTable(batch) {
  const container = $('docTable');
  if (!batch.docs.length) {
    $('docQueueHint').textContent = 'Drop in documents to build the review queue.';
    container.innerHTML = `
      <div class="empty-state" style="min-height:320px;">
        <div>
          <h3>This batch is empty</h3>
          <p>Drop in documents to populate the queue, then run the batch to generate score deltas and voice checks.</p>
        </div>
      </div>
    `;
    return;
  }

  const outcome = buildBatchOutcome(batch);
  $('docQueueHint').textContent = outcome.processed
    ? `${outcome.priorityReview} priority review item${outcome.priorityReview === 1 ? '' : 's'} in this batch. Click any row to open the full document view.`
    : 'Files are loaded. Run the batch to generate revised drafts and score deltas.';

  container.innerHTML = batch.docs.map((doc, index) => {
    const display = docDisplayState(doc, batch);
    const active = doc.id === state.activeDocId;
    const docOutcome = buildDocOutcome(doc, batch);
    const modeMeta = documentModeMeta(docOutcome.currentMode);
    const modePendingChip = docOutcome.modePending ? `<span class="doc-chip is-warn">Rerun for ${escapeHtml(modeMeta.label)}</span>` : '';
    const metricChips = docOutcome.processed
      ? `
        <span class="doc-chip ${docOutcome.material ? 'is-good' : docOutcome.touched ? 'is-info' : 'is-warn'}">${escapeHtml(docOutcome.changeLabel)}</span>
        <span class="doc-chip ${docOutcome.humanizerDelta >= 0 ? 'is-good' : 'is-danger'}">Humanizer ${formatSigned(docOutcome.humanizerDelta, 1)}</span>
        <span class="doc-chip ${docOutcome.qualityDelta >= 0 ? 'is-good' : 'is-danger'}">Quality ${formatSigned(docOutcome.qualityDelta, 1)}</span>
        <span class="doc-chip ${docOutcome.riskDelta >= 0 ? 'is-good' : 'is-danger'}">Risk ${formatSigned(docOutcome.riskDelta, 1)}</span>
        <span class="doc-chip ${docOutcome.thresholdClass}">Voice ${Math.round(docOutcome.voiceScore)}</span>
        <span class="doc-chip">${escapeHtml(modeMeta.label)}</span>
        ${modePendingChip}
      `
      : `
        <span class="doc-chip">Waiting to run</span>
        <span class="doc-chip">${escapeHtml(modeMeta.label)}</span>
      `;
    return `
      <div class="doc-row ${active ? 'is-active' : ''}" data-action="select-doc" data-doc-id="${doc.id}">
        <div class="doc-main">
          <div class="doc-name">
            <strong>${escapeHtml(`${String(index + 1).padStart(2, '0')} · ${doc.name}`)}</strong>
            <span class="badge ${display.cls}">${display.label}</span>
          </div>
          <div class="doc-sub">${escapeHtml(docOutcome.summary)}</div>
          <div class="doc-meta-row">
            <span>${docOutcome.processed ? `${docOutcome.words} words · ${docOutcome.sentences} sentences` : 'Not yet analysed'}</span>
            ${doc.warning ? `<span>${escapeHtml(doc.warning)}</span>` : ''}
          </div>
          <div class="doc-chip-row">${metricChips}</div>
        </div>
        <div class="doc-row-cta">
          <span class="mini-btn">${docOutcome.processed ? active ? 'Reviewing' : 'Open review' : 'Waiting to run'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderInspector(batch = activeBatch()) {
  const doc = activeDoc(batch);
  if (!doc) {
    $('docTitle').textContent = 'Select a document';
    $('docBadges').innerHTML = '';
    $('docInspector').innerHTML = `
      <div class="empty-state" style="min-height:460px;">
        <div>
          <h3>Nothing selected</h3>
          <p>Pick a document from the queue to inspect original text, revised text, diff output, and voice alignment.</p>
        </div>
      </div>
    `;
    return;
  }

  $('docTitle').textContent = doc.name;
  const display = docDisplayState(doc, batch);
  const docOutcome = buildDocOutcome(doc, batch);
  const qualityDelta = docOutcome.qualityDelta;
  const riskDelta = docOutcome.riskDelta;
  const voiceScore = docOutcome.voiceScore;
  const originalQuality = doc.originalMetrics?.qualityScore || 0;
  const revisedQuality = doc.revisedMetrics?.qualityScore || 0;
  const originalRisk = doc.originalMetrics?.detectorRisk || 0;
  const revisedRisk = doc.revisedMetrics?.detectorRisk || 0;
  const originalHumanizer = doc.originalMetrics?.humanizerScore || 0;
  const revisedHumanizer = doc.revisedMetrics?.humanizerScore || 0;
  const originalHitCount = doc.originalMetrics?.humanizerHitCount || 0;
  const revisedHitCount = doc.revisedMetrics?.humanizerHitCount || 0;
  const wordDelta = doc.delta?.wordDelta || 0;
  const sentenceDelta = doc.delta?.sentenceDelta || 0;
  const visibleAnnotations = (doc.annotations || []).slice(0, 3);
  const hiddenAnnotationCount = Math.max(0, (doc.annotations || []).length - visibleAnnotations.length);
  const topCategories = formatCategoryList(doc.revisedMetrics?.humanizerTopCategories || []);
  const modeMeta = documentModeMeta(docOutcome.currentMode);
  const appliedModeMeta = documentModeMeta(doc.appliedDocumentMode || batch.settings.documentMode);
  const categoryBadges = (doc.revisedMetrics?.humanizerTopCategories || []).length
    ? doc.revisedMetrics.humanizerTopCategories.map((item) => `<span class="badge info">${escapeHtml(titleCaseToken(item.category))} ${item.count}</span>`).join('')
    : '<span class="badge">No strong pattern cluster</span>';
  const residueAudit = doc.residueAudit || {
    requiresSecondPass: false,
    initialHitCount: 0,
    finalHitCount: 0,
    initialFindings: [],
    finalFindings: [],
    appliedFixes: [],
    accepted: true,
    reverted: false,
    reasons: [],
  };
  const residueFindingBadges = residueAudit.finalFindings.length
    ? residueAudit.finalFindings.slice(0, 3).map((finding) => `<span class="badge ${finding.priority === 'high' ? 'warn' : 'info'}">${escapeHtml(titleCaseToken(finding.category))}</span>`).join('')
    : '<span class="badge good">No high-priority residue</span>';
  const residueAuditSummary = residueAudit.reverted
    ? (residueAudit.reasons[0] || 'The acceptance gate kept the original.')
    : residueAudit.finalFindings.length
      ? 'The second pass reduced the obvious residue, but some synthetic traces still remain.'
      : 'The second pass cleared the visible residue findings.';

  $('docBadges').innerHTML = `
    <span class="badge ${display.cls}">${display.label}</span>
    <span class="badge ${docOutcome.changeClass}">${escapeHtml(docOutcome.changeLabel)}</span>
    <span class="badge ${docOutcome.humanizerDelta >= 0 ? 'good' : 'danger'}">Humanizer ${formatSigned(docOutcome.humanizerDelta, 1)}</span>
    <span class="badge info">${escapeHtml(modeMeta.badgeLabel)}</span>
    <span class="badge ${voiceScore >= batch.settings.threshold ? 'good' : 'warn'}">Voice ${Math.round(voiceScore)}</span>
  `;

  const annotationsHtml = visibleAnnotations.length
    ? visibleAnnotations.map((annotation) => `
        <div class="inspector-card">
          <div class="detail-meta">
            <span class="badge info">${escapeHtml(annotation.type)}</span>
          </div>
          <div class="detail-text">${escapeHtml(annotation.original)}</div>
          <div class="summary-sub">${escapeHtml(annotation.reason)}</div>
        </div>
      `).join('')
    : `
      <div class="inspector-card">
        <div class="detail-text">No high-signal annotations were generated for this document.</div>
        <div class="summary-sub">That usually means the passage is already fairly clean, or the batch contains more subtle issues than the local heuristics can label confidently.</div>
      </div>
    `;

  const notesInput = `
    <label class="field" style="margin: 0 0 10px;">
      <span>Document mode override</span>
      <select data-action="doc-mode-override" data-doc-id="${doc.id}">
        <option value="">Use batch default (${escapeHtml(DOCUMENT_MODE_LABELS[batch.settings.documentMode] || batch.settings.documentMode)})</option>
        ${Object.entries(DOCUMENT_MODE_LABELS).map(([value, label]) => `<option value="${value}" ${doc.modeOverride === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
      </select>
      <small class="field-help">${doc.modeOverride ? `This file overrides the batch default and will run in ${escapeHtml(modeMeta.label)} mode.` : 'Use this when one file in the batch needs a different prose policy from the rest.'}</small>
    </label>
    <label class="field" style="margin: 0;">
      <span>Review notes</span>
      <textarea rows="4" data-action="doc-notes" data-doc-id="${doc.id}" placeholder="Add reviewer context, rewrite guidance, or a reason for rejection.">${escapeHtml(doc.notes || '')}</textarea>
    </label>
  `;

  const actionBar = `
    <div class="button-row button-row-compact" style="margin: 0;">
      <button class="btn btn-primary" data-action="doc-approve" data-doc-id="${doc.id}">Approve</button>
      <button class="btn" data-action="doc-reject" data-doc-id="${doc.id}">Reject</button>
    </div>
    <div class="button-row button-row-compact" style="margin: 10px 0 0;">
      <button class="btn" data-action="doc-rerun" data-doc-id="${doc.id}" data-budget="minimal">Rerun minimal</button>
      <button class="btn" data-action="doc-rerun" data-doc-id="${doc.id}" data-budget="medium">Rerun medium</button>
      <button class="btn" data-action="doc-rerun" data-doc-id="${doc.id}" data-budget="aggressive">Rerun aggressive</button>
    </div>
  `;

  const contentByTab = {
    overview: `
      <div class="inspector-card inspector-lead">
        <h3 class="detail-title">What happened</h3>
        <div class="detail-summary">${escapeHtml(docOutcome.summary)}</div>
        <div class="summary-sub">${escapeHtml(docOutcome.nextStep)}${topCategories ? ` Top pattern categories: ${escapeHtml(topCategories)}.` : ''}</div>
      </div>
      <div class="inspector-grid">
        <div class="inspector-card">
          <h3 class="detail-title">Score changes</h3>
          <div class="profile-list">
            <div class="profile-row">
              <div class="profile-row-head"><span>Humanizer</span><span>${formatNumber(originalHumanizer, 1)} → ${formatNumber(revisedHumanizer, 1)}</span></div>
              <div class="profile-bar"><div class="profile-fill" style="width:${clamp(revisedHumanizer, 0, 100)}%"></div></div>
            </div>
            <div class="profile-row">
              <div class="profile-row-head"><span>Quality</span><span>${formatNumber(originalQuality, 1)} → ${formatNumber(revisedQuality, 1)}</span></div>
              <div class="profile-bar"><div class="profile-fill" style="width:${clamp(revisedQuality, 0, 100)}%"></div></div>
            </div>
            <div class="profile-row">
              <div class="profile-row-head"><span>Detector risk</span><span>${formatNumber(originalRisk, 1)} → ${formatNumber(revisedRisk, 1)}</span></div>
              <div class="profile-bar"><div class="profile-fill" style="width:${clamp(100 - revisedRisk, 0, 100)}%"></div></div>
            </div>
            <div class="profile-row">
              <div class="profile-row-head"><span>Word count</span><span>${doc.originalMetrics?.wordCount || 0} → ${doc.revisedMetrics?.wordCount || 0}</span></div>
              <div class="profile-bar"><div class="profile-fill" style="width:${clamp(100 - Math.abs(wordDelta) * 4, 12, 100)}%"></div></div>
            </div>
            <div class="profile-row">
              <div class="profile-row-head"><span>Sentence count</span><span>${doc.originalMetrics?.sentenceCount || 0} → ${doc.revisedMetrics?.sentenceCount || 0}</span></div>
              <div class="profile-bar"><div class="profile-fill" style="width:${clamp(100 - Math.abs(sentenceDelta) * 10, 12, 100)}%"></div></div>
            </div>
          </div>
        </div>
        <div class="inspector-card">
          <h3 class="detail-title">Pattern categories</h3>
          <div class="detail-meta">
            <span class="badge ${revisedHitCount <= originalHitCount ? 'good' : 'warn'}">Hits ${originalHitCount} → ${revisedHitCount}</span>
            ${categoryBadges}
          </div>
          <div class="summary-sub">These are the Humanizer categories still most visible in the revised document.</div>
        </div>
        <div class="inspector-card">
          <h3 class="detail-title">Mode safety</h3>
          <div class="detail-meta">
            <span class="badge info">${escapeHtml(modeMeta.badgeLabel)}</span>
            ${doc.modeOverride ? '<span class="badge warn">Override</span>' : '<span class="badge">Batch default</span>'}
            ${modeMeta.guardrails.slice(0, 2).map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join('')}
          </div>
          <div class="summary-sub">${escapeHtml(modeMeta.summary)}${docOutcome.modePending ? ` Current scores were produced under ${appliedModeMeta.label} mode. Rerun to apply ${modeMeta.label} mode.` : ''}</div>
        </div>
        <div class="inspector-card">
          <h3 class="detail-title">Residue audit</h3>
          <div class="detail-meta">
            <span class="badge ${residueAudit.requiresSecondPass ? 'warn' : 'good'}">${residueAudit.requiresSecondPass ? 'Second pass used' : 'Clean first pass'}</span>
            <span class="badge ${residueAudit.accepted ? 'good' : 'warn'}">${residueAudit.accepted ? 'Accepted' : 'Original kept'}</span>
            <span class="badge info">Findings ${residueAudit.initialHitCount} → ${residueAudit.finalHitCount}</span>
          </div>
          <div class="summary-sub">${escapeHtml(residueAuditSummary)}</div>
          <div class="detail-meta" style="margin-top:10px;">
            <span class="badge">Fixes applied ${residueAudit.appliedFixes.length}</span>
            ${residueFindingBadges}
          </div>
        </div>
        <div class="inspector-card">
          <h3 class="detail-title">Review actions</h3>
          <div class="detail-meta">
            <span class="badge ${display.cls}">${display.label}</span>
            <span class="badge ${doc.outlier ? 'warn' : 'good'}">${doc.outlier ? 'Outlier' : 'In band'}</span>
            <span class="badge info">Voice ${Math.round(voiceScore)}</span>
          </div>
          ${actionBar}
          <div style="height:12px"></div>
          ${notesInput}
        </div>
      </div>
      <div class="inspector-card" style="margin-top:12px;">
        <h3 class="detail-title">Top annotations</h3>
        ${annotationsHtml}
        ${hiddenAnnotationCount ? `<div class="summary-sub">${hiddenAnnotationCount} more annotation${hiddenAnnotationCount === 1 ? '' : 's'} remain in the export data for this file.</div>` : ''}
      </div>
    `,
    original: `
      <div class="inspector-card">
        <h3 class="detail-title">Original text</h3>
        <div class="prose-box">${escapeHtml(doc.originalText || '')}</div>
      </div>
    `,
    revised: `
      <div class="inspector-card">
        <h3 class="detail-title">Revised text</h3>
        <div class="prose-box">${escapeHtml(doc.revisedText || doc.originalText || '')}</div>
      </div>
    `,
    diff: `
      <div class="inspector-card">
        <h3 class="detail-title">Word-level diff</h3>
        <div class="diff-box">${wordDiffHtml(doc.originalText || '', doc.revisedText || doc.originalText || '')}</div>
      </div>
    `,
    voice: `
      <div class="inspector-card">
        <h3 class="detail-title">Voice consistency</h3>
        <div class="voice-grid">
          <div class="voice-card">
            <div class="voice-label">Target similarity</div>
            <div class="voice-value ${doc.voice?.targetSimilarity >= batch.settings.threshold ? 'good' : 'warn'}">${Math.round(doc.voice?.targetSimilarity || 0)}</div>
            <div class="voice-note">How close the revised document sits to the selected voice source.</div>
          </div>
          <div class="voice-card">
            <div class="voice-label">Batch similarity</div>
            <div class="voice-value ${doc.voice?.batchSimilarity >= batch.settings.threshold ? 'good' : 'warn'}">${Math.round(doc.voice?.batchSimilarity || 0)}</div>
            <div class="voice-note">How well the document stays inside the batch's shared cadence.</div>
          </div>
          <div class="voice-card">
            <div class="voice-label">Outlier threshold</div>
            <div class="voice-value">${batch.settings.threshold}</div>
            <div class="voice-note">Lower values force tighter consistency; higher values tolerate more variation.</div>
          </div>
        </div>
      </div>
      <div class="inspector-card">
        <h3 class="detail-title">Feature profile</h3>
        <div class="profile-list">
          ${profileRow('Sentence length', doc.revisedProfile?.avgSentence || 0, batch.batchProfile?.avgSentence || 0, 1)}
          ${profileRow('Sentence spread', doc.revisedProfile?.sentenceSpread || 0, batch.batchProfile?.sentenceSpread || 0, 1)}
          ${profileRow('Lexical diversity', doc.revisedProfile?.lexicalDiversity || 0, batch.batchProfile?.lexicalDiversity || 0, 2)}
          ${profileRow('Dialogue density', doc.revisedProfile?.dialogueDensity || 0, batch.batchProfile?.dialogueDensity || 0, 2)}
          ${profileRow('Fragment rate', doc.revisedProfile?.fragmentRate || 0, batch.batchProfile?.fragmentRate || 0, 2)}
          ${profileRow('Long sentence rate', doc.revisedProfile?.longSentenceRate || 0, batch.batchProfile?.longSentenceRate || 0, 2)}
        </div>
      </div>
    `,
  };

  $('docInspector').innerHTML = contentByTab[state.detailTab] || contentByTab.overview;
  updateTabState();
}

function profileRow(label, value, comparison, digits = 2) {
  const barValue = clamp(Math.round(value * 100), 5, 100);
  const compare = comparison ? Math.round(comparison * 100) : 0;
  return `
    <div class="profile-row">
      <div class="profile-row-head"><span>${escapeHtml(label)}</span><span>${formatNumber(value * 100, digits)} · batch ${formatNumber(comparison * 100, digits)}</span></div>
      <div class="profile-bar"><div class="profile-fill" style="width:${barValue}%"></div></div>
    </div>
  `;
}

function renderExportPanel(batch) {
  const summary = batch.summary || {};
  const outcome = buildBatchOutcome(batch);
  const exports = buildExportEntries(batch);
  $('exportPanel').innerHTML = `
    <div class="export-card">
      <div>
        <strong>${batch.status === 'complete' ? 'Bundle ready' : 'Bundle preview'}</strong>
        <span>${exports.length} files prepared. ${outcome.changed} meaningful rewrites, ${summary.residueAlerts || 0} residue alert${(summary.residueAlerts || 0) === 1 ? '' : 's'}, ${summary.gateReverts || 0} kept original, and ${outcome.pendingReview} still waiting for review.</span>
      </div>
      <span class="badge good">${batch.status === 'complete' ? 'Ready' : 'Preview'}</span>
    </div>
    <div class="export-card">
      <div>
        <strong>Export options</strong>
        <span>${DOCUMENT_MODE_LABELS[batch.settings.documentMode] || batch.settings.documentMode} mode · Humanizer delta ${formatSigned(summary.humanizerDelta || 0, 1)} · quality delta ${formatSigned(summary.qualityDelta || 0, 1)} · risk delta ${formatSigned(summary.riskDelta || 0, 1)} · voice variance ${formatNumber(summary.voiceVariance || 0, 1)}.</span>
      </div>
      <div class="button-row" style="margin:0;">
        <button class="btn" data-action="export-json">JSON</button>
        <button class="btn" data-action="export-csv">CSV</button>
        <button class="btn" data-action="export-zip">Zip</button>
      </div>
    </div>
  `;
}

function renderAll() {
  const batch = activeBatch();
  renderBatchList();
  if (!batch) {
    updateSettingsPreview();
    renderEmptyWorkspace();
    return;
  }

  updateBatchFromControls(batch);
  if (!state.activeDocId && batch.docs[0]) state.activeDocId = batch.docs[0].id;

  renderHero(batch);
  renderSummaryGrid(batch);
  renderDocTable(batch);
  renderInspector(batch);
  renderExportPanel(batch);
  updateSettingsPreview(batch.settings);

  const disabled = state.busy || !batch.docs.length;
  document.querySelectorAll('[data-action="run-batch"], [data-action="rerun-outliers"], [data-action="approve-all"], [data-action="export-csv"], [data-action="export-json"], [data-action="export-zip"]').forEach((button) => {
    if (button.dataset.action === 'export-csv' || button.dataset.action === 'export-json' || button.dataset.action === 'export-zip') {
      button.classList.toggle('is-disabled', !batch.docs.length);
    } else {
      button.classList.toggle('is-disabled', disabled && button.dataset.action !== 'approve-all');
    }
  });
}

function wordDiffHtml(original, revised) {
  const left = original.split(/(\s+)/);
  const right = revised.split(/(\s+)/);
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = left[i - 1] === right[j - 1]
        ? rows[i - 1][j - 1] + 1
        : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }

  const parts = [];
  let i = left.length;
  let j = right.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      parts.unshift({ type: 'eq', value: left[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) {
      parts.unshift({ type: 'ins', value: right[j - 1] });
      j -= 1;
    } else {
      parts.unshift({ type: 'del', value: left[i - 1] });
      i -= 1;
    }
  }

  return parts.map((part) => {
    if (part.type === 'eq') return escapeHtml(part.value);
    if (part.type === 'del') return `<span class="diff-del">${escapeHtml(part.value)}</span>`;
    return `<span class="diff-ins">${escapeHtml(part.value)}</span>`;
  }).join('');
}

function reportTitle(batch) {
  return `${batch.name} · ${getNowStamp()}`;
}

function buildExportEntries(batch) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = batch.summary || {};
  const docs = batch.docs;
  const csvRows = [
    [
      'sequence',
      'name',
      'status',
      'review_state',
      'document_mode_requested',
      'document_mode_applied',
      'original_quality',
      'revised_quality',
      'quality_delta',
      'original_humanizer',
      'revised_humanizer',
      'humanizer_delta',
      'original_risk',
      'revised_risk',
      'risk_delta',
      'acceptance_status',
      'residue_findings',
      'residue_fixes',
      'voice_similarity',
      'outlier',
      'notes',
    ],
    ...docs.map((doc, index) => [
      index + 1,
      doc.name,
      doc.status,
      doc.reviewState,
      effectiveDocumentMode(doc, batch),
      doc.appliedDocumentMode || '',
      doc.originalMetrics?.qualityScore?.toFixed?.(1) ?? '',
      doc.revisedMetrics?.qualityScore?.toFixed?.(1) ?? '',
      doc.delta?.qualityDelta?.toFixed?.(1) ?? '',
      doc.originalMetrics?.humanizerScore?.toFixed?.(1) ?? '',
      doc.revisedMetrics?.humanizerScore?.toFixed?.(1) ?? '',
      doc.delta?.humanizerDelta?.toFixed?.(1) ?? '',
      doc.originalMetrics?.detectorRisk?.toFixed?.(1) ?? '',
      doc.revisedMetrics?.detectorRisk?.toFixed?.(1) ?? '',
      doc.delta?.riskDelta?.toFixed?.(1) ?? '',
      doc.acceptance?.reverted ? 'kept_original' : 'accepted',
      doc.residueAudit?.finalHitCount ?? '',
      doc.residueAudit?.appliedFixes?.length ?? '',
      doc.voice?.score?.toFixed?.(1) ?? '',
      doc.outlier ? 'yes' : 'no',
      (doc.notes || '').replace(/\n/g, ' '),
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`)),
  ]
    .map((row) => row.join(','))
    .join('\n');

  const manifest = {
    title: reportTitle(batch),
    batch: {
      id: batch.id,
      name: batch.name,
      source: batch.source,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      status: batch.status,
    },
    settings: batch.settings,
    summary,
    documents: docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      status: doc.status,
      reviewState: doc.reviewState,
      outlier: doc.outlier,
      reruns: doc.reruns,
      delta: doc.delta,
      residueAudit: doc.residueAudit,
      acceptance: doc.acceptance,
      voice: doc.voice,
      originalText: doc.originalText,
      revisedText: doc.revisedText,
      annotations: doc.annotations,
      originalMetrics: doc.originalMetrics,
      revisedMetrics: doc.revisedMetrics,
      notes: doc.notes,
      modeOverride: doc.modeOverride,
      appliedDocumentMode: doc.appliedDocumentMode,
    })),
  };

  const voiceReport = {
    targetProfile: batch.targetProfile,
    batchProfile: batch.batchProfile,
    docs: docs.map((doc) => ({
      name: doc.name,
      voice: doc.voice,
      outlier: doc.outlier,
    })),
  };

  const summaryMarkdown = [
    `# ${batch.name}`,
    '',
    `Created: ${new Date(batch.createdAt).toLocaleString()}`,
    `Updated: ${new Date(batch.updatedAt).toLocaleString()}`,
    '',
    '## Batch Summary',
    '',
    `- Documents: ${summary.documentCount || docs.length}`,
    `- Analysed: ${summary.analysedCount || 0}`,
    `- Batch default document mode: ${DOCUMENT_MODE_LABELS[batch.settings.documentMode] || batch.settings.documentMode}`,
    `- Quality delta: ${formatSigned(summary.qualityDelta || 0, 1)}`,
    `- Risk delta: ${formatSigned(summary.riskDelta || 0, 1)}`,
    `- Voice variance: ${formatNumber(summary.voiceVariance || 0, 1)}`,
    `- Outliers: ${summary.outliers || 0}`,
    '',
    '## Document Review',
    '',
    '| # | Document | Review | ΔQ | ΔRisk | Voice |',
    '|---|---|---|---:|---:|---:|',
    ...docs.map((doc, index) => `| ${index + 1} | ${doc.name} | ${doc.reviewState} | ${formatNumber(doc.delta?.qualityDelta || 0, 1)} | ${formatNumber(doc.delta?.riskDelta || 0, 1)} | ${formatNumber(doc.voice?.score || 0, 1)} |`),
  ].join('\n');

  const files = docs.flatMap((doc, index) => {
    const prefix = String(index + 1).padStart(2, '0');
    return [
      {
        name: `revised/${prefix}_${slugify(doc.name)}.md`,
        content: doc.revisedText || doc.originalText || '',
      },
      {
        name: `diffs/${prefix}_${slugify(doc.name)}.html`,
        content: buildDiffHtmlPage(doc),
      },
    ];
  });

  return [
    ...files,
    {
      name: 'reports/batch-summary.md',
      content: summaryMarkdown,
    },
    {
      name: 'reports/document-scores.csv',
      content: csvRows,
    },
    {
      name: 'reports/run-manifest.json',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      name: 'reports/voice-consistency.json',
      content: JSON.stringify(voiceReport, null, 2),
    },
  ];
}

function buildDiffHtmlPage(doc) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(doc.name)} · Diff</title>
<style>
body{margin:0;padding:40px;background:#0b0f14;color:#f3eadc;font-family:Georgia,serif;line-height:1.8}
.shell{max-width:960px;margin:0 auto}
h1{font-family:Arial,sans-serif;font-size:1.2rem;letter-spacing:.08em;text-transform:uppercase;color:#e2b36f}
.panel{border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.03);padding:28px}
.del{background:rgba(239,122,102,.18);color:#f0b0a6;text-decoration:line-through;border-radius:6px;padding:0 3px}
.ins{background:rgba(125,196,154,.18);color:#b8ebc8;border-radius:6px;padding:0 3px}
</style>
</head>
<body>
<div class="shell">
  <h1>${escapeHtml(doc.name)}</h1>
  <div class="panel">${wordDiffHtml(doc.originalText || '', doc.revisedText || doc.originalText || '')}</div>
</div>
</body>
</html>`;
}

function toZipEntries(batch) {
  return buildExportEntries(batch).map((entry) => ({
    name: `batch_${slugify(batch.name)}/${entry.name}`,
    content: entry.content,
  }));
}

function crc32(bytes) {
  const table = crc32.table || (crc32.table = (() => {
    const result = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      result[n] = c >>> 0;
    }
    return result;
  })());

  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function dosDateTime(date) {
  const year = date.getFullYear() - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: (year << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function concatBytes(parts) {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const contentBytes = encoder.encode(entry.content);
    const crc = crc32(contentBytes);
    const stamp = dosDateTime(new Date());

    const localHeader = concatBytes([
      Uint8Array.from(u32(0x04034b50)),
      Uint8Array.from(u16(20)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(stamp.time)),
      Uint8Array.from(u16(stamp.date)),
      Uint8Array.from(u32(crc)),
      Uint8Array.from(u32(contentBytes.length)),
      Uint8Array.from(u32(contentBytes.length)),
      Uint8Array.from(u16(nameBytes.length)),
      Uint8Array.from(u16(0)),
      nameBytes,
      contentBytes,
    ]);
    localParts.push(localHeader);

    const centralHeader = concatBytes([
      Uint8Array.from(u32(0x02014b50)),
      Uint8Array.from(u16(20)),
      Uint8Array.from(u16(20)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(stamp.time)),
      Uint8Array.from(u16(stamp.date)),
      Uint8Array.from(u32(crc)),
      Uint8Array.from(u32(contentBytes.length)),
      Uint8Array.from(u32(contentBytes.length)),
      Uint8Array.from(u16(nameBytes.length)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u16(0)),
      Uint8Array.from(u32(0)),
      Uint8Array.from(u32(offset)),
      nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length;
  });

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
  const centralOffset = localParts.reduce((acc, part) => acc + part.length, 0);
  const count = entries.length;
  const endRecord = concatBytes([
    Uint8Array.from(u32(0x06054b50)),
    Uint8Array.from(u16(0)),
    Uint8Array.from(u16(0)),
    Uint8Array.from(u16(count)),
    Uint8Array.from(u16(count)),
    Uint8Array.from(u32(centralSize)),
    Uint8Array.from(u32(centralOffset)),
    Uint8Array.from(u16(0)),
  ]);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(filename, content, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([content], { type }), filename);
}

function exportCsv(batch) {
  const content = buildExportEntries(batch).find((entry) => entry.name === 'reports/document-scores.csv')?.content || '';
  downloadText(`${slugify(batch.name)}-document-scores.csv`, content, 'text/csv;charset=utf-8');
}

function exportJson(batch) {
  const manifest = buildExportEntries(batch).find((entry) => entry.name === 'reports/run-manifest.json')?.content || '{}';
  downloadText(`${slugify(batch.name)}-manifest.json`, manifest, 'application/json;charset=utf-8');
}

function exportZip(batch) {
  const entries = toZipEntries(batch);
  const blob = buildZip(entries);
  downloadBlob(blob, `${slugify(batch.name)}-bundle.zip`);
}

function loadDemo() {
  addBatch(makeSampleBatch());
}

function setBatchSetting(batch, key, value) {
  if (!batch) return;
  batch.settings[key] = value;
  batch.updatedAt = Date.now();
  saveSoon();
}

function handleAction(action, element) {
  const batch = activeBatch();
  const docId = element?.dataset?.docId || element?.closest?.('[data-doc-id]')?.dataset?.docId || null;
  switch (action) {
    case 'new-sample':
      loadDemo();
      break;
    case 'create-batch':
      createAndSelectBatch();
      break;
    case 'select-batch':
      selectBatch(element.dataset.batchId);
      break;
    case 'select-doc':
      selectDoc(docId);
      break;
    case 'tab':
      selectTab(element.dataset.tab);
      break;
    case 'import-text':
      addPastedSample(batch);
      break;
    case 'clear-batch':
      removeAllDocs(batch);
      break;
    case 'run-batch':
      runBatch(batch);
      break;
    case 'rerun-outliers':
      rerunOutliers(batch);
      break;
    case 'approve-all':
      markAll(batch, 'approved');
      break;
    case 'approve-selected':
      if (docId || state.activeDocId) markDoc(batch, docId || state.activeDocId, 'approved');
      break;
    case 'reject-selected':
      if (docId || state.activeDocId) markDoc(batch, docId || state.activeDocId, 'rejected');
      break;
    case 'doc-approve':
      markDoc(batch, docId, 'approved');
      break;
    case 'doc-reject':
      markDoc(batch, docId, 'rejected');
      break;
    case 'doc-rerun':
      rerunDoc(batch, docId, element.dataset.budget || batch?.settings?.budget);
      break;
    case 'export-csv':
      if (batch) exportCsv(batch);
      break;
    case 'export-json':
      if (batch) exportJson(batch);
      break;
    case 'export-zip':
      if (batch) exportZip(batch);
      break;
    default:
      break;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action]');
    if (!control) return;
    const action = control.dataset.action;
    if (control.classList.contains('is-disabled')) return;
    if (action === 'tab') {
      event.preventDefault();
      handleAction(action, control);
      return;
    }
    if (['select-batch', 'select-doc', 'doc-approve', 'doc-reject', 'doc-rerun', 'approve-all', 'approve-selected', 'reject-selected', 'new-sample', 'create-batch', 'import-text', 'clear-batch', 'run-batch', 'rerun-outliers', 'export-csv', 'export-json', 'export-zip'].includes(action)) {
      event.preventDefault();
      handleAction(action, control);
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    const batch = activeBatch();
    if (!batch) return;
    if (target.id === CONTROL_IDS.voiceSample) {
      batch.settings.voiceSampleText = target.value;
      batch.updatedAt = Date.now();
      saveSoon();
      return;
    }
    if (target.matches('textarea[data-action="doc-notes"]')) {
      const doc = batch.docs.find((item) => item.id === target.dataset.docId);
      if (!doc) return;
      doc.notes = target.value;
      saveSoon();
      return;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    const batch = activeBatch();
    if (!batch) return;
    if (target.matches('select[data-action="doc-mode-override"]')) {
      setDocModeOverride(batch, target.dataset.docId, target.value);
      return;
    }
    if (Object.values(CONTROL_IDS).includes(target.id)) {
      updateBatchFromControls(batch);
      renderAll();
      return;
    }
  });

  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const folderInput = $('folderInput');
  const chooseFilesBtn = $('chooseFilesBtn');
  const chooseFolderBtn = $('chooseFolderBtn');

  dropzone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    fileInput.click();
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
    addFilesToBatch(event.dataTransfer.files);
  });

  chooseFilesBtn.addEventListener('click', () => fileInput.click());
  chooseFolderBtn.addEventListener('click', () => folderInput.click());

  fileInput.addEventListener('change', (event) => {
    addFilesToBatch(event.target.files);
    event.target.value = '';
  });

  folderInput.addEventListener('change', (event) => {
    addFilesToBatch(event.target.files);
    event.target.value = '';
  });
}

function init() {
  const restored = loadState();
  if (!restored) {
    state.batches = [];
    state.activeBatchId = null;
    state.activeDocId = null;
    state.detailTab = 'overview';
  }
  bindEvents();
  if (!state.batches.length) {
    renderAll();
  } else {
    const batch = activeBatch() || state.batches[0];
    state.activeBatchId = batch.id;
    state.activeDocId = batch.docs[0]?.id || null;
    syncControlsFromBatch(batch);
    renderAll();
  }
}

document.addEventListener('DOMContentLoaded', init);
