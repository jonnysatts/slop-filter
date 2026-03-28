from __future__ import annotations

import csv
import difflib
import io
import json
import re
import statistics
import threading
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

from persistence import Store, create_store

APP_VERSION = "3.0-alpha"

WORD_RE = re.compile(r"[A-Za-z']+")
CONSECUTIVE_SPACE_RE = re.compile(r"[ \t]{2,}")
PASSIVE_RE = re.compile(
    r"\b(was|were|been|being|is|are|am|get|got|gets|getting)\s+"
    r"((?:not|never|always|often|already|also|then|soon|finally|fully|"
    r"quickly|slowly|immediately|subsequently|reportedly|recently)\s+)*"
    r"(\w+ed|written|made|done|seen|taken|given|found|told|known|shown|broken|"
    r"chosen|driven|eaten|fallen|forgotten|frozen|hidden|mistaken|proven|ridden|"
    r"risen|shaken|spoken|stolen|sworn|torn|worn|woven)\b",
    re.I,
)

ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ft", "mt",
    "gen", "gov", "sgt", "cpl", "pvt", "capt", "lt", "col", "maj",
    "rev", "hon", "pres", "dept", "univ", "assn", "bros", "inc",
    "ltd", "co", "corp", "vs", "al", "approx", "est",
    "vol", "fig", "eq", "no",
}

