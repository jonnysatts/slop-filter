"""Tests for slopfilter_engine."""
import sys
from pathlib import Path

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
