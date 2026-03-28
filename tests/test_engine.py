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


class TestCleanupSentence:
    def test_started_to_not_broken(self):
        result = cleanup_sentence("He started to run.")
        assert result != "He run."
        # Should either preserve it or handle it correctly
        assert result.endswith(".")

    def test_began_to_not_broken(self):
        result = cleanup_sentence("They began to understand the problem.")
        assert "They understand" not in result or "began" in result

    def test_preserves_normal_sentences(self):
        result = cleanup_sentence("The car moved quickly down the road.")
        assert result == "The car moved quickly down the road."

    def test_actually_preserved_when_meaningful(self):
        result = cleanup_sentence("He was actually innocent.")
        assert "actually" in result.lower()

    def test_simply_preserved_when_meaningful(self):
        result = cleanup_sentence("She simply walked away.")
        assert "simply" in result.lower()

    def test_stacked_intensifiers_still_cleaned(self):
        result = cleanup_sentence("It was very truly remarkable.")
        intensifiers_remaining = sum(1 for w in result.lower().split() if w in {"very", "truly"})
        assert intensifiers_remaining < 2

    def test_emdash_terminal_preserved(self):
        result = cleanup_sentence("He had one thing to say\u2014")
        assert not result.endswith(",")

    def test_emdash_dialogue_preserved(self):
        result = cleanup_sentence('"I don\'t think\u2014" she started.')
        assert not result.startswith('"I don\'t think, "')

    def test_emdash_parenthetical_converted(self):
        result = cleanup_sentence("The project\u2014already behind schedule\u2014needed more time.")
        assert "needed" in result


class TestModifierCounting:
    def test_family_not_counted_as_modifier(self):
        text = "His family arrived early. The elderly neighbour waved daily."
        result = analyse_text(text)
        assert result["signals"]["modifier_hits"] == 0

    def test_actual_modifiers_still_counted(self):
        text = "He carefully slowly deliberately opened the door."
        result = analyse_text(text)
        assert result["signals"]["modifier_hits"] >= 3


class TestRewriteQualityGuard:
    def test_rewrite_does_not_degrade_both_metrics(self):
        text = "The machine hummed. Gears turned inside the housing. Oil dripped from the seal."
        profile = build_voice_profile(text)
        revised, annotations, changes = rewrite_text(text, profile, "aggressive")
        original_analysis = analyse_text(text)
        revised_analysis = analyse_text(revised)
        quality_delta = revised_analysis["quality_score"] - original_analysis["quality_score"]
        risk_delta = original_analysis["detector_risk"] - revised_analysis["detector_risk"]
        if quality_delta < -2 and risk_delta < -2:
            assert revised == text, "Rewriter made both metrics worse but did not fall back"


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
        text = "The door opened. Silence. Nothing moved."
        result = apply_document_mode_bias(text, "fiction")
        assert "Silence." in result

    def test_worldbuilding_preserves_technical_terms(self):
        text = "The framework governed the system's approach to resource allocation."
        result = apply_document_mode_bias(text, "worldbuilding")
        assert "framework" in result.lower()
        assert "system" in result.lower()


class TestLexicalDiversity:
    def test_repeated_text_not_heavily_penalised(self):
        short = "The cat sat on the mat. It purred loudly."
        long_text = (short + " ") * 25
        short_ld = lexical_diversity(tokenize(short))
        long_ld = lexical_diversity(tokenize(long_text))
        assert abs(short_ld - long_ld) < 0.3, f"Gap too large: {abs(short_ld - long_ld):.4f}"

    def test_genuinely_repetitive_text_still_penalised(self):
        repetitive = "The thing is the thing is the thing is the thing."
        varied = "Mercury fell. Neon flickered. The corridor hummed with tension."
        rep_ld = lexical_diversity(tokenize(repetitive))
        var_ld = lexical_diversity(tokenize(varied))
        assert var_ld > rep_ld