ABBREVIATION_PAIRS = {"e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "u.n"}

FILLER_PATTERNS = [
    (re.compile(r"\b(it is important to note that|it's important to note that)\b", re.I), ""),
    (re.compile(r"\b(it should be noted that)\b", re.I), ""),
    (re.compile(r"\b(in many ways)\b[, ]*", re.I), ""),
    (re.compile(r"\b(in some ways)\b[, ]*", re.I), ""),
    (re.compile(r"\b(at the end of the day)\b[, ]*", re.I), ""),
    (re.compile(r"\bultimately\b[, ]*", re.I), ""),
    (re.compile(r"\bmoreover\b[, ]*", re.I), ""),
    (re.compile(r"\bfurthermore\b[, ]*", re.I), ""),
    (re.compile(r"\badditionally\b[, ]*", re.I), ""),
    (re.compile(r"\bin order to\b", re.I), "to"),
    (re.compile(r"\bdue to the fact that\b", re.I), "because"),
    (re.compile(r"\bthe fact that\b", re.I), ""),
]

TRANSITION_PATTERNS = [
    "however",
    "moreover",
    "furthermore",
    "additionally",
    "ultimately",
    "notably",
    "meanwhile",
]

INTENSIFIERS = {
    "very",
    "really",
    "quite",
    "rather",
    "somewhat",
    "truly",
    "clearly",
    "literally",
    "actually",
    "basically",
    "fairly",
    "simply",
}

NOT_MODIFIERS = {
    "family", "only", "early", "elderly", "friendly", "lonely", "daily",
    "weekly", "monthly", "yearly", "holy", "ugly", "likely", "unlikely",
    "rally", "tally", "belly", "bully", "folly", "jolly", "ally",
    "assembly", "supply", "apply", "reply", "imply", "multiply",
    "fly", "july", "italy", "butterfly", "jelly", "billy", "lily",
    "sally", "molly", "emily", "kelly", "polly", "holly", "wily",
}

GENERIC_WORDS = {
    "thing",
    "things",
    "stuff",
    "aspect",
    "aspects",
    "situation",
    "scenarios",
    "important",
    "interesting",
    "impactful",
    "various",
    "several",
    "many",
    "meaningful",
}

CLICHES = [
    "at the end of the day",
    "calm before the storm",
    "tip of the iceberg",
    "needless to say",
    "in the blink of an eye",
    "the kind of",
    "a sense of",
    "you could feel",
    "it was as if",
]

ABSTRACT_WORDS = {
    "journey",
    "fabric",
    "tapestry",
    "essence",
    "landscape",
    "dynamic",
    "framework",
    "process",
    "narrative",
    "perspective",
    "system",
    "approach",
    "context",
}

CONTRACTIONS = {
    "do not": "don't",
    "does not": "doesn't",
    "did not": "didn't",
    "cannot": "can't",
    "could not": "couldn't",
    "would not": "wouldn't",
    "should not": "shouldn't",
    "will not": "won't",
    "is not": "isn't",
    "are not": "aren't",
    "was not": "wasn't",
    "were not": "weren't",
    "have not": "haven't",
    "has not": "hasn't",
    "had not": "hadn't",
    "it is": "it's",
    "that is": "that's",
    "there is": "there's",
    "I am": "I'm",
    "I have": "I've",
    "I will": "I'll",
    "we are": "we're",
    "they are": "they're",
}

EXPANSIONS = {value: key for key, value in CONTRACTIONS.items()}

VOICE_KEYS = [
    "avg_sentence_length",
    "sentence_length_std",
    "avg_paragraph_sentences",
    "dialogue_ratio",
    "contraction_rate",
    "comma_rate",
    "question_rate",
    "exclamation_rate",
    "emdash_rate",
    "semicolon_rate",
    "lexical_diversity",
    "long_sentence_rate",
    "fragment_rate",
    "modifier_rate",
]


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or "untitled"



def split_paragraphs(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []
    return [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]


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
                is_boundary = True
            elif chars[j] in " \t\n\r":
                k = j
                while k < len(chars) and chars[k] in " \t\n\r":
                    k += 1

                if k >= len(chars):
                    is_boundary = True
                elif chars[k].isupper() or chars[k].isdigit() or chars[k] in "\"'\u201c\u2018":
                    fragment = "".join(current).rstrip(".!?").strip()
                    last_token = fragment.split()[-1].lower().rstrip(".") if fragment.split() else ""

                    if end_char == "." and last_token in ABBREVIATIONS:
                        is_boundary = False
                    elif end_char == "." and last_token in ABBREVIATION_PAIRS:
                        is_boundary = False
                    elif end_char == "." and len(last_token) == 1 and last_token.isalpha():
                        is_boundary = False
                    elif end_char == "." and re.match(r"^\d+$", last_token):
                        is_boundary = False
                    else:
                        is_boundary = True
                # If next char is lowercase, not a boundary
            # If no whitespace after punctuation, not a boundary (e.g. abbreviation like "U.S.A")

            if is_boundary:
                while i + 1 < len(chars) and chars[i + 1] in "\"')]\u201d\u2019":
                    i += 1
                    current.append(chars[i])
                sentence = "".join(current).strip()
                if sentence:
                    sentences.append(sentence)
                current = []

        i += 1

    tail = "".join(current).strip()
    if tail:
        if sentences and len(tail.split()) <= 2 and not tail.endswith((".", "!", "?")):
            sentences[-1] = f"{sentences[-1]} {tail}".strip()
        else:
            sentences.append(tail)

    return sentences or [text]


def tokenize(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def sentence_lengths(text: str) -> list[int]:
    return [len(tokenize(sentence)) for sentence in split_sentences(text)]


def paragraph_sentence_counts(text: str) -> list[int]:
    return [len(split_sentences(paragraph)) for paragraph in split_paragraphs(text)]


def count_contractions(text: str) -> int:
    return sum(1 for word in tokenize(text) if "'" in word)


def safe_mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def safe_stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return statistics.pstdev(values)


def lexical_diversity(tokens: list[str], window_size: int = 10) -> float:
    if not tokens:
        return 0.0
    if len(tokens) <= window_size:
        return len(set(tokens)) / len(tokens)
    windows = []
    for start in range(0, len(tokens), window_size):
        chunk = tokens[start : start + window_size]
        if len(chunk) >= window_size // 2:
            windows.append(len(set(chunk)) / len(chunk))
    return sum(windows) / len(windows) if windows else len(set(tokens)) / len(tokens)


def count_pattern_hits(text: str, pattern: str) -> int:
    return len(re.findall(rf"\b{re.escape(pattern)}\b", text, flags=re.I))


def count_passive_voice(text: str) -> int:
    return len(PASSIVE_RE.findall(text))


def diff_html(original: str, revised: str) -> str:
    differ = difflib.HtmlDiff(tabsize=2, wrapcolumn=90)
    table = differ.make_table(
        original.splitlines(),
        revised.splitlines(),
        fromdesc="Original",
        todesc="Revised",
        context=True,
        numlines=2,
    )
    return f"<html><body>{table}</body></html>"


def remove_flagged_sentences(text: str, annotations: list[dict]) -> str:
    flagged = {entry["original"].strip() for entry in annotations if entry["severity"] >= 55}
    if not flagged:
        return text
    kept: list[str] = []
    for paragraph in split_paragraphs(text):
        sentences = [sentence for sentence in split_sentences(paragraph) if sentence.strip() not in flagged]
        if sentences:
            kept.append(" ".join(sentences))
    return "\n\n".join(kept).strip() or text


def build_voice_profile(text: str) -> dict:
    tokens = tokenize(text)
    sentences = split_sentences(text)
    paragraphs = split_paragraphs(text)
    lengths = [len(tokenize(sentence)) for sentence in sentences]
    paragraph_counts = [len(split_sentences(paragraph)) for paragraph in paragraphs]
    token_count = len(tokens) or 1
    char_count = len(text) or 1
    modifier_hits = sum(1 for token in tokens if token in INTENSIFIERS or (token.endswith("ly") and token not in NOT_MODIFIERS and len(token) > 3))

    profile = {
        "avg_sentence_length": round(safe_mean(lengths), 3),
        "sentence_length_std": round(safe_stdev(lengths), 3),
        "avg_paragraph_sentences": round(safe_mean(paragraph_counts), 3),
        "dialogue_ratio": round(text.count('"') / max(2, char_count), 4),
        "contraction_rate": round(count_contractions(text) / token_count, 4),
        "comma_rate": round(text.count(",") / max(1, len(sentences)), 4),
        "question_rate": round(text.count("?") / max(1, len(sentences)), 4),
        "exclamation_rate": round(text.count("!") / max(1, len(sentences)), 4),
        "emdash_rate": round((text.count("—") + text.count("--")) / max(1, len(sentences)), 4),
        "semicolon_rate": round(text.count(";") / max(1, len(sentences)), 4),
        "lexical_diversity": round(lexical_diversity(tokens), 4),
        "long_sentence_rate": round(sum(1 for value in lengths if value >= 24) / max(1, len(lengths)), 4),
        "fragment_rate": round(sum(1 for value in lengths if value <= 5) / max(1, len(lengths)), 4),
        "modifier_rate": round(modifier_hits / token_count, 4),
    }
    return profile


def blend_profiles(*profiles: dict) -> dict:
    usable = [profile for profile in profiles if profile]
    if not usable:
        return build_voice_profile("")
    return {
        key: round(safe_mean([profile.get(key, 0.0) for profile in usable]), 4)
        for key in VOICE_KEYS
    }


def voice_distance(left: dict, right: dict) -> float:
    weights = {
        "avg_sentence_length": 0.14,
        "sentence_length_std": 0.1,
        "avg_paragraph_sentences": 0.08,
        "dialogue_ratio": 0.08,
        "contraction_rate": 0.1,
        "comma_rate": 0.08,
        "question_rate": 0.04,
        "exclamation_rate": 0.03,
        "emdash_rate": 0.07,
        "semicolon_rate": 0.04,
        "lexical_diversity": 0.1,
        "long_sentence_rate": 0.07,
        "fragment_rate": 0.04,
        "modifier_rate": 0.03,
    }
    total = 0.0
    for key, weight in weights.items():
        l_value = left.get(key, 0.0)
        r_value = right.get(key, 0.0)
        scale = max(abs(l_value), abs(r_value), 0.2 if "rate" in key else 2.0)
        total += abs(l_value - r_value) / scale * weight
    return round(total, 4)


def analyse_text(text: str) -> dict:
    annotations = annotate_text(text)
    sentences = split_sentences(text)
    tokens = tokenize(text)
    lengths = [len(tokenize(sentence)) for sentence in sentences] or [0]
    lower = text.lower()

    filler_hits = sum(1 for item in annotations if item["type"] == "filler")
    rhythm_hits = sum(1 for item in annotations if item["type"] == "rhythm")
    cliche_hits = sum(1 for phrase in CLICHES if phrase in lower)
    generic_hits = sum(tokens.count(word) for word in GENERIC_WORDS)
    abstract_hits = sum(tokens.count(word) for word in ABSTRACT_WORDS)
    modifier_hits = sum(1 for token in tokens if token in INTENSIFIERS or (token.endswith("ly") and token not in NOT_MODIFIERS and len(token) > 3))
    transition_hits = sum(count_pattern_hits(lower, item) for item in TRANSITION_PATTERNS)
    repeated_starts = count_repeated_starts(sentences)
    monotonous_runs = count_monotonous_runs(lengths)
    passive_hits = count_passive_voice(text)

    directness = clamp(100 - filler_hits * 8 - transition_hits * 4 - generic_hits * 1.5 - passive_hits * 5, 0, 100)
    density = clamp(100 - filler_hits * 7 - modifier_hits * 1.6 - generic_hits * 1.8, 0, 100)
    rhythm = clamp(100 - rhythm_hits * 8 - monotonous_runs * 6 - max(0.0, 7 - safe_stdev(lengths)) * 4, 0, 100)
    authenticity = clamp(
        100 - cliche_hits * 9 - transition_hits * 5 - abstract_hits * 2 - repeated_starts * 7 - filler_hits * 4,
        0,
        100,
    )
    specificity = clamp(
        100 - generic_hits * 3 - abstract_hits * 2 - max(0.0, 0.48 - lexical_diversity(tokens)) * 150,
        0,
        100,
    )

    quality_score = round(safe_mean([directness, density, rhythm, authenticity, specificity]), 1)
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

    return {
        "annotations": annotations,
        "quality_score": quality_score,
        "detector_risk": detector_risk,
        "scores": {
            "directness": round(directness, 1),
            "density": round(density, 1),
            "rhythm": round(rhythm, 1),
            "authenticity": round(authenticity, 1),
            "specificity": round(specificity, 1),
        },
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
        "voice_profile": build_voice_profile(remove_flagged_sentences(text, annotations)),
        "sentence_count": len(sentences),
        "word_count": len(tokens),
    }


def count_repeated_starts(sentences: list[str]) -> int:
    starts = [tokenize(sentence)[:2] for sentence in sentences if tokenize(sentence)]
    repeated = 0
    for index in range(2, len(starts)):
        if starts[index] and starts[index] == starts[index - 1] == starts[index - 2]:
            repeated += 1
    return repeated


def count_monotonous_runs(lengths: list[int]) -> int:
    if len(lengths) < 3:
        return 0
    count = 0
    for index in range(2, len(lengths)):
        window = lengths[index - 2 : index + 1]
        if max(window) - min(window) <= 3:
            count += 1
    return count


def classify_sentence(sentence: str, sentence_index: int, lengths: list[int], sentences: list[str]) -> list[dict]:
    annotations: list[dict] = []
    lower = sentence.lower()

    for pattern, _ in FILLER_PATTERNS:
        if pattern.search(sentence):
            annotations.append(
                {
                    "id": str(uuid.uuid4())[:8],
                    "type": "filler",
                    "severity": 72,
                    "original": sentence.strip(),
                    "reason": "The sentence leans on transitional or explanatory filler that slows it down.",
                }
            )
            break

    intensifier_count = sum(1 for token in tokenize(lower) if token in INTENSIFIERS)
    if intensifier_count >= 2:
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "register",
                "severity": 58,
                "original": sentence.strip(),
                "reason": "Stacked intensifiers make the prose feel inflated rather than precise.",
            }
        )

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

    if any(phrase in lower for phrase in CLICHES):
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "fiction-tell",
                "severity": 68,
                "original": sentence.strip(),
                "reason": "The phrasing reaches for a familiar effect instead of giving a sharper image.",
            }
        )

    if "—" in sentence or "--" in sentence:
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "rhythm",
                "severity": 52,
                "original": sentence.strip(),
                "reason": "The em dash lands like a reveal beat and can read as synthetic cadence.",
            }
        )

    if sentence_index >= 2:
        trio = lengths[sentence_index - 2 : sentence_index + 1]
        if max(trio) - min(trio) <= 3:
            annotations.append(
                {
                    "id": str(uuid.uuid4())[:8],
                    "type": "rhythm",
                    "severity": 61,
                    "original": sentence.strip(),
                    "reason": "This sits inside a run of similarly sized sentences, which flattens the rhythm.",
                }
            )

    if sentence_index >= 2:
        starts = [tokenize(sentences[i])[:2] for i in range(sentence_index - 2, sentence_index + 1)]
        if starts[0] and starts[0] == starts[1] == starts[2]:
            annotations.append(
                {
                    "id": str(uuid.uuid4())[:8],
                    "type": "structure",
                    "severity": 63,
                    "original": sentence.strip(),
                    "reason": "The sentence repeats the same opening pattern as its neighbours, which feels mechanical.",
                }
            )

    if len(tokenize(sentence)) >= 34:
        annotations.append(
            {
                "id": str(uuid.uuid4())[:8],
                "type": "structure",
                "severity": 54,
                "original": sentence.strip(),
                "reason": "The sentence carries a lot of weight at once and is a good candidate for compression.",
            }
        )

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

    return annotations


