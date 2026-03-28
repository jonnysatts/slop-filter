(function registerHumanizerEngine(global) {
  const ruleSet = global.SlopFilterHumanizerRules || {
    allModes: ['fiction', 'essay', 'marketing', 'business', 'worldbuilding'],
    rules: [],
    legacyGroups: { filler: [], structure: [], fictionTell: [], register: [] },
    prefixPatterns: [],
    transitions: [],
  };

  const documentModes = ruleSet.allModes || ['fiction', 'essay', 'marketing', 'business', 'worldbuilding'];
  const defaultMode = 'fiction';
  const modePolicies = {
    fiction: {
      label: 'Fiction',
      badgeLabel: 'Fiction-safe',
      summary: 'Protect scene texture, dialogue rhythm, and chapter-style headings. Avoid essay-like cleanup that flattens narration.',
      guardrails: ['Keep narration texture', 'Do not force tidy conclusions', 'Leave heading style alone'],
    },
    essay: {
      label: 'Essay',
      badgeLabel: 'Essay mode',
      summary: 'Push hard on abstraction, filler, and generic wrap-up language while keeping an authorial argument intact.',
      guardrails: ['Trim hedging', 'Prefer direct claims', 'Keep intentional structure'],
    },
    marketing: {
      label: 'Marketing',
      badgeLabel: 'Marketing mode',
      summary: 'Keep persuasive energy and product voice, but trim brochure sludge, filler, and chatbot framing.',
      guardrails: ['Preserve persuasive tone', 'Cut brochure sludge', 'Keep calls to action clear'],
    },
    business: {
      label: 'Business',
      badgeLabel: 'Business mode',
      summary: 'Favour direct statements, concrete claims, and clean structure without forcing fiction-style vividness.',
      guardrails: ['Prefer concrete claims', 'Keep neutral clarity', 'Avoid unnecessary flourish'],
    },
    worldbuilding: {
      label: 'Worldbuilding',
      badgeLabel: 'Worldbuilding-safe',
      summary: 'Protect lore texture and elevated register, but still remove synthetic exposition and assistant residue.',
      guardrails: ['Protect lore diction', 'Keep chapter and codex texture', 'Trim synthetic exposition'],
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function stdev(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    const variance = mean(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
  }

  function countMatches(text, regex) {
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  function splitSentences(text) {
    const normalized = String(text || '')
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
    return (String(text || '').match(/\b[\w’'-]+\b/g) || []).filter(Boolean);
  }

  function sentenceExcerpt(text, fallback = '') {
    const firstSentence = splitSentences(text)[0];
    return (firstSentence || fallback || String(text || '').trim()).slice(0, 220);
  }

  function sentenceForNeedle(text, needle) {
    const sentences = splitSentences(text);
    const lowerNeedle = String(needle || '').toLowerCase().trim();
    return sentences.find((sentence) => sentence.toLowerCase().includes(lowerNeedle)) || sentenceExcerpt(text, needle);
  }

  function normaliseMode(mode) {
    return documentModes.includes(mode) ? mode : defaultMode;
  }

  function modeScaleForRule(rule, mode) {
    const resolvedMode = normaliseMode(mode);
    let scale = 1;
    if (Array.isArray(rule.safeModes) && rule.safeModes.length && !rule.safeModes.includes(resolvedMode)) {
      scale *= 0.45;
    }
    if (Array.isArray(rule.unsafeModes) && rule.unsafeModes.includes(resolvedMode)) {
      return 0;
    }
    if (rule.severityByMode && Number.isFinite(rule.severityByMode[resolvedMode])) {
      scale *= rule.severityByMode[resolvedMode];
    }
    return scale;
  }

  function deriveMetrics(text) {
    const sentences = splitSentences(text);
    const words = tokenizeWords(text);
    const wordCount = words.length || 1;
    const sentenceLengths = sentences.map((sentence) => tokenizeWords(sentence).length || 1);

    return {
      wordCount,
      sentenceCount: sentences.length,
      avgSentence: mean(sentenceLengths),
      sentenceSpread: stdev(sentenceLengths),
      dialogueDensity: (countMatches(text, /["“”]/g) / 2) / Math.max(1, String(text || '').split(/\n{2,}/).filter(Boolean).length),
      questionRate: countMatches(text, /\?/g) / Math.max(1, sentences.length),
      modifierDensity: countMatches(text, /\b(?:very|really|just|quite|rather|fairly|deeply|simply|clearly|obviously|truly|particularly|especially|remarkably|incredibly)\b/gi) / wordCount,
      concreteDensity: countMatches(text, /\b(?:stone|door|window|table|road|river|chair|hand|bread|bridge|paper|kettle|light|wall|coat|floor|market|street|room|shelf|rain|book|ledger)\b/gi) / wordCount,
      abstractDensity: countMatches(text, /\b(?:truth|meaning|purpose|emotion|feeling|system|process|context|journey|landscape|future|importance|need|impact|challenge|opportunity)\b/gi) / wordCount,
    };
  }

  function appendHit(hits, seen, rule, excerpt, options = {}) {
    const mode = normaliseMode(options.mode);
    const scale = modeScaleForRule(rule, mode);
    if (scale <= 0) return;
    const key = `${rule.id}:${excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      id: rule.id,
      label: rule.label,
      category: rule.category,
      severity: clamp(rule.severity * scale, 0.08, 1),
      excerpt,
      hint: rule.hint,
      mode,
      modeScale: scale,
    });
  }

  function detectRuleHits(text, mode) {
    const hits = [];
    const seen = new Set();
    const lower = String(text || '').toLowerCase();

    ruleSet.rules.forEach((rule) => {
      (rule.phrases || []).forEach((phrase) => {
        if (lower.includes(phrase.toLowerCase())) {
          appendHit(hits, seen, rule, sentenceForNeedle(text, phrase), { mode });
        }
      });

      (rule.regexes || []).forEach((regex) => {
        const source = new RegExp(regex.source, regex.flags);
        const match = source.exec(String(text || ''));
        if (match) {
          appendHit(hits, seen, rule, sentenceForNeedle(text, match[0]), { mode });
        }
      });
    });

    return hits;
  }

  function detectLegacyGroupHits(text, mode) {
    const hits = [];
    const seen = new Set();
    const lower = String(text || '').toLowerCase();
    const groupConfig = {
      filler: {
        id: 'legacy_filler',
        label: 'Filler language',
        category: 'hedging',
        severity: 0.52,
        hint: 'Trim filler so the sentence reaches its point faster.',
        safeModes: documentModes,
        severityByMode: { fiction: 0.9, marketing: 0.92 },
      },
      structure: {
        id: 'legacy_structure',
        label: 'Formula structure',
        category: 'structure',
        severity: 0.58,
        hint: 'Break explanatory templates that make the prose feel synthetic.',
        safeModes: documentModes,
        severityByMode: { fiction: 0.74, worldbuilding: 0.82 },
      },
      fictionTell: {
        id: 'legacy_fiction_tell',
        label: 'Fiction tell',
        category: 'language',
        severity: 0.64,
        hint: 'Let the scene carry the emotion instead of announcing it.',
        safeModes: ['fiction', 'worldbuilding'],
        severityByMode: { essay: 0.4, business: 0.25, marketing: 0.25 },
      },
      register: {
        id: 'legacy_register',
        label: 'AI register',
        category: 'style',
        severity: 0.62,
        hint: 'Replace inflated register with plainer, more grounded prose.',
        safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
        severityByMode: { fiction: 0.32, marketing: 0.72 },
      },
    };

    (ruleSet.prefixPatterns || []).forEach((pattern) => {
      const match = String(text || '').match(pattern);
      if (match) {
        appendHit(hits, seen, {
          id: 'legacy_prefix',
          label: 'Filler opener',
          category: 'hedging',
          severity: 0.68,
          hint: 'Cut the stock opening phrase and start with the real point.',
          safeModes: documentModes,
          severityByMode: { fiction: 0.88 },
        }, sentenceForNeedle(text, match[0]), { mode });
      }
    });

    Object.entries(ruleSet.legacyGroups || {}).forEach(([group, phrases]) => {
      const config = groupConfig[group];
      if (!config) return;
      phrases.forEach((phrase) => {
        if (lower.includes(String(phrase).toLowerCase())) {
          appendHit(hits, seen, config, sentenceForNeedle(text, phrase), { mode });
        }
      });
    });

    return hits;
  }

  function detectDerivedHits(text, metrics, mode) {
    const hits = [];
    const sentenceCount = metrics.sentenceCount || 0;

    if (sentenceCount >= 5 && metrics.sentenceSpread < 4.2) {
      appendHit(hits, new Set(), {
        id: 'cadence_regularisation',
        label: 'Cadence regularisation',
        category: 'soul',
        severity: 0.68,
        hint: 'Vary sentence shape and cadence so the prose stops feeling machine-paced.',
        safeModes: documentModes,
        severityByMode: { business: 0.72, marketing: 0.8 },
      }, sentenceExcerpt(text), { mode });
    }

    if (metrics.wordCount > 90 && metrics.abstractDensity > metrics.concreteDensity * 1.35) {
      appendHit(hits, new Set(), {
        id: 'abstraction_drift',
        label: 'Abstraction drift',
        category: 'content',
        severity: 0.56,
        hint: 'Replace abstraction with concrete nouns, actions, or sensory detail.',
        safeModes: documentModes,
        severityByMode: { worldbuilding: 0.68, marketing: 0.82 },
      }, sentenceExcerpt(text), { mode });
    }

    if (metrics.wordCount > 120 && metrics.dialogueDensity === 0 && metrics.questionRate < 0.02 && metrics.concreteDensity < 0.018) {
      appendHit(hits, new Set(), {
        id: 'neutral_reportage',
        label: 'Neutral reportage',
        category: 'soul',
        severity: 0.52,
        hint: 'The prose may be technically tidy but still too neutral and bloodless.',
        safeModes: ['fiction', 'essay', 'worldbuilding'],
        severityByMode: { business: 0.28, marketing: 0.2 },
      }, sentenceExcerpt(text), { mode });
    }

    return hits;
  }

  function tallyCategories(hits) {
    return hits.reduce((acc, hit) => {
      acc[hit.category] = (acc[hit.category] || 0) + 1;
      return acc;
    }, {});
  }

  function topCategories(categoryTotals) {
    return Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));
  }

  function detectHumanizerPatterns(text, options = {}) {
    const metrics = options.metrics || deriveMetrics(text);
    const mode = normaliseMode(options.mode);
    const directHits = detectRuleHits(text, mode);
    const legacyHits = detectLegacyGroupHits(text, mode);
    const derivedHits = detectDerivedHits(text, metrics, mode);
    return [...directHits, ...legacyHits, ...derivedHits].slice(0, 24);
  }

  function computeHumanizerScore(text, options = {}) {
    const metrics = options.metrics || deriveMetrics(text);
    const hits = detectHumanizerPatterns(text, { metrics, mode: options.mode });
    const categoryTotals = tallyCategories(hits);

    const patternPenalty = hits.reduce((sum, hit) => sum + hit.severity * 4.8, 0);
    const cadencePenalty = metrics.sentenceCount >= 5
      ? clamp((4.5 - metrics.sentenceSpread) * 5.8, 0, 18)
      : 0;
    const specificityPenalty = clamp((metrics.abstractDensity - metrics.concreteDensity) * 95, 0, 16);
    const neutralityPenalty = metrics.wordCount > 120 && metrics.dialogueDensity === 0
      ? clamp((0.024 - metrics.concreteDensity) * 320, 0, 12)
      : 0;
    const placeholderPenalty = clamp((metrics.modifierDensity - 0.018) * 260, 0, 12);
    const chatbotArtifactPenalty = hits.filter((hit) => hit.category === 'communication').length * 4.5;

    const score = clamp(
      100 - (
        patternPenalty
        + cadencePenalty
        + specificityPenalty
        + neutralityPenalty
        + placeholderPenalty
        + chatbotArtifactPenalty
      ),
      0,
      100,
    );

    return {
      score,
      hitCount: hits.length,
      hits,
      categoryTotals,
      topCategories: topCategories(categoryTotals),
      penalties: {
        patternPenalty,
        cadencePenalty,
        specificityPenalty,
        neutralityPenalty,
        placeholderPenalty,
        chatbotArtifactPenalty,
      },
    };
  }

  function auditResidualAISignals(text, options = {}) {
    const metrics = options.metrics || deriveMetrics(text);
    const mode = normaliseMode(options.mode);
    const hits = detectHumanizerPatterns(text, { metrics, mode });
    const categoryTotals = tallyCategories(hits);
    const findings = hits
      .filter((hit, index) => hit.severity >= 0.72 || ['communication', 'hedging', 'content', 'soul'].includes(hit.category) || index < 4)
      .slice(0, 6)
      .map((hit) => ({
        ...hit,
        priority: hit.severity >= 0.8 ? 'high' : hit.severity >= 0.58 ? 'medium' : 'low',
      }));

    return {
      status: findings.length ? 'residue-detected' : 'clean',
      hitCount: hits.length,
      findings,
      topCategories: topCategories(categoryTotals),
      requiresSecondPass: findings.length > 0,
      mode,
    };
  }

  function describeDocumentMode(mode) {
    const resolvedMode = normaliseMode(mode);
    return {
      mode: resolvedMode,
      ...modePolicies[resolvedMode],
    };
  }

  global.SlopFilterHumanizerEngine = {
    detectHumanizerPatterns,
    computeHumanizerScore,
    auditResidualAISignals,
    describeDocumentMode,
  };
})(window);
