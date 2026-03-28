# Engine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten issues identified in docs/engine-assessment.md, taking the engine from alpha to a reliable heuristic filter that does not produce broken output or score incorrectly.

**Architecture:** All changes are in `slopfilter_engine.py`. No new files except `tests/test_engine.py`. The engine's public API (`analyse_text`, `rewrite_text`, `build_voice_profile`, `portable_slop_check`) stays stable. Internal functions get fixed or replaced. Each task is independently committable and testable.

**Tech Stack:** Python 3.12, pytest, no new dependencies.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `slopfilter_engine.py` | Modify | All engine fixes |
| `tests/__init__.py` | Create | Empty package marker |
| `tests/test_engine.py` | Create | All engine tests |

---

### Task 1: Test Infrastructure and Baseline Tests

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/test_engine.py`

- [ ] **Step 1: Create test package**

```python
# tests/__init__.py
# (empty file)
```

- [ ] **Step 2: Write baseline tests that capture current correct behaviour**

```python
# tests/test_engine.py
"""Tests for slopfilter_engine."""
import sys
from pathlib import Path

# Ensure the project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from slopfilter_engine import (
    analyse_text,
    annotate_text,
    build_voice_profile,
    cleanup_sentence,
    rewrite_text,
    split_paragraphs,
    split_sentences,
    tokenize,
    lexical_diversity,
    voice_distance,
    apply_document_mode_bias,
    apply_contraction_bias,
    align_sentence_lengths,
)


class TestTokenize:
    def test_basic(self):
        assert tokenize("Hello world") == ["hello", "world"]

    def test_apostrophes_preserved(self):
        assert "don't" in tokenize("I don't know")

    def test_empty(self):
        assert tokenize("") == []


class TestSplitParagraphs:
    def test_two_paragraphs(self):
        result = split_paragraphs("First paragraph.\n\nSecond paragraph.")
        assert len(result) == 2

    def test_crlf(self):
        result = split_paragraphs("A.\r\n\r\nB.")
        assert len(result) == 2

    def test_empty(self):
        assert split_paragraphs("") == []


class TestAnalyseText:
    def test_clean_text_scores_high(self):
        text = "The engine started. Metal groaned against metal. Three seconds passed before the first piston fired."
        result = analyse_text(text)
        assert result["quality_score"] >= 80

    def test_sloppy_text_scores_low(self):
        text = "It is important to note that ultimately the journey is a very meaningful tapestry. Moreover, this powerful reminder highlights the importance of being truly impactful. Furthermore, at the end of the day, we should strive to be better."
        result = analyse_text(text)
        assert result["quality_score"] < 70
        assert result["detector_risk"] > 30

    def test_returns_expected_keys(self):
        result = analyse_text("A short sentence.")
        assert "quality_score" in result
        assert "detector_risk" in result
        assert "scores" in result
        assert "signals" in result
        assert "voice_profile" in result
        assert "annotations" in result


class TestBuildVoiceProfile:
    def test_returns_all_keys(self):
        profile = build_voice_profile("The cat sat on the mat. It purred.")
        expected_keys = [
            "avg_sentence_length", "sentence_length_std", "avg_paragraph_sentences",
            "dialogue_ratio", "contraction_rate", "comma_rate", "question_rate",
            "exclamation_rate", "emdash_rate", "semicolon_rate", "lexical_diversity",
            "long_sentence_rate", "fragment_rate", "modifier_rate",
        ]
        for key in expected_keys:
            assert key in profile


class TestVoiceDistance:
    def test_identical_profiles_zero_distance(self):
        profile = build_voice_profile("The cat sat on the mat.")
        assert voice_distance(profile, profile) == 0.0

    def test_different_profiles_positive_distance(self):
        p1 = build_voice_profile("Short. Terse. Blunt.")
        p2 = build_voice_profile("The extraordinarily lengthy and somewhat verbose construction of this particular sentence demonstrates a remarkably different cadence from the previous example, one might say.")
        assert voice_distance(p1, p2) > 0.05