def annotate_text(text: str) -> list[dict]:
    sentences = split_sentences(text)
    lengths = [len(tokenize(sentence)) for sentence in sentences]
    annotations: list[dict] = []
    for index, sentence in enumerate(sentences):
        annotations.extend(classify_sentence(sentence, index, lengths, sentences))

    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for annotation in annotations:
        key = (annotation["type"], annotation["original"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(annotation)
    return deduped


def cleanup_sentence(sentence: str) -> str:
    updated = sentence
    for pattern, replacement in FILLER_PATTERNS:
        updated = pattern.sub(replacement, updated)

    # Only remove intensifiers when stacked or before sloppy adjectives
    intensifier_pat = r"\b(very|really|quite|rather|somewhat|truly|basically)\b"
    updated = re.sub(
        rf"{intensifier_pat}\s+{intensifier_pat}\b",
        lambda m: m.group(2),
        updated,
        flags=re.I,
    )
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
    # Only convert em dashes between two words (parenthetical/clause break)
    updated = re.sub(r"(\w)\s*\u2014\s*(\w)", r"\1, \2", updated)
    updated = re.sub(r"(\w)\s*--\s*(\w)", r"\1, \2", updated)
    updated = re.sub(r"\s+,", ",", updated)
    updated = re.sub(r",\s*,", ", ", updated)
    updated = CONSECUTIVE_SPACE_RE.sub(" ", updated).strip()
    updated = re.sub(r"^\s*,\s*", "", updated)
    updated = re.sub(r"\s+([.?!,;:])", r"\1", updated)
    if updated and updated[0].islower():
        updated = updated[0].upper() + updated[1:]
    return updated or sentence


def apply_contraction_bias(text: str, target_profile: dict) -> str:
    current_rate = build_voice_profile(text).get("contraction_rate", 0.0)
    target_rate = target_profile.get("contraction_rate", current_rate)
    updated = text
    if target_rate >= current_rate + 0.012:
        for expanded, contracted in CONTRACTIONS.items():
            updated = re.sub(rf"\b{re.escape(expanded)}\b", contracted, updated, flags=re.I)
    elif target_rate <= current_rate - 0.012:
        for contracted, expanded in EXPANSIONS.items():
            updated = re.sub(rf"\b{re.escape(contracted)}\b", expanded, updated, flags=re.I)
    return updated


def align_sentence_lengths(paragraph: str, target_profile: dict) -> str:
    target_length = target_profile.get("avg_sentence_length", 15.0)
    sentences = split_sentences(paragraph)
    adjusted: list[str] = []
    index = 0
    while index < len(sentences):
        sentence = sentences[index]
        words = tokenize(sentence)
        if len(words) > target_length + 10:
            split_done = False
            for marker in [", but ", ", and ", "; ", ": "]:
                position = sentence.lower().find(marker)
                if 8 < position < len(sentence) - 8:
                    left = sentence[:position].strip().rstrip(",;:")
                    right = sentence[position + len(marker) :].strip()
                    if left and right:
                        adjusted.append(left + ".")
                        adjusted.append(right[0].upper() + right[1:] if right else right)
                        split_done = True
                        break
            if split_done:
                index += 1
                continue

        if (
            len(words) < max(4, target_length - 9)
            and index + 1 < len(sentences)
            and len(tokenize(sentences[index + 1])) < max(8, target_length - 5)
            and not sentence.endswith("?")
            and '"' not in sentence
        ):
            next_sentence = sentences[index + 1]
            merged = sentence.rstrip(".!?") + ", " + next_sentence[0].lower() + next_sentence[1:]
            adjusted.append(merged)
            index += 2
            continue

        adjusted.append(sentence)
        index += 1
    return " ".join(adjusted)


def apply_document_mode_bias(text: str, document_mode: str) -> str:
    updated = text

    if document_mode in {"business", "essay"}:
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
    if updated and updated[0].islower():
        updated = updated[0].upper() + updated[1:]

    return updated.strip()


def rewrite_text(text: str, target_profile: dict, edit_budget: str) -> tuple[str, list[dict], int]:
    paragraphs = split_paragraphs(text) or [text]
    original_analysis = analyse_text(text)
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

    revised = "\n\n".join(revised_paragraphs).strip()
    revised = apply_contraction_bias(revised, target_profile)
    revised = CONSECUTIVE_SPACE_RE.sub(" ", revised)
    revised = re.sub(r"\n{3,}", "\n\n", revised).strip()

    revised_analysis = analyse_text(revised)

    # Quality guard: if both metrics degraded, fall back to original
    if (revised_analysis["quality_score"] < original_analysis["quality_score"] - 2
            and revised_analysis["detector_risk"] > original_analysis["detector_risk"] + 2):
        return text, original_analysis["annotations"], 0

    return revised, revised_analysis["annotations"], changed


def score_delta(original: float, revised: float, invert: bool = False) -> float:
    value = original - revised if invert else revised - original
    return round(value, 1)


def markdown_summary(batch: dict) -> str:
    lines = [
        f"# {batch['name']}",
        "",
        f"- Status: {batch['status']}",
        f"- Mode: {batch['mode']}",
        f"- Edit budget: {batch['edit_budget']}",
        f"- Documents: {len(batch['documents'])}",
        f"- Avg quality delta: {batch['summary']['avg_quality_delta']}",
        f"- Avg detector risk delta: {batch['summary']['avg_detector_risk_delta']}",
        f"- Batch voice variance: {batch['summary']['batch_voice_variance']}",
        "",
        "## Documents",
        "",
    ]
    for document in batch["documents"]:
        lines.extend(
            [
                f"### {document['name']}",
                f"- Status: {document['status']}",
                f"- Quality delta: {document.get('quality_delta', 0)}",
                f"- Detector risk delta: {document.get('detector_risk_delta', 0)}",
                f"- Voice similarity: {document.get('voice_similarity_score', 0)}",
                f"- Outlier: {'yes' if document.get('is_outlier') else 'no'}",
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"


class SlopFilterService:
    def __init__(self, store: Store | None = None) -> None:
        self.store = store or create_store()
        self.lock = threading.RLock()
        self.batches: dict[str, dict] = {}
        self.doc_index: dict[str, str] = {}
        self.voice_packs: dict[str, dict] = {}
        self._load_voice_packs()
        self._load_batches()

    def _load_voice_packs(self) -> None:
        self.voice_packs = self.store.load_voice_packs()

    def _load_batches(self) -> None:
        self.batches, self.doc_index = self.store.load_batches()

    def _save_batch(self, batch_id: str) -> None:
        batch = self.batches[batch_id]
        self.store.save_batch(batch)

    def list_batches(self) -> list[dict]:
        with self.lock:
            batches = [self._public_batch_summary(batch) for batch in self.batches.values()]
        return sorted(batches, key=lambda item: item["created_at"], reverse=True)

    def list_voice_packs(self) -> list[dict]:
        with self.lock:
            packs = sorted(self.voice_packs.values(), key=lambda item: item["created_at"], reverse=True)
            return [
                {
                    "id": pack["id"],
                    "name": pack["name"],
                    "created_at": pack["created_at"],
                    "sample_size": pack["sample_size"],
                }
                for pack in packs
            ]

    def create_voice_pack(self, name: str, sample_text: str) -> dict:
        sample_text = sample_text.strip()
        if not sample_text:
            raise ValueError("Voice pack text cannot be empty.")
        payload = {
            "id": str(uuid.uuid4()),
            "name": name.strip() or "Untitled Voice",
            "created_at": utc_now(),
            "sample_size": len(tokenize(sample_text)),
            "sample_text": sample_text,
            "profile": build_voice_profile(sample_text),
        }
        with self.lock:
            self.voice_packs[payload["id"]] = payload
            self.store.save_voice_pack(payload)
        return payload

    def portable_slop_check(self, payload: dict, api_key: str = "") -> dict:
        text = (payload.get("text") or "").strip()
        if not text:
            raise ValueError("Text is required.")

        mode = payload.get("mode") or "preserve-batch-voice"
        edit_budget = payload.get("edit_budget") or "medium"
        document_mode = payload.get("document_mode") or "business"
        rewrite_enabled = bool(payload.get("rewrite", True))
        house_voice_samples = (payload.get("house_voice_samples") or "").strip()
        voice_pack_id = payload.get("voice_pack_id") or ""

        original_analysis = analyse_text(text)
        base_profile = original_analysis["voice_profile"]
        sample_profile = build_voice_profile(house_voice_samples) if house_voice_samples else {}
        with self.lock:
            pack_profile = deepcopy(self.voice_packs.get(voice_pack_id, {}).get("profile", {})) if voice_pack_id else {}

        if mode == "house-voice":
            target_profile = pack_profile or sample_profile or base_profile
        elif mode == "hybrid":
            target_profile = blend_profiles(base_profile, pack_profile or sample_profile or {})
        else:
            target_profile = base_profile

        revised_text = text
        revised_analysis = original_analysis
        revised_annotations = original_analysis["annotations"]
        change_count = 0

        if rewrite_enabled:
            revised_text, revised_annotations, change_count = rewrite_text(text, target_profile, edit_budget)
            revised_text = apply_document_mode_bias(revised_text, document_mode)
            revised_analysis = analyse_text(revised_text)
            if revised_text != text and change_count == 0:
                change_count = 1

        quality_delta = score_delta(original_analysis["quality_score"], revised_analysis["quality_score"])
        detector_risk_delta = score_delta(
            original_analysis["detector_risk"],
            revised_analysis["detector_risk"],
            invert=True,
        )
        voice_similarity = round(100 - voice_distance(revised_analysis["voice_profile"], target_profile) * 100, 1)
        voice_similarity = round(clamp(voice_similarity, 0, 100), 1)

        result = {
            "engine_version": APP_VERSION,
            "requested_at": utc_now(),
            "document_mode": document_mode,
            "mode": mode,
            "edit_budget": edit_budget,
            "rewrite_enabled": rewrite_enabled,
            "target_voice_profile": target_profile,
            "summary": {
                "change_count": change_count,
                "quality_delta": quality_delta,
                "detector_risk_delta": detector_risk_delta,
                "voice_similarity_score": voice_similarity,
                "accepted": change_count == 0 or quality_delta >= 0 or detector_risk_delta >= 0,
            },
            "original": {
                "text": text,
                "analysis": original_analysis,
            },
            "revised": {
                "text": revised_text,
                "analysis": revised_analysis,
                "annotations": revised_annotations,
            },
        }

        # Record check for attribution and audit
        try:
            client = self.store.lookup_api_client(api_key) if api_key else None
            self.store.record_slop_check({
                "api_client_id": client["id"] if client else None,
                "source_app": payload.get("source_app", ""),
                "request_mode": mode,
                "document_mode": document_mode,
                "edit_budget": edit_budget,
                "rewrite_enabled": rewrite_enabled,
                "original_quality": original_analysis["quality_score"],
                "revised_quality": revised_analysis["quality_score"],
                "quality_delta": quality_delta,
                "original_detector_risk": original_analysis["detector_risk"],
                "revised_detector_risk": revised_analysis["detector_risk"],
                "detector_risk_delta": detector_risk_delta,
                "voice_similarity_score": voice_similarity,
                "created_at": utc_now(),
            })
        except Exception:
            pass  # Attribution recording must never break the request

        return result

    def create_batch(self, payload: dict) -> dict:
        documents = payload.get("documents") or []
        if not documents:
            raise ValueError("At least one document is required.")

        batch_id = str(uuid.uuid4())
        sequence_docs = []
        for index, document in enumerate(documents, start=1):
            text = (document.get("text") or "").strip()
            if not text:
                continue
            doc_id = str(uuid.uuid4())
            sequence_docs.append(
                {
                    "id": doc_id,
                    "name": document.get("name") or f"document-{index}.md",
                    "sequence_no": document.get("sequence_no") or index,
                    "status": "queued",
                    "progress_label": "Queued",
                    "original_text": text,
                    "revised_text": "",
                    "original_analysis": {},
                    "revised_analysis": {},
                    "quality_delta": 0,
                    "detector_risk_delta": 0,
                    "voice_similarity_score": 0,
                    "is_outlier": False,
                    "outlier_reason": "",
                    "change_count": 0,
                    "created_at": utc_now(),
                }
            )

        if not sequence_docs:
            raise ValueError("No usable document text was found.")

        batch = {
            "id": batch_id,
            "name": payload.get("name") or f"Batch {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "status": "queued",
            "mode": payload.get("mode") or "preserve-batch-voice",
            "edit_budget": payload.get("edit_budget") or "medium",
            "house_voice_samples": payload.get("house_voice_samples", ""),
            "voice_pack_id": payload.get("voice_pack_id") or "",
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "documents": sequence_docs,
            "summary": {
                "avg_quality_delta": 0,
                "avg_detector_risk_delta": 0,
                "avg_voice_similarity": 0,
                "batch_voice_variance": 0,
                "outlier_count": 0,
            },
            "target_voice_profile": {},
            "batch_voice_profile": {},
            "engine_version": APP_VERSION,
            "events": [
                {"timestamp": utc_now(), "message": f"Batch created with {len(sequence_docs)} document(s)."}
            ],
        }

        with self.lock:
            self.batches[batch_id] = batch
            for document in sequence_docs:
                self.doc_index[document["id"]] = batch_id
            self._save_batch(batch_id)

        thread = threading.Thread(target=self._process_batch, args=(batch_id,), daemon=True)
        thread.start()
        return self._public_batch_summary(batch)

    def rerun_document(self, document_id: str, edit_budget: str | None = None) -> dict:
        with self.lock:
            batch_id = self.doc_index.get(document_id)
            if not batch_id:
                raise KeyError("Document not found.")
            batch = self.batches[batch_id]
            for document in batch["documents"]:
                if document["id"] == document_id:
                    document["status"] = "queued"
                    document["progress_label"] = "Queued for rerun"
                    if edit_budget:
                        batch["edit_budget"] = edit_budget
                    break
            batch["status"] = "running"
            batch["updated_at"] = utc_now()
            batch["events"].append({"timestamp": utc_now(), "message": f"Rerunning {document_id}."})
            self._save_batch(batch_id)

        thread = threading.Thread(target=self._process_batch, args=(batch_id, [document_id]), daemon=True)
        thread.start()
        return self.get_document(document_id)

    def rerun_outliers(self, batch_id: str) -> dict:
        with self.lock:
            batch = self.batches.get(batch_id)
            if not batch:
                raise KeyError("Batch not found.")
            outliers = [document["id"] for document in batch["documents"] if document.get("is_outlier")]
            if not outliers:
                raise ValueError("No outlier documents to rerun.")
            batch["status"] = "running"
            batch["updated_at"] = utc_now()
            batch["events"].append({"timestamp": utc_now(), "message": f"Rerunning {len(outliers)} outlier document(s)."})
            self._save_batch(batch_id)

        thread = threading.Thread(target=self._process_batch, args=(batch_id, outliers), daemon=True)
        thread.start()
        return self.get_batch(batch_id)

    def get_batch(self, batch_id: str) -> dict:
        with self.lock:
            batch = self.batches.get(batch_id)
            if not batch:
                raise KeyError("Batch not found.")
            return deepcopy(batch)

    def get_document(self, document_id: str) -> dict:
        with self.lock:
            batch_id = self.doc_index.get(document_id)
            if not batch_id:
                raise KeyError("Document not found.")
            batch = self.batches[batch_id]
            document = next(item for item in batch["documents"] if item["id"] == document_id)
            payload = deepcopy(document)
            payload["batch_id"] = batch_id
            payload["diff_html"] = diff_html(document["original_text"], document["revised_text"] or document["original_text"])
            payload["target_voice_profile"] = deepcopy(batch.get("target_voice_profile", {}))
            payload["batch_voice_profile"] = deepcopy(batch.get("batch_voice_profile", {}))
            return payload

    def export_zip(self, batch_id: str) -> Path:
        with self.lock:
            batch = self.batches.get(batch_id)
            if not batch:
                raise KeyError("Batch not found.")
            return self.store.build_export_zip(batch_id)

    def _process_batch(self, batch_id: str, subset_doc_ids: list[str] | None = None) -> None:
        with self.lock:
            batch = self.batches[batch_id]
            batch["status"] = "running"
            batch["updated_at"] = utc_now()
            batch["events"].append({"timestamp": utc_now(), "message": "Batch processing started."})
            self._save_batch(batch_id)

        document_snapshots = []
        with self.lock:
            for document in self.batches[batch_id]["documents"]:
                if subset_doc_ids and document["id"] not in subset_doc_ids:
                    continue
                document["status"] = "analysing"
                document["progress_label"] = "Analysing"
                document_snapshots.append(
                    {
                        "id": document["id"],
                        "name": document["name"],
                        "sequence_no": document["sequence_no"],
                        "text": document["original_text"],
                    }
                )
            self._save_batch(batch_id)

        if not document_snapshots:
            return

        baseline_profiles = []
        per_doc_analysis = {}
        for snapshot in document_snapshots:
            analysis = analyse_text(snapshot["text"])
            per_doc_analysis[snapshot["id"]] = analysis
            baseline_profiles.append(analysis["voice_profile"])
            with self.lock:
                batch = self.batches[batch_id]
                document = next(item for item in batch["documents"] if item["id"] == snapshot["id"])
                document["original_analysis"] = analysis
                document["status"] = "rewriting"
                document["progress_label"] = "Rewriting"
                batch["updated_at"] = utc_now()
                self._save_batch(batch_id)

        batch_profile = blend_profiles(*baseline_profiles)
        target_profile = self._derive_target_profile(batch_id, batch_profile)

        for snapshot in document_snapshots:
            original_analysis = per_doc_analysis[snapshot["id"]]
            revised_text, revised_annotations, change_count = rewrite_text(
                snapshot["text"], target_profile, self.batches[batch_id]["edit_budget"]
            )
            revised_analysis = analyse_text(revised_text)
            similarity = round(100 - voice_distance(revised_analysis["voice_profile"], target_profile) * 100, 1)
            similarity = clamp(similarity, 0, 100)

            with self.lock:
                batch = self.batches[batch_id]
                document = next(item for item in batch["documents"] if item["id"] == snapshot["id"])
                document["revised_text"] = revised_text
                document["revised_analysis"] = revised_analysis
                document["change_count"] = change_count
                document["quality_delta"] = score_delta(original_analysis["quality_score"], revised_analysis["quality_score"])
                document["detector_risk_delta"] = score_delta(
                    original_analysis["detector_risk"], revised_analysis["detector_risk"], invert=True
                )
                document["voice_similarity_score"] = round(similarity, 1)
                document["status"] = "done"
                document["progress_label"] = "Ready"
                document["events"] = [
                    {
                        "timestamp": utc_now(),
                        "message": f"Processed with {change_count} sentence change(s).",
                    }
                ]
                batch["updated_at"] = utc_now()
                self._save_batch(batch_id)

        self._finalise_batch(batch_id)

    def _derive_target_profile(self, batch_id: str, batch_profile: dict) -> dict:
        with self.lock:
            batch = self.batches[batch_id]
            mode = batch["mode"]
            sample_text = (batch.get("house_voice_samples") or "").strip()
            voice_pack_id = batch.get("voice_pack_id")
            pack_profile = self.voice_packs.get(voice_pack_id, {}).get("profile") if voice_pack_id else None
            sample_profile = build_voice_profile(sample_text) if sample_text else None

            if mode == "house-voice":
                target = pack_profile or sample_profile or batch_profile
            elif mode == "hybrid":
                target = blend_profiles(batch_profile, pack_profile or sample_profile or {})
            else:
                target = batch_profile

            batch["batch_voice_profile"] = batch_profile
            batch["target_voice_profile"] = target
            self._save_batch(batch_id)
            return target

    def _finalise_batch(self, batch_id: str) -> None:
        with self.lock:
            batch = self.batches[batch_id]
            target = batch.get("target_voice_profile", {})
            similarities = []
            for document in batch["documents"]:
                if document["status"] != "done":
                    continue
                revised_profile = document.get("revised_analysis", {}).get("voice_profile", {})
                similarities.append(document.get("voice_similarity_score", 0))
                distance = voice_distance(revised_profile, target) if revised_profile and target else 0
                document["is_outlier"] = distance >= 0.32 or document.get("voice_similarity_score", 100) < 74
                if document["is_outlier"]:
                    document["outlier_reason"] = self._outlier_reason(revised_profile, target)
                else:
                    document["outlier_reason"] = ""

            quality_deltas = [document.get("quality_delta", 0) for document in batch["documents"]]
            risk_deltas = [document.get("detector_risk_delta", 0) for document in batch["documents"]]
            batch_variance = self._batch_variance(batch["documents"])

            batch["summary"] = {
                "avg_quality_delta": round(safe_mean(quality_deltas), 1),
                "avg_detector_risk_delta": round(safe_mean(risk_deltas), 1),
                "avg_voice_similarity": round(safe_mean(similarities), 1),
                "batch_voice_variance": round(batch_variance, 3),
                "outlier_count": sum(1 for document in batch["documents"] if document.get("is_outlier")),
            }
            batch["status"] = "done"
            batch["updated_at"] = utc_now()
            batch["events"].append({"timestamp": utc_now(), "message": "Batch processing complete."})
            self._write_artifacts(batch_id)
            self._save_batch(batch_id)

    def _write_artifacts(self, batch_id: str) -> None:
        batch = self.batches[batch_id]

        for document in batch["documents"]:
            base_name = f"{int(document['sequence_no']):02d}_{slugify(Path(document['name']).stem)}"
            revised_content = (document["revised_text"] or document["original_text"]).encode("utf-8")
            diff_content = diff_html(
                document["original_text"], document["revised_text"] or document["original_text"]
            ).encode("utf-8")
            self.store.write_artifact(batch_id, f"revised/{base_name}.md", revised_content)
            self.store.write_artifact(batch_id, f"diffs/{base_name}.html", diff_content)

        self.store.write_artifact(
            batch_id, "reports/batch-summary.md", markdown_summary(batch).encode("utf-8")
        )
        self.store.write_artifact(
            batch_id, "reports/run-manifest.json",
            json.dumps(batch, ensure_ascii=False, indent=2).encode("utf-8"),
        )
        self.store.write_artifact(
            batch_id, "reports/voice-consistency.json",
            json.dumps(
                {
                    "batch_voice_profile": batch.get("batch_voice_profile", {}),
                    "target_voice_profile": batch.get("target_voice_profile", {}),
                    "documents": [
                        {
                            "id": document["id"],
                            "name": document["name"],
                            "voice_similarity_score": document.get("voice_similarity_score", 0),
                            "is_outlier": document.get("is_outlier", False),
                            "outlier_reason": document.get("outlier_reason", ""),
                        }
                        for document in batch["documents"]
                    ],
                },
                ensure_ascii=False, indent=2,
            ).encode("utf-8"),
        )

        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow([
            "document_id", "name", "quality_original", "quality_revised", "quality_delta",
            "detector_risk_original", "detector_risk_revised", "detector_risk_delta",
            "voice_similarity_score", "is_outlier", "outlier_reason",
        ])
        for document in batch["documents"]:
            writer.writerow([
                document["id"], document["name"],
                document.get("original_analysis", {}).get("quality_score", 0),
                document.get("revised_analysis", {}).get("quality_score", 0),
                document.get("quality_delta", 0),
                document.get("original_analysis", {}).get("detector_risk", 0),
                document.get("revised_analysis", {}).get("detector_risk", 0),
                document.get("detector_risk_delta", 0),
                document.get("voice_similarity_score", 0),
                document.get("is_outlier", False),
                document.get("outlier_reason", ""),
            ])
        self.store.write_artifact(batch_id, "reports/document-scores.csv", csv_buf.getvalue().encode("utf-8"))

        detector_rows = []
        quality_rows = []
        for document in batch["documents"]:
            detector_rows.append({
                "document_id": document["id"], "phase": "original",
                "detector_name": "local-risk-panel",
                "raw_score": document.get("original_analysis", {}).get("detector_risk", 0),
            })
            detector_rows.append({
                "document_id": document["id"], "phase": "revised",
                "detector_name": "local-risk-panel",
                "raw_score": document.get("revised_analysis", {}).get("detector_risk", 0),
            })
            quality_rows.append({
                "document_id": document["id"], "phase": "original",
                "scores": document.get("original_analysis", {}).get("scores", {}),
                "quality_score": document.get("original_analysis", {}).get("quality_score", 0),
            })
            quality_rows.append({
                "document_id": document["id"], "phase": "revised",
                "scores": document.get("revised_analysis", {}).get("scores", {}),
                "quality_score": document.get("revised_analysis", {}).get("quality_score", 0),
            })

        detector_jsonl = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in detector_rows)
        self.store.write_artifact(batch_id, "reports/detector-results.jsonl", detector_jsonl.encode("utf-8"))

        quality_jsonl = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in quality_rows)
        self.store.write_artifact(batch_id, "reports/quality-results.jsonl", quality_jsonl.encode("utf-8"))

    def _outlier_reason(self, profile: dict, target: dict) -> str:
        if not profile or not target:
            return ""
        candidates = {
            "sentence cadence too clipped": target.get("avg_sentence_length", 0) - profile.get("avg_sentence_length", 0),
            "sentence cadence too long": profile.get("avg_sentence_length", 0) - target.get("avg_sentence_length", 0),
            "modifier density too high": profile.get("modifier_rate", 0) - target.get("modifier_rate", 0),
            "diction too diffuse for batch": target.get("lexical_diversity", 0) - profile.get("lexical_diversity", 0),
            "dialogue density too low": target.get("dialogue_ratio", 0) - profile.get("dialogue_ratio", 0),
        }
        label, value = max(candidates.items(), key=lambda item: abs(item[1]))
        return label if abs(value) >= 0.03 else "general voice drift"

    def _batch_variance(self, documents: list[dict]) -> float:
        profiles = [document.get("revised_analysis", {}).get("voice_profile", {}) for document in documents if document.get("revised_analysis")]
        if len(profiles) < 2:
            return 0.0
        distances = []
        for index, left in enumerate(profiles):
            for right in profiles[index + 1 :]:
                distances.append(voice_distance(left, right))
        return safe_mean(distances)

    def _public_batch_summary(self, batch: dict) -> dict:
        return {
            "id": batch["id"],
            "name": batch["name"],
            "status": batch["status"],
            "mode": batch["mode"],
            "edit_budget": batch["edit_budget"],
            "created_at": batch["created_at"],
            "updated_at": batch["updated_at"],
            "document_count": len(batch["documents"]),
            "summary": deepcopy(batch.get("summary", {})),
            "documents": [
                {
                    "id": document["id"],
                    "name": document["name"],
                    "status": document["status"],
                    "progress_label": document.get("progress_label", ""),
                    "quality_delta": document.get("quality_delta", 0),
                    "detector_risk_delta": document.get("detector_risk_delta", 0),
                    "voice_similarity_score": document.get("voice_similarity_score", 0),
                    "is_outlier": document.get("is_outlier", False),
                }
                for document in batch["documents"]
            ],
        }


SERVICE = SlopFilterService()
