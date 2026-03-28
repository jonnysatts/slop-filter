# Engine Assessment

An honest review of the Slop Filter engine's detection and rewriting mechanics, with specific improvement recommendations.

## What works well

**Signal detection vocabulary is well-chosen.** The filler patterns, intensifiers, cliches, abstract words, and generic words are all genuine AI-prose tells. The selection reflects actual observation of LLM output patterns rather than theoretical guesses.

**Five-axis quality scoring is structurally sound.** Directness, density, rhythm, authenticity, and specificity are orthogonal enough to give a useful composite. The weights are reasonable and the penalty coefficients produce scores that move meaningfully when slop is present.

**Voice profiling is the strongest feature.** The 14-metric voice profile (sentence length, contraction rate, punctuation habits, lexical diversity, etc.) and the weighted distance function are genuinely useful for batch consistency work. The blend/target/outlier system is a real differentiator.

**The rewriter is conservative by design.** It only removes and restructures. It never invents content. This is the right philosophy for a tool that claims to de-slop text.

## Issues and improvement areas

### 1. Sentence splitting is fragile

`SENTENCE_RE` splits on `(?<=[.!?])\s+(?=[\"'A-Z0-9])`. This breaks on:

- Abbreviations: "Dr. Smith arrived." splits at "Dr."
- Decimal numbers: "The rate was 3.5 percent." splits at "3."
- Quoted speech mid-sentence: "She said 'hello.' He nodded."
- Ellipses: "And then... it happened."
- Initials: "J. R. R. Tolkien wrote it."

This is the single most impactful weakness. Every downstream metric (sentence length, rhythm, repeated starts, monotonous runs) depends on correct sentence boundaries. Bad splits cascade into incorrect quality scores and wrong rewriting decisions.

**Recommendation:** Replace with a more robust splitter. Either use a rules-based approach with abbreviation lists, or integrate a lightweight sentence tokeniser (e.g. `nltk.sent_tokenize` or a custom regex that handles common abbreviations). At minimum, add a negative lookbehind for common titles and abbreviations: Mr., Mrs., Dr., St., vs., etc., e.g., i.e.

### 2. cleanup_sentence is too aggressive with intensifiers

Line 527: `re.sub(r"\b(very|really|quite|rather|somewhat|actually|basically|simply)\b\s*", "", ...)` removes ALL instances of these words regardless of context.

- "He was actually innocent" becomes "He was innocent" -- meaning changes.
- "The data was quite clear on this point" becomes "The data was clear on this point" -- loses hedging that may be intentional.
- "She simply walked away" becomes "She walked away" -- loses the emphasis that "simply" provides here.

**Recommendation:** Only remove intensifiers that directly modify adjectives or adverbs (i.e. "very + adjective" patterns). Leave standalone uses. The annotation system already flags stacked intensifiers (2+) correctly -- the rewriter should respect the same threshold rather than strip all of them.

### 3. Em-dash handling destroys valid punctuation

Line 529: `updated.replace("—", ", ").replace("--", ", ")` converts all em dashes to commas unconditionally. This is wrong for:

- Parenthetical asides: "The project -- already behind schedule -- needed more time" becomes "The project, already behind schedule, needed more time" which is acceptable but changes register
- Terminal dashes: "He had one thing to say --" becomes "He had one thing to say," which is grammatically broken
- Dialogue attribution in fiction: "I don't think --" becomes broken

The annotation correctly flags em dashes as a synthetic cadence risk (severity 52), which is a good detection. But the rewrite pass should not blindly replace them all.

**Recommendation:** Only replace em dashes that appear between two clauses (detectable by checking for words on both sides). Leave terminal dashes, dialogue dashes, and single-dash uses alone. Better: make this configurable per document mode -- fiction should preserve em dashes more than business.

### 4. The "started to" / "began to" removal is unsafe

Line 528: `re.sub(r"\b(started|began) to\b", "", ...)` removes the words entirely, which can leave grammatically broken sentences.

- "He started to run." becomes "He run." -- broken
- "They began to understand." becomes "They understand." -- tense shift

**Recommendation:** Replace "started to [verb]" with just the verb in past tense, or flag it for annotation rather than rewriting it. The progressive-to-past mapping already exists in `app.js` (the `PROGRESSIVE_TO_PAST` dictionary) but is not used in the Python engine.

### 5. Document mode bias rules are too thin

`apply_document_mode_bias` has:

