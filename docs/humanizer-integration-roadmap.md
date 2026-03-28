# Humanizer Integration Roadmap

## Purpose

This document turns the useful ideas from the `humanizer` repo into the next concrete implementation path for Slop Filter.

The goal is not to "install Humanizer inside the app". The goal is to import its strongest concepts:

- a broader taxonomy of AI-writing patterns
- a residue-audit second pass
- stronger voice and cadence checks for text that is technically clean but still feels synthetic

The current app already has a lightweight local tell set and a single rewrite pass in [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L4), [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L927), and [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1074). This roadmap expands that into a proper subsystem.

## What to Import from Humanizer

High-value features to adopt:

- Content pattern detection
  Examples: significance inflation, media-notability inflation, vague attributions, formulaic "challenges" sections.

- Language and grammar pattern detection
  Examples: AI vocabulary clusters, copula avoidance, negative parallelisms, rule-of-three overuse, synonym cycling, false ranges.

- Style pattern detection
  Examples: em-dash overuse, boldface overuse, inline-header lists, title case drift, emoji contamination.

- Communication cleanup
  Examples: chatbot artefacts, knowledge-cutoff disclaimers, sycophantic openings.

- Filler and hedging cleanup
  Examples: bureaucratic filler, stacked hedging, generic positive conclusions.

- "Soul" checks
  Humanizer is right that text can lose obvious AI tells and still feel bloodless. We should score cadence sameness, low specificity, zero stance, and over-neutrality.

- Second-pass residue audit
  This is the single most useful mechanism to import. After the first rewrite, ask what still feels synthetic, then revise only the remaining weak spots.

## What Not to Hardcode as Universal Truth

Some Humanizer rules should become optional or context-bound:

- curly quotes
- title case headings
- hyphenated word pair consistency
- first-person usage
- overt opinion or humour

These are style choices, not universal AI evidence. They should be controlled by mode:

- `fiction`
- `essay`
- `marketing`
- `business`
- `worldbuilding`

## Recommended Architecture for This Repo

This repo is still a simple static app with a large [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1). The next path should keep implementation compatible with that reality.

### New files to add

- `humanizer_rules.js`
  Holds structured pattern definitions.

- `humanizer_engine.js`
  Holds detection, scoring, rewrite orchestration, and residue-audit helpers.

- `samples/humanizer-business.md`
- `samples/humanizer-marketing.md`
- `samples/humanizer-fiction.md`
  Fixtures for manual and automated regression checks.

### Minimal HTML change

