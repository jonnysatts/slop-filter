(function registerHumanizerRules(global) {
  const allModes = ['fiction', 'essay', 'marketing', 'business', 'worldbuilding'];

  const prefixPatterns = [
    /^(?:it is important to note that|it should be noted that|needless to say|to be clear|in summary|in conclusion|ultimately|at the end of the day|in today'?s world|in a world where[^,]*,|here'?s the thing|let'?s dive in|as a reminder|that said|more importantly|when it comes to|if you'?re wondering|what this means is)\b/i,
  ];

  const transitions = [
    'however', 'furthermore', 'moreover', 'therefore', 'meanwhile', 'consequently',
    'additionally', 'ultimately', 'in fact', 'in contrast', 'for instance', 'for example',
  ];

  const legacyGroups = {
    filler: [
      'very', 'really', 'just', 'quite', 'basically', 'simply', 'clearly', 'obviously',
      'remarkably', 'significantly', 'incredibly', 'essentially', 'actually', 'literally',
      'deeply', 'profoundly', 'truly', 'particularly', 'especially',
    ],
    structure: [
      'on the one hand', 'on the other hand', 'the key takeaway', 'in other words',
      'the truth is', 'the reality is', 'what this means', 'to put it simply',
      'one of the most', 'it is worth noting',
    ],
    fictionTell: [
      'felt a wave of', 'felt a sense of', 'a sense of', 'he knew that', 'she knew that',
      'it was clear that', 'the reader can see', 'you can imagine', 'emotionally',
      'overwhelmingly', 'deeply', 'profoundly',
    ],
    register: [
      'documentary', 'explore', 'navigate', 'delve into', 'journey through', 'the landscape of',
      'in the age of', 'the world of', 'a powerful reminder', 'a testament to',
      'underscore the importance', 'showcase', 'foster', 'leverage',
    ],
  };

  const rules = [
    {
      id: 'significance_inflation',
      label: 'Significance inflation',
      category: 'content',
      severity: 0.95,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      unsafeModes: ['fiction'],
      phrases: [
        'pivotal moment', 'marking a significant step', 'marks a significant step',
        'plays a crucial role', 'vital role', 'important milestone', 'stands as a testament',
      ],
      hint: 'Cut the grand framing and name the actual fact or consequence.',
    },
    {
      id: 'media_notability',
      label: 'Media notability inflation',
      category: 'content',
      severity: 0.7,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      unsafeModes: ['fiction'],
      phrases: [
        'widely regarded', 'has garnered attention', 'has received widespread attention',
        'is considered one of', 'is often celebrated as',
      ],
      hint: 'Replace generic notability language with the concrete claim or source.',
    },
    {
      id: 'promotional_register',
      label: 'Promotional register',
      category: 'style',
      severity: 0.85,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      unsafeModes: ['fiction'],
      severityByMode: {
        marketing: 0.58,
        worldbuilding: 0.72,
      },
      phrases: [
        'nestled within', 'breathtaking', 'stunning', 'vibrant tapestry',
        'world-class', 'renowned for', 'rich cultural heritage',
      ],
      hint: 'Swap brochure language for plain description.',
    },
    {
      id: 'ai_vocabulary_cluster',
      label: 'AI vocabulary cluster',
      category: 'language',
      severity: 0.72,
      safeModes: allModes,
      severityByMode: {
        fiction: 0.84,
        worldbuilding: 0.92,
      },
      phrases: [
        'additionally', 'delve into', 'navigate', 'landscape', 'showcase',
        'underscore', 'foster', 'testament', 'moreover', 'furthermore',
      ],
      hint: 'Trade prestige vocabulary for simpler, more direct wording.',
    },
    {
      id: 'chatbot_artifact',
      label: 'Chatbot artifact',
      category: 'communication',
      severity: 1,
      safeModes: allModes,
      phrases: [
        'as an ai', 'i hope this helps', 'let me know if you would like',
        'here is a revised version', 'certainly', 'absolutely',
      ],
      regexes: [
        /\b(?:here'?s|here is)\s+(?:a|the)\s+(?:revised|updated)\s+version\b/gi,
        /\blet me know if you(?:'d| would) like\b/gi,
      ],
      hint: 'Strip assistant framing and return only the content.',
    },
    {
      id: 'sycophantic_opener',
      label: 'Sycophantic opener',
      category: 'communication',
      severity: 0.8,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.3,
      },
      phrases: [
        'great question', 'you are absolutely right', 'excellent point',
        'fantastic question', 'brilliant question',
      ],
      hint: 'Remove praise that flatters the reader instead of advancing the point.',
    },
    {
      id: 'hedge_stack',
      label: 'Hedge stack',
      category: 'hedging',
      severity: 0.62,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.42,
      },
      phrases: [
        'may perhaps', 'can often', 'in many ways', 'it seems that',
        'it appears that', 'arguably', 'to some extent',
      ],
      hint: 'Keep only the uncertainty that is actually doing work.',
    },
    {
      id: 'generic_conclusion',
      label: 'Generic conclusion',
      category: 'hedging',
      severity: 0.68,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.22,
        worldbuilding: 0.45,
      },
      phrases: [
        'in conclusion', 'ultimately', 'the future is bright', 'there is no doubt that',
        'serves as a reminder', 'a powerful reminder', 'it is clear that',
      ],
      hint: 'End on the real point, not a generic wrap-up sentence.',
    },
    {
      id: 'rule_of_three',
      label: 'Rule of three',
      category: 'structure',
      severity: 0.52,
      safeModes: allModes,
      severityByMode: {
        fiction: 0.46,
        worldbuilding: 0.64,
        marketing: 0.85,
      },
      regexes: [
        /\b[^,.!?]{4,40},\s+[^,.!?]{4,40},\s+and\s+[^,.!?]{4,40}\b/g,
      ],
      hint: 'Break tidy triplets when they feel formulaic rather than earned.',
    },
    {
      id: 'false_range',
      label: 'False range',
      category: 'content',
      severity: 0.48,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.3,
      },
      regexes: [
        /\bfrom [^,.!?]{4,40} to [^,.!?]{4,40}\b/gi,
      ],
      hint: 'Check that the range is real, not rhetorical filler.',
    },
    {
      id: 'em_dash_overuse',
      label: 'Em dash overuse',
      category: 'style',
      severity: 0.45,
      safeModes: allModes,
      severityByMode: {
        fiction: 0.38,
        worldbuilding: 0.52,
      },
      regexes: [/—/g],
      hint: 'Reduce decorative em dashes unless they belong to the house style.',
    },
    {
      id: 'bold_overuse',
      label: 'Bold overuse',
      category: 'style',
      severity: 0.35,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.15,
      },
      regexes: [/\*\*[^*]+\*\*/g],
      hint: 'Use emphasis sparingly and only where the meaning needs it.',
    },
    {
      id: 'title_case_heading',
      label: 'Title case drift',
      category: 'style',
      severity: 0.25,
      safeModes: ['essay', 'marketing', 'business'],
      severityByMode: {
        fiction: 0.08,
        worldbuilding: 0.12,
      },
      regexes: [/^#{1,6}\s+[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){2,}$/gm],
      hint: 'Respect the project style guide for heading case.',
    },
    {
      id: 'knowledge_cutoff',
      label: 'Knowledge cutoff disclaimer',
      category: 'communication',
      severity: 1,
      safeModes: allModes,
      regexes: [/\b(?:my|the) knowledge cutoff\b/gi],
      hint: 'Remove model disclaimers from prose.',
    },
    {
      id: 'placeholder_wrapup',
      label: 'Placeholder wrap-up',
      category: 'hedging',
      severity: 0.55,
      safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
      severityByMode: {
        fiction: 0.25,
      },
      phrases: [
        'this highlights the importance of', 'this underscores the need for',
        'it is worth considering', 'this can be seen as',
      ],
      hint: 'Replace summary filler with a concrete ending or cut it.',
    },
  ];

  global.SlopFilterHumanizerRules = {
    allModes,
    prefixPatterns,
    transitions,
    legacyGroups,
    rules,
  };
})(window);