- Business/essay: 4 substitution rules
- Marketing: 3 substitution rules
- Fiction/worldbuilding: 1 substitution rule

This is the right architectural idea but the rule sets are too small to make a meaningful mode-specific difference. The modes are advertised as a key feature but the actual differentiation is minimal.

**Recommendation:** Expand each mode's rule set. Examples:

- **Business:** Strip hedging phrases ("it could be argued that", "one might say"), remove narrative framing ("imagine a world where"), flag rhetorical questions
- **Marketing:** Strip superlatives that lack specificity ("revolutionary", "game-changing", "cutting-edge"), flag unsubstantiated claims
- **Fiction:** Protect em dashes, protect sentence fragments (they are stylistic), reduce intensifier removal aggressiveness, protect dialogue patterns
- **Worldbuilding:** Protect technical terminology, reduce abstract-word penalties for words like "framework" and "system" that are literal in technical contexts
- **Essay:** Strip first-person hedging ("I believe", "in my opinion"), flag rhetorical padding ("it goes without saying")

### 6. Lexical diversity penalisation has a text-length bias

`lexical_diversity = unique_tokens / total_tokens`. This metric naturally decreases with text length because common function words (the, a, is, and) recur. A 5,000-word document will always have lower lexical diversity than a 200-word passage, regardless of quality.

The detector risk formula penalises low lexical diversity: `max(0.0, 0.72 - lexical_diversity(tokens)) * 70`. This means longer documents are systematically penalised more heavily.

**Recommendation:** Either normalise for text length (e.g. use a moving window approach, measuring diversity per 200-token chunk and averaging), or adjust the threshold dynamically based on word count.

### 7. The rewrite pass can reduce its own quality score

Because `cleanup_sentence` removes words, it can reduce lexical diversity (by removing unique words while keeping common ones). It can also create monotonous runs by making sentences more similar in length after trimming. The engine then measures the revised text and sometimes finds it scored lower than the original on certain axes.

The `accepted` flag in the response partly addresses this (`accepted: change_count == 0 or quality_delta >= 0 or detector_risk_delta >= 0`), but the logic is too permissive -- it accepts if EITHER metric improved, even if the other got significantly worse.

**Recommendation:** Add a guard to the rewrite pass: after rewriting, check quality_delta. If it is negative and detector_risk_delta is also negative (both got worse), fall back to the original text. This prevents the rewriter from making things worse.

### 8. Modifier rate counts all -ly adverbs

Line 261: `sum(1 for token in tokens if token in INTENSIFIERS or token.endswith("ly"))`. Counting all -ly words as modifiers penalises words like "family", "only", "early", "likely", "particularly", "finally" -- many of which are not intensifiers or modifiers.

**Recommendation:** Either maintain an explicit modifier list (like `INTENSIFIERS` but for adverbs), or add an exclusion list for common -ly words that are not stylistic modifiers: family, only, early, likely, elderly, friendly, lonely, daily, etc.

### 9. No handling of markdown or structured text

The engine treats all text as flat prose. If the input contains markdown headings, bullet lists, code blocks, or URLs, these get sentence-split and cleaned alongside prose text, which can produce broken output.

**Recommendation:** Add a pre-processing step that extracts prose blocks from markdown, processes them, and reassembles. At minimum, skip lines that start with `#`, `-`, `*`, `>`, or contain URLs/code fences.

### 10. Missing signal: passive voice density

Passive voice is one of the strongest AI-prose tells ("it was determined that", "the decision was made to", "it can be seen that"). The engine does not detect or score it.

**Recommendation:** Add a passive voice detector. A simple heuristic: count instances of `(was|were|been|being|is|are) + past_participle` patterns. Weight it into both the quality score (affects directness) and the detector risk score.

## Priority ranking

If making improvements, this is the order I would work in:

1. **Sentence splitting** -- highest impact, affects all downstream metrics
2. **"started to" removal** -- actively produces broken output
3. **Intensifier stripping** -- over-aggressive, changes meaning
4. **Em-dash handling** -- destroys valid punctuation in fiction
5. **Modifier -ly counting** -- inflates scores incorrectly
6. **Rewrite quality guard** -- prevents self-degradation
7. **Passive voice detection** -- missing signal, high value
8. **Document mode expansion** -- feature advertised but underdeveloped
9. **Lexical diversity normalisation** -- systematic bias on long texts
10. **Markdown handling** -- important for real-world input