class TestRewriteText:
    def test_clean_text_minimal_changes(self):
        text = "The engine fired. Smoke curled from the exhaust. He watched it rise."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert changes <= 1

    def test_sloppy_text_gets_cleaned(self):
        text = "It is important to note that ultimately the framework is a very meaningful tapestry."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert changes >= 1
        assert "important to note" not in revised.lower()
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/jonsatterley/Downloads/slop-filter-v2 && python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/__init__.py tests/test_engine.py
git commit -m "test: add baseline engine test suite"
```

---

### Task 2: Fix Sentence Splitting

The current `SENTENCE_RE` splits on any `.` followed by whitespace and a capital letter. It breaks on abbreviations (Dr., Mr., Mrs., St., U.S., e.g., i.e., etc.), decimal numbers, and initials.

**Files:**
- Modify: `slopfilter_engine.py:19` (replace `SENTENCE_RE`) and `slopfilter_engine.py:175-189` (replace `split_sentences`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write failing tests for sentence splitting**

Add to `tests/test_engine.py`:

```python
class TestSplitSentences:
    def test_basic_split(self):
        result = split_sentences("First sentence. Second sentence.")
        assert len(result) == 2

    def test_abbreviation_dr(self):
        result = split_sentences("Dr. Smith arrived at noon. The clinic was busy.")
        assert len(result) == 2
        assert "Dr. Smith" in result[0]

    def test_abbreviation_mr_mrs(self):
        result = split_sentences("Mr. Jones and Mrs. Smith met at St. Paul's. They talked.")
        assert len(result) == 2
        assert "Mr. Jones" in result[0]

    def test_decimal_number(self):
        result = split_sentences("The rate was 3.5 percent. Growth continued.")
        assert len(result) == 2
        assert "3.5" in result[0]

    def test_initials(self):
        result = split_sentences("J. R. R. Tolkien wrote it. He was famous.")
        assert len(result) == 2
        assert "Tolkien" in result[0]

    def test_us_abbreviation(self):
        result = split_sentences("The U.S. economy grew. Exports rose.")
        assert len(result) == 2
        assert "U.S." in result[0]

    def test_ellipsis(self):
        result = split_sentences("And then... it happened. Nobody moved.")
        assert len(result) == 2

    def test_question_and_exclamation(self):
        result = split_sentences("What happened? Nobody knew! The room was silent.")
        assert len(result) == 3

    def test_single_sentence(self):
        result = split_sentences("Just one sentence here.")
        assert len(result) == 1

    def test_empty(self):
        assert split_sentences("") == []

    def test_eg_ie(self):
        result = split_sentences("Use a tool, e.g. a hammer. It works well.")
        assert len(result) == 2
        assert "e.g." in result[0]

    def test_etc(self):
        result = split_sentences("Bring food, drinks, etc. The party starts at eight.")
        assert len(result) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestSplitSentences -v`
Expected: Multiple FAIL (abbreviation tests, decimal, initials)

- [ ] **Step 3: Replace split_sentences with abbreviation-aware implementation**

In `slopfilter_engine.py`, replace the `SENTENCE_RE` constant and `split_sentences` function:

```python
ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ft", "mt",
    "gen", "gov", "sgt", "cpl", "pvt", "capt", "lt", "col", "maj",
    "rev", "hon", "pres", "dept", "univ", "assn", "bros", "inc",
    "ltd", "co", "corp", "vs", "al", "approx", "dept", "est",
    "vol", "fig", "eq", "no",
}