Load the new scripts before [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1) in [index.html](/Users/jonsatterley/Downloads/slop-filter-v2/index.html#L217), using the same no-bundler approach as the current app.

## Data Model

Each pattern rule should be a structured object:

```js
{
  id: 'significance_inflation',
  label: 'Significance inflation',
  category: 'content',
  severity: 0.75,
  safeModes: ['essay', 'marketing', 'business', 'worldbuilding'],
  unsafeModes: ['fiction'],
  detectorWeight: 1.0,
  phrases: ['pivotal moment', 'testament to', 'vital role'],
  regexes: [/\\bmarking a pivotal moment\\b/i],
  rewriteHints: [
    'cut broader-significance padding',
    'replace abstraction with the concrete fact'
  ]
}
```

## New Pipeline Stages

### Stage 1: Humanizer detection

Add:

- `detectHumanizerPatterns(text, mode)`
- `groupPatternHitsBySpan(hits)`
- `summarizePatternHits(hits)`

Output should include:

- span text
- rule id
- category
- severity
- confidence
- rewrite hint

### Stage 2: Humanizer score

Add:

- `computeHumanizerScore(text, hits, profile)`

Score components:

- `patternPenalty`
- `cadencePenalty`
- `specificityPenalty`
- `neutralityPenalty`
- `placeholderPenalty`
- `chatbotArtifactPenalty`

Display:

- original score
- revised score
- delta

This becomes a local app-native score. It should sit beside quality and detector-risk deltas, not replace them.

### Stage 3: First-pass rewrite

Add:

- `runHumanizerRewrite(text, settings, profile, mode)`

Rules:

- only rewrite flagged spans
- preserve entities, numbers, headings, and formatting
- avoid flattening voice
- do not inject first-person or opinions unless the document mode allows it

### Stage 4: Residue audit

Add:

- `auditResidualAISignals(text, mode, profile)`
- `applyResidueFixes(text, auditFindings, settings)`

This stage should look for:

- still-too-even sentence rhythm
- remaining promo or significance inflation
- vague abstractions
- lingering chatbot voice
- generic closing sentences
- synonym cycling or tidy triplets still left after pass one

### Stage 5: Acceptance gate

A revised document only passes if:

- `humanizerScore` improves
- semantic preservation stays above threshold
- voice score stays inside the batch band
- no locked facts or formatting are broken

## UI Changes

### Run settings

Add:

- `Humanizer pass` toggle
- `Document mode` select
- `Residue audit` toggle

Document mode values:

- `fiction`
- `essay`
- `marketing`
- `business`
- `worldbuilding`

### Batch summary

Add cards for:

- `Humanizer score delta`
- `Top pattern categories`
- `Priority residue review`

### Document inspector

Add:

- `Pattern categories` card
- `Residue audit` card
- `Mode safety` badge

Pattern categories should show examples like:

- `promo language`
- `chatbot artefact`
- `hedging`
- `generic conclusion`
- `rule of three`

## Voice Safety Rules

Humanizer ideas must be constrained by the batch voice system already in the app.

Rules:

- do not remove stylistic texture that belongs to the batch voice
- do not train the voice profile on flagged Humanizer spans
- do not apply nonfiction-oriented cleanups to fiction narration unless marked safe
- run residue audit against the target voice, not against a generic business-writing norm

## Suggested File-Level Implementation Order

### Milestone 1: Rule pack and score

Files:

- `humanizer_rules.js`
- `humanizer_engine.js`
- [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1547)

Deliver:

- structured Humanizer rules
- `computeHumanizerScore`
- batch and document UI surfaces for the new score

### Milestone 2: First-pass integration

Files:

- `humanizer_engine.js`
- [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1074)

Deliver:

- rewrite pass that uses Humanizer hits instead of only the current hardcoded arrays
- pattern-category annotations in the inspector

### Milestone 3: Residue audit

Files:

- `humanizer_engine.js`
- [app.js](/Users/jonsatterley/Downloads/slop-filter-v2/app.js#L1142)

Deliver:

- second-pass audit
- residue findings in UI
- acceptance gate updates

### Milestone 4: Mode safety and fixtures

Files:

- `humanizer_rules.js`
- `samples/*.md`
- optional test harness script

Deliver:

- safe/unsafe mode gating
- business, marketing, fiction, and worldbuilding fixtures
- regression check list

## Concrete First Build

Build this first, before anything more ambitious:

1. Extract current AI-tell arrays into `humanizer_rules.js`
2. Expand them with the Humanizer taxonomy
3. Add `computeHumanizerScore`
4. Show that score in batch summary and document review
5. Add one residue-audit pass after rewrite
6. Surface top pattern categories in the inspector

That gives the product a real upgrade without requiring a full backend rewrite.

## Acceptance Criteria for the First Build

- A three-file Markdown batch shows `humanizerScore` before and after
- The inspector lists pattern categories, not just generic annotations
- Residue audit can flag at least one remaining synthetic tell after first-pass rewrite
- Fiction mode does not force first-person, opinion, or quotation-style rewrites
- Existing batch voice flow still works

## Recommendation

The next build should treat Humanizer as:

- a rule taxonomy
- a second-pass audit method
- a scoring layer

It should not be treated as:

- a universal style authority
- a one-click substitute for the existing app
- a reason to flatten voice or genre-specific prose