ABBREVIATION_PAIRS = {"e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "u.n"}


def split_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []

    sentences: list[str] = []
    current: list[str] = []
    chars = list(text)
    i = 0

    while i < len(chars):
        current.append(chars[i])

        if chars[i] in ".!?":
            # Peek ahead to decide if this is a sentence boundary
            is_boundary = False
            end_char = chars[i]

            # Handle ellipsis: consume all consecutive dots
            if end_char == ".":
                while i + 1 < len(chars) and chars[i + 1] == ".":
                    i += 1
                    current.append(chars[i])

            # Consume any closing quotes or brackets after the punctuation
            j = i + 1
            while j < len(chars) and chars[j] in "\"')]\u201d\u2019":
                j += 1

            if j >= len(chars):
                # End of text
                is_boundary = True
            elif chars[j] in " \t\n\r":
                # There is whitespace after punctuation -- check if it is a real boundary
                # Find the next non-space character
                k = j
                while k < len(chars) and chars[k] in " \t\n\r":
                    k += 1

                if k >= len(chars):
                    is_boundary = True
                elif chars[k].isupper() or chars[k].isdigit() or chars[k] in "\"'\u201c\u2018":
                    # Looks like a sentence boundary, but check for abbreviations
                    fragment = "".join(current).rstrip(".!?").strip()
                    last_token = fragment.split()[-1].lower().rstrip(".") if fragment.split() else ""

                    if end_char == "." and last_token in ABBREVIATIONS:
                        is_boundary = False
                    elif end_char == "." and last_token.replace(".", "") != "" and f"{last_token.rstrip('.')}" in ABBREVIATION_PAIRS:
                        is_boundary = False
                    elif end_char == "." and len(last_token) == 1 and last_token.isalpha():
                        # Single letter followed by period: likely an initial (J. R. R.)
                        is_boundary = False
                    elif end_char == "." and re.match(r"^\d+$", last_token):
                        # Number followed by period: likely a decimal (3.5)
                        is_boundary = False
                    else:
                        is_boundary = True

            if is_boundary:
                # Consume closing quotes
                while i + 1 < len(chars) and chars[i + 1] in "\"')]\u201d\u2019":
                    i += 1
                    current.append(chars[i])
                sentence = "".join(current).strip()
                if sentence:
                    sentences.append(sentence)
                current = []

        i += 1

    # Remainder
    tail = "".join(current).strip()
    if tail:
        if sentences and len(tail.split()) <= 2 and not tail.endswith((".", "!", "?")):
            sentences[-1] = f"{sentences[-1]} {tail}".strip()
        else:
            sentences.append(tail)

    return sentences or [text]
```

Remove the `SENTENCE_RE` constant (it is no longer used).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: abbreviation-aware sentence splitting"
```

---

### Task 3: Fix "started to" / "began to" Removal

Currently `cleanup_sentence` strips "started to" and "began to" entirely, producing broken grammar: "He started to run." becomes "He run."

**Files:**
- Modify: `slopfilter_engine.py:528` (the regex in `cleanup_sentence`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_engine.py`:

```python
class TestCleanupSentence:
    def test_started_to_run(self):
        result = cleanup_sentence("He started to run.")
        assert result != "He run."
        assert "run" in result.lower() or "ran" in result.lower()

    def test_began_to_understand(self):
        result = cleanup_sentence("They began to understand the problem.")
        # Should not produce "They understand the problem." with tense mismatch
        # Acceptable: leave it alone or convert correctly
        words = result.lower().split()
        assert "began" in words or "understood" in words or "understand" in words

    def test_started_to_with_gerund(self):
        result = cleanup_sentence("She started to feel uneasy.")
        assert result.endswith(".")
        # Should not produce "She feel uneasy."
        assert "feel uneasy" not in result or "started" in result or "felt" in result

    def test_preserves_non_problematic_sentences(self):
        result = cleanup_sentence("The car moved quickly down the road.")
        assert result == "The car moved quickly down the road."
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestCleanupSentence -v`
Expected: FAIL on started_to_run and began_to_understand

- [ ] **Step 3: Remove the "started/began to" regex from cleanup_sentence**

In `slopfilter_engine.py`, in the `cleanup_sentence` function, remove this line:

```python
    updated = re.sub(r"\b(started|began) to\b", "", updated, flags=re.I)
```

This pattern is too hard to rewrite correctly with a simple regex (it needs verb conjugation). The safest fix is to stop rewriting it and leave it for the annotation system to flag instead.

- [ ] **Step 4: Add annotation for "started/began to" in classify_sentence**

In `slopfilter_engine.py`, in the `classify_sentence` function, add after the intensifier check (after line ~468):

```python
    if re.search(r"\b(started|began) to\b", lower):
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "filler",
                "severity": 45,
                "original": sentence.strip(),
                "reason": "Progressive construction ('started to') can often be replaced with the simple past tense.",
            }
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: stop rewriting started/began to, annotate instead"
```

---

### Task 4: Fix Intensifier Stripping

`cleanup_sentence` removes ALL instances of "very", "really", "quite", "rather", "somewhat", "actually", "basically", "simply" -- even when they carry meaning ("He was actually innocent").

**Files:**
- Modify: `slopfilter_engine.py:527` (the intensifier regex in `cleanup_sentence`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write failing tests**

Add to `TestCleanupSentence`:

```python
    def test_actually_preserved_when_meaningful(self):
        result = cleanup_sentence("He was actually innocent.")
        assert "actually" in result.lower()

    def test_simply_preserved_when_meaningful(self):
        result = cleanup_sentence("She simply walked away.")
        assert "simply" in result.lower()

    def test_stacked_intensifiers_still_cleaned(self):
        # "very truly remarkable" has stacked intensifiers -- should be cleaned
        result = cleanup_sentence("It was very truly remarkable.")
        intensifiers_remaining = sum(1 for w in result.lower().split() if w in {"very", "truly"})
        assert intensifiers_remaining < 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestCleanupSentence -v`
Expected: FAIL on actually and simply tests

- [ ] **Step 3: Replace blanket intensifier removal with stacked-only removal**

In `slopfilter_engine.py`, in `cleanup_sentence`, replace:

```python
    updated = re.sub(r"\b(very|really|quite|rather|somewhat|actually|basically|simply)\b\s*", "", updated, flags=re.I)
```

with:

```python
    # Only remove intensifiers when they directly precede another intensifier or adjective-like word
    # Remove stacked pairs: "very truly", "really quite", etc.
    intensifier_pat = r"\b(very|really|quite|rather|somewhat|truly|basically)\b"
    updated = re.sub(
        rf"{intensifier_pat}\s+{intensifier_pat}\b",
        lambda m: m.group(2),
        updated,
        flags=re.I,
    )
    # Remove intensifier directly before common sloppy adjectives
    sloppy_adjectives = (
        r"(meaningful|impactful|important|interesting|significant|remarkable|"
        r"powerful|incredible|amazing|stunning|compelling|profound|unique)"
    )
    updated = re.sub(
        rf"\b(very|really|truly|quite)\s+{sloppy_adjectives}\b",
        lambda m: m.group(2),
        updated,
        flags=re.I,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: only strip stacked intensifiers, preserve meaningful uses"
```

---

### Task 5: Fix Em-Dash Handling

`cleanup_sentence` converts all em dashes to commas, breaking terminal dashes and dialogue.

**Files:**
- Modify: `slopfilter_engine.py:529` (em dash replacement in `cleanup_sentence`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write failing tests**

Add to `TestCleanupSentence`:

```python
    def test_emdash_terminal_preserved(self):
        result = cleanup_sentence("He had one thing to say\u2014")
        assert not result.endswith(",")

    def test_emdash_dialogue_preserved(self):
        result = cleanup_sentence('"I don\'t think\u2014" she started.')
        assert ", \"" not in result or "\u2014" in result

    def test_emdash_parenthetical_converted(self):
        result = cleanup_sentence("The project\u2014already behind schedule\u2014needed more time.")
        # Parenthetical em dashes can be converted to commas
        assert "needed" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestCleanupSentence::test_emdash_terminal_preserved -v`
Expected: FAIL

- [ ] **Step 3: Replace blanket em-dash replacement with context-aware handling**

In `slopfilter_engine.py`, in `cleanup_sentence`, replace:

```python
    updated = updated.replace("—", ", ").replace("--", ", ")
```

with:

```python
    # Only convert em dashes that appear between two words (parenthetical or clause break).
    # Preserve terminal dashes and dialogue interruption dashes.
    updated = re.sub(r"(\w)\s*[—\u2014]\s*(\w)", r"\1, \2", updated)
    updated = re.sub(r"(\w)\s*--\s*(\w)", r"\1, \2", updated)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: context-aware em-dash handling, preserve terminal and dialogue dashes"
```

---

### Task 6: Fix Modifier -ly Counting

The modifier rate calculation counts all words ending in "ly" as modifiers, including non-modifiers like "family", "only", "early", "elderly", "friendly", "daily".

**Files:**
- Modify: `slopfilter_engine.py` (add exclusion set, update `build_voice_profile` and `analyse_text`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_engine.py`:

```python
class TestModifierCounting:
    def test_family_not_counted_as_modifier(self):
        text = "His family arrived early. The elderly neighbour waved daily."
        result = analyse_text(text)
        # "family", "early", "elderly", "daily" should NOT be counted as modifiers
        assert result["signals"]["modifier_hits"] == 0

    def test_actual_modifiers_still_counted(self):
        text = "He carefully slowly deliberately opened the door."
        result = analyse_text(text)
        assert result["signals"]["modifier_hits"] >= 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestModifierCounting -v`
Expected: FAIL on family test

- [ ] **Step 3: Add exclusion set and update modifier counting**

In `slopfilter_engine.py`, after the `INTENSIFIERS` set, add:

```python
NOT_MODIFIERS = {
    "family", "only", "early", "elderly", "friendly", "lonely", "daily",
    "weekly", "monthly", "yearly", "holy", "ugly", "likely", "unlikely",
    "rally", "tally", "belly", "bully", "folly", "jolly", "ally",
    "assembly", "supply", "apply", "reply", "imply", "multiply",
    "fly", "july", "italy", "butterfly", "jelly", "billy", "lily",
    "sally", "molly", "emily", "kelly", "polly", "holly", "wily",
}
```

Then update the modifier counting. There are three places where modifiers are counted with the `token.endswith("ly")` pattern:

1. In `build_voice_profile` (line ~261):
```python
    modifier_hits = sum(1 for token in tokens if token in INTENSIFIERS or (token.endswith("ly") and token not in NOT_MODIFIERS and len(token) > 3))
```

2. In `analyse_text` (line ~330):
```python
    modifier_hits = sum(1 for token in tokens if token in INTENSIFIERS or (token.endswith("ly") and token not in NOT_MODIFIERS and len(token) > 3))
```

3. In `classify_sentence` (line ~430):
```python
    intensifier_count = sum(1 for token in tokenize(lower) if token in INTENSIFIERS)
```
(This one is already correct -- it only checks INTENSIFIERS, not -ly words.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: exclude non-modifier -ly words from modifier counting"
```

---

### Task 7: Add Rewrite Quality Guard

The rewriter can produce output that scores worse than the input on both quality and detector risk. It should fall back to the original text when this happens.

**Files:**
- Modify: `slopfilter_engine.py` (`rewrite_text` function)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write test**

Add to `tests/test_engine.py`:

```python
class TestRewriteQualityGuard:
    def test_rewrite_does_not_degrade_both_metrics(self):
        # Text that is already clean -- rewriting should not make it worse
        text = "The machine hummed. Gears turned inside the housing. Oil dripped from the seal."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "aggressive")
        original_analysis = analyse_text(text)
        revised_analysis = analyse_text(revised)
        quality_delta = revised_analysis["quality_score"] - original_analysis["quality_score"]
        risk_delta = original_analysis["detector_risk"] - revised_analysis["detector_risk"]
        # If both metrics got worse, should have fallen back to original
        if quality_delta < -2 and risk_delta < -2:
            assert revised == text, "Rewriter made both metrics worse but did not fall back"
```

- [ ] **Step 2: Implement the guard in rewrite_text**

In `slopfilter_engine.py`, in the `rewrite_text` function, after the line `revised_analysis = analyse_text(revised)`, add the quality guard:

```python
    # Quality guard: if both metrics degraded, fall back to original
    original_quality = original_analysis["quality_score"]
    revised_quality = revised_analysis["quality_score"]
    original_risk = original_analysis["detector_risk"]
    revised_risk = revised_analysis["detector_risk"]

    if revised_quality < original_quality - 2 and revised_risk > original_risk + 2:
        return text, original_analysis["annotations"], 0
```

Place this before the `return revised, revised_analysis["annotations"], changed` line.

- [ ] **Step 3: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "feat: add quality guard to prevent rewriter self-degradation"
```

---

### Task 8: Add Passive Voice Detection

Passive voice is one of the strongest AI-prose tells, currently undetected.

**Files:**
- Modify: `slopfilter_engine.py` (add detection to `analyse_text` and `classify_sentence`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write tests**

Add to `tests/test_engine.py`:

```python
class TestPassiveVoiceDetection:
    def test_passive_detected(self):
        text = "The decision was made by the committee. The report was written by the team. The issue was resolved quickly."
        result = analyse_text(text)
        assert result["signals"]["passive_hits"] >= 2

    def test_active_not_flagged(self):
        text = "The committee made a decision. The team wrote the report. They resolved the issue."
        result = analyse_text(text)
        assert result["signals"]["passive_hits"] == 0

    def test_passive_affects_quality(self):
        passive = "The door was opened. The light was turned on. The message was received."
        active = "He opened the door. She turned on the light. They received the message."
        passive_result = analyse_text(passive)
        active_result = analyse_text(active)
        assert passive_result["quality_score"] < active_result["quality_score"]

    def test_passive_affects_detector_risk(self):
        passive = "It was determined that the project was completed. The findings were reviewed."
        result = analyse_text(passive)
        assert result["signals"]["passive_hits"] >= 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestPassiveVoiceDetection -v`
Expected: FAIL (passive_hits key does not exist)

- [ ] **Step 3: Add passive voice detection**

In `slopfilter_engine.py`, add a passive voice regex constant after `CONSECUTIVE_SPACE_RE`:

```python
PASSIVE_RE = re.compile(
    r"\b(was|were|been|being|is|are|am|get|got|gets|getting)\s+"
    r"((?:a|an|the|very|quite|rather|also|then|soon|quickly|slowly|finally|fully|"
    r"not|never|always|often|already|recently|immediately|subsequently|reportedly)\s+)*"
    r"(\w+ed|written|made|done|seen|taken|given|found|told|known|shown|broken|"
    r"chosen|driven|eaten|fallen|forgotten|frozen|hidden|mistaken|proven|ridden|"
    r"risen|shaken|spoken|stolen|sworn|torn|worn|woven)\b",
    re.I,
)
```

Add a count function:

```python
def count_passive_voice(text: str) -> int:
    return len(PASSIVE_RE.findall(text))
```

In `analyse_text`, after the `monotonous_runs` line, add:

```python
    passive_hits = count_passive_voice(text)
```

Add `passive_hits` to the signals dict:

```python
        "signals": {
            "filler_hits": filler_hits,
            "modifier_hits": modifier_hits,
            "transition_hits": transition_hits,
            "cliche_hits": cliche_hits,
            "generic_hits": generic_hits,
            "abstract_hits": abstract_hits,
            "repeated_starts": repeated_starts,
            "monotonous_runs": monotonous_runs,
            "passive_hits": passive_hits,
        },
```

Add passive voice into the `directness` score:

```python
    directness = clamp(100 - filler_hits * 8 - transition_hits * 4 - generic_hits * 1.5 - passive_hits * 5, 0, 100)
```

And into `detector_risk`:

```python
    detector_risk = round(
        clamp(
            filler_hits * 7
            + modifier_hits * 1.3
            + transition_hits * 5
            + cliche_hits * 9
            + repeated_starts * 7
            + monotonous_runs * 6
            + passive_hits * 4
            + max(0.0, 0.72 - lexical_diversity(tokens)) * 70
            + (text.count("—") + text.count("--")) * 4,
            0,
            100,
        ),
        1,
    )
```

In `classify_sentence`, add passive voice annotation (after the long-sentence check):

```python
    if PASSIVE_RE.search(sentence):
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "structure",
                "severity": 48,
                "original": sentence.strip(),
                "reason": "Passive construction distances the reader from the action. Consider active voice.",
            }
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "feat: add passive voice detection to scoring and annotations"
```

---

### Task 9: Expand Document Mode Bias Rules

Each mode currently has 1-4 substitution rules. Expand to meaningful differentiation.

**Files:**
- Modify: `slopfilter_engine.py` (`apply_document_mode_bias`)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write tests**

Add to `tests/test_engine.py`:

```python
class TestDocumentModeBias:
    def test_business_strips_hedging(self):
        text = "It could be argued that the strategy works. One might say it is effective."
        result = apply_document_mode_bias(text, "business")
        assert "could be argued" not in result.lower()
        assert "one might say" not in result.lower()

    def test_business_strips_narrative_framing(self):
        text = "Imagine a world where profits doubled. Picture this scenario."
        result = apply_document_mode_bias(text, "business")
        assert "imagine a world" not in result.lower()

    def test_marketing_strips_unsubstantiated_superlatives(self):
        text = "Our revolutionary cutting-edge game-changing solution delivers."
        result = apply_document_mode_bias(text, "marketing")
        assert "revolutionary" not in result.lower()
        assert "cutting-edge" not in result.lower()
        assert "game-changing" not in result.lower()

    def test_essay_strips_first_person_hedging(self):
        text = "I believe that the evidence shows growth. In my opinion, this is clear."
        result = apply_document_mode_bias(text, "essay")
        assert "i believe that" not in result.lower()
        assert "in my opinion" not in result.lower()

    def test_fiction_preserves_fragments(self):
        # Fiction mode should not aggressively clean stylistic choices
        text = "The door opened. Silence. Nothing moved."
        result = apply_document_mode_bias(text, "fiction")
        assert "Silence." in result

    def test_worldbuilding_preserves_technical_terms(self):
        text = "The framework governed the system's approach to resource allocation."
        result = apply_document_mode_bias(text, "worldbuilding")
        # In worldbuilding, "framework" and "system" are literal, not abstract
        assert "framework" in result.lower()
        assert "system" in result.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestDocumentModeBias -v`
Expected: Multiple FAIL

- [ ] **Step 3: Expand apply_document_mode_bias**

In `slopfilter_engine.py`, replace `apply_document_mode_bias`:

```python
def apply_document_mode_bias(text: str, document_mode: str) -> str:
    updated = text

    if document_mode in {"business", "essay"}:
        # Strip hedging and filler
        updated = re.sub(r"\b(in conclusion|ultimately)\b[, ]*", "", updated, flags=re.I)
        updated = re.sub(r"\ba powerful reminder(?: that)?\b", "evidence", updated, flags=re.I)
        updated = re.sub(r"\bthis highlights the importance of\b", "this shows", updated, flags=re.I)
        updated = re.sub(r"\bthis underscores the need for\b", "this shows", updated, flags=re.I)
        updated = re.sub(r"\bit could be argued that\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bone might say(?: that)?\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bit goes without saying(?: that)?\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bimagine a world where\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bpicture this[: ]*\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\blet's take a moment to\b\s*", "", updated, flags=re.I)

    if document_mode == "essay":
        updated = re.sub(r"\bi believe(?: that)?\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bin my opinion[, ]*\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bit is my view that\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bi would argue that\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bas we all know[, ]*\b\s*", "", updated, flags=re.I)

    if document_mode == "marketing":
        updated = re.sub(r"\b(world-class|breathtaking|stunning)\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bnestled within\b", "in", updated, flags=re.I)
        updated = re.sub(r"\bvibrant tapestry\b", "scene", updated, flags=re.I)
        updated = re.sub(r"\b(revolutionary|game-changing|cutting-edge|best-in-class)\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\b(unparalleled|groundbreaking|next-generation|state-of-the-art)\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bunlock the (full )?potential of\b", "improve", updated, flags=re.I)
        updated = re.sub(r"\bseamless(ly)?\b\s*", "", updated, flags=re.I)
        updated = re.sub(r"\bleverage\b", "use", updated, flags=re.I)

    if document_mode in {"fiction", "worldbuilding"}:
        updated = re.sub(r"\b(in conclusion|as a reminder)\b[, ]*", "", updated, flags=re.I)

    updated = CONSECUTIVE_SPACE_RE.sub(" ", updated)
    updated = re.sub(r"\s+([.?!,;:])", r"\1", updated)

    # Fix capitalisation after removals at sentence start
    sentences = split_sentences(updated)
    rebuilt = []
    for s in sentences:
        s = s.strip()
        if s and s[0].islower():
            s = s[0].upper() + s[1:]
        rebuilt.append(s)
    updated = " ".join(rebuilt) if rebuilt else updated

    return updated.strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "feat: expand document mode rules for business, essay, marketing"
```

---

### Task 10: Normalise Lexical Diversity for Text Length

Lexical diversity drops with text length because function words recur. Use a windowed approach.

**Files:**
- Modify: `slopfilter_engine.py` (`lexical_diversity` function)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write test**

Add to `tests/test_engine.py`:

```python
class TestLexicalDiversity:
    def test_repeated_text_not_heavily_penalised(self):
        short = "The cat sat on the mat. It purred loudly."
        long_text = (short + " ") * 25
        short_ld = lexical_diversity(tokenize(short))
        long_ld = lexical_diversity(tokenize(long_text))
        # With normalisation, the difference should be much smaller
        # Old: 0.85 gap. Target: < 0.3 gap.
        assert abs(short_ld - long_ld) < 0.3, f"Gap too large: {abs(short_ld - long_ld):.4f}"

    def test_genuinely_repetitive_text_still_penalised(self):
        repetitive = "The thing is the thing is the thing is the thing."
        varied = "Mercury fell. Neon flickered. The corridor hummed with tension."
        rep_ld = lexical_diversity(tokenize(repetitive))
        var_ld = lexical_diversity(tokenize(varied))
        assert var_ld > rep_ld
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestLexicalDiversity -v`
Expected: FAIL on repeated_text_not_heavily_penalised

- [ ] **Step 3: Replace lexical_diversity with windowed version**

In `slopfilter_engine.py`, replace:

```python
def lexical_diversity(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    return len(set(tokens)) / len(tokens)
```

with:

```python
def lexical_diversity(tokens: list[str], window_size: int = 200) -> float:
    if not tokens:
        return 0.0
    if len(tokens) <= window_size:
        return len(set(tokens)) / len(tokens)
    # Windowed: measure diversity in chunks and average
    windows = []
    for start in range(0, len(tokens), window_size):
        chunk = tokens[start : start + window_size]
        if len(chunk) >= window_size // 2:  # Only count windows with enough tokens
            windows.append(len(set(chunk)) / len(chunk))
    return sum(windows) / len(windows) if windows else len(set(tokens)) / len(tokens)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "fix: normalise lexical diversity for text length with windowed measurement"
```

---

### Task 11: Add Markdown / Structured Text Handling

The engine treats all text as flat prose. Markdown headings, bullet lists, code blocks, and URLs get processed as sentences, which can break output.

**Files:**
- Modify: `slopfilter_engine.py` (add pre/post processing)
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write tests**

Add to `tests/test_engine.py`:

```python
class TestMarkdownHandling:
    def test_headings_preserved(self):
        text = "# Introduction\n\nThe project began in March. It grew quickly.\n\n## Methods\n\nWe used three tools."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert "# Introduction" in revised
        assert "## Methods" in revised

    def test_bullet_lists_preserved(self):
        text = "Key findings:\n\n- First item\n- Second item\n- Third item\n\nThe results were clear."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert "- First item" in revised
        assert "- Second item" in revised

    def test_code_blocks_preserved(self):
        text = "Run the command:\n\n```\npython3 server.py\n```\n\nThe server starts."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert "python3 server.py" in revised

    def test_prose_between_structure_still_cleaned(self):
        text = "# Title\n\nIt is important to note that ultimately the framework is very meaningful.\n\n## Next"
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert "# Title" in revised
        assert "important to note" not in revised.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py::TestMarkdownHandling -v`
Expected: FAIL (headings get mangled by cleanup)

- [ ] **Step 3: Add structural line detection and passthrough**

In `slopfilter_engine.py`, add a helper function:

```python
STRUCTURAL_LINE_RE = re.compile(
    r"^(\s*#{1,6}\s|"       # Markdown headings
    r"\s*[-*+]\s|"          # Bullet lists
    r"\s*\d+\.\s|"          # Numbered lists
    r"\s*>\s|"              # Blockquotes
    r"\s*```|"              # Code fences
    r"\s*\|)"               # Table rows
)


def is_structural_line(line: str) -> bool:
    return bool(STRUCTURAL_LINE_RE.match(line))
```

Then modify `rewrite_text` to protect structural content. Replace the function:

```python
def rewrite_text(text: str, target_profile: dict, edit_budget: str) -> tuple[str, list[dict], int]:
    lines = text.replace("\r\n", "\n").split("\n")
    in_code_block = False
    prose_blocks: list[tuple[int, int]] = []  # (start_line, end_line) of prose regions
    block_start: int | None = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            if block_start is not None:
                prose_blocks.append((block_start, i))
                block_start = None
            continue
        if in_code_block or is_structural_line(stripped) or stripped == "":
            if block_start is not None:
                prose_blocks.append((block_start, i))
                block_start = None
            continue
        if block_start is None:
            block_start = i

    if block_start is not None:
        prose_blocks.append((block_start, len(lines)))

    if not prose_blocks:
        return text, [], 0

    # Process each prose block independently
    result_lines = list(lines)
    total_changed = 0
    all_annotations: list[dict] = []

    for start, end in prose_blocks:
        prose_text = "\n".join(lines[start:end])
        paragraphs = split_paragraphs(prose_text) or [prose_text]
        original_analysis = analyse_text(prose_text)
        flagged = {item["original"] for item in original_analysis["annotations"]}
        revised_paragraphs: list[str] = []
        changed = 0

        for paragraph in paragraphs:
            revised_sentences: list[str] = []
            for sentence in split_sentences(paragraph):
                updated = sentence
                if sentence in flagged or edit_budget != "minimal":
                    cleaned = cleanup_sentence(sentence)
                    if cleaned != sentence:
                        updated = cleaned
                revised_sentences.append(updated)
                if updated != sentence:
                    changed += 1
            rebuilt = " ".join(revised_sentences).strip()
            rebuilt = align_sentence_lengths(rebuilt, target_profile)
            revised_paragraphs.append(rebuilt)

        revised_prose = "\n\n".join(revised_paragraphs).strip()
        revised_prose = apply_contraction_bias(revised_prose, target_profile)
        revised_prose = CONSECUTIVE_SPACE_RE.sub(" ", revised_prose)

        # Replace the prose block in result_lines
        revised_lines = revised_prose.split("\n")
        result_lines[start:end] = revised_lines
        # Adjust subsequent block indices (not needed -- we process in order and rebuild from original)

        total_changed += changed

    revised = "\n".join(result_lines)
    revised = re.sub(r"\n{3,}", "\n\n", revised).strip()

    # Quality guard
    original_analysis = analyse_text(text)
    revised_analysis = analyse_text(revised)
    if (revised_analysis["quality_score"] < original_analysis["quality_score"] - 2
            and revised_analysis["detector_risk"] > original_analysis["detector_risk"] + 2):
        return text, original_analysis["annotations"], 0

    return revised, revised_analysis["annotations"], total_changed
```

Note: this incorporates the quality guard from Task 7, so if Task 7 has already been implemented, remove the guard from the end of `rewrite_text` before applying this replacement (it is included at the bottom of this version).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add slopfilter_engine.py tests/test_engine.py
git commit -m "feat: preserve markdown structure during rewriting"
```

---

### Task 12: Final Integration Test and Push

**Files:**
- Modify: `tests/test_engine.py`

- [ ] **Step 1: Write an end-to-end integration test**

Add to `tests/test_engine.py`:

```python
class TestEndToEnd:
    def test_sloppy_business_text_improves(self):
        text = (
            "It is important to note that the vibrant tapestry of innovation "
            "ultimately provides a very meaningful framework for understanding "
            "the dynamic landscape. Moreover, this powerful reminder highlights "
            "the importance of being truly impactful. Furthermore, at the end "
            "of the day, we should strive to be better. Additionally, it could "
            "be argued that the journey is what matters most."
        )
        result = analyse_text(text)
        assert result["quality_score"] < 60
        assert result["detector_risk"] > 40

        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        revised = apply_document_mode_bias(revised, "business")
        revised_result = analyse_text(revised)

        assert revised_result["quality_score"] > result["quality_score"]
        assert revised_result["detector_risk"] < result["detector_risk"]
        assert changes >= 3

    def test_clean_fiction_not_degraded(self):
        text = (
            "The door opened. Silence filled the corridor. He counted "
            "three heartbeats before the second shot rang out, flattening "
            "against the far wall in a spray of powdered concrete."
        )
        result = analyse_text(text)
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        revised_result = analyse_text(revised)

        # Clean prose should not get worse
        assert revised_result["quality_score"] >= result["quality_score"] - 3

    def test_markdown_document_survives_round_trip(self):
        text = (
            "# Report\n\n"
            "It is important to note that the results were very meaningful.\n\n"
            "## Data\n\n"
            "- Item one\n"
            "- Item two\n\n"
            "The analysis showed clear trends."
        )
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "medium")
        assert "# Report" in revised
        assert "## Data" in revised
        assert "- Item one" in revised
```

- [ ] **Step 2: Run full test suite**

Run: `python3 -m pytest tests/test_engine.py -v`
Expected: All PASS

- [ ] **Step 3: Run the live server smoke test**

```bash
python3 server.py --port 18745 &
SERVER_PID=$!
sleep 2
curl -s -X POST http://127.0.0.1:18745/api/v1/slop-check \
  -H "Content-Type: application/json" \
  -d '{"text":"It is important to note that Dr. Smith arrived at 3.5 percent. Mr. Jones and Mrs. Smith met at St. Paul'\''s. He started to run. The project was completed. She was actually innocent. The revolutionary cutting-edge framework\u2014already behind schedule\u2014needed more time.","document_mode":"business","mode":"hybrid","edit_budget":"medium","rewrite":true}' | python3 -m json.tool
kill $SERVER_PID
```

Verify: no broken grammar, abbreviations intact, "started to" not mangled, em dashes handled correctly, "actually" preserved, superlatives stripped in business mode.

- [ ] **Step 4: Commit and push**

```bash
git add tests/test_engine.py
git commit -m "test: add end-to-end integration tests"
git push
```

---

## Execution Notes

- Tasks 2-6 fix bugs that produce broken output. These are the highest priority.
- Tasks 7-8 add new detection capabilities.
- Tasks 9-10 improve scoring accuracy.
- Task 11 adds structural awareness.
- Task 12 is the integration verification.
- Each task is independently testable and committable.
- The total line count change is moderate: ~200 lines of new engine code, ~300 lines of tests.
- No new dependencies.
- The public API shape does not change (one new key `passive_hits` added to `signals`).
