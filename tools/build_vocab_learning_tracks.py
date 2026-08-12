#!/usr/bin/env python3
"""Build evidence-backed learning tracks for the Romanian vocabulary dataset.

The script combines CoRoLa lemma frequency with Romanian-only MOROCO news
documents. It never edits the vocabulary file; it writes a reviewable manifest
that can be merged only after the curation rules and sampled rows are inspected.

Dependency: simplemma (install in an isolated environment).
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

try:
    import simplemma
except ImportError as exc:  # pragma: no cover - actionable CLI failure
    raise SystemExit("simplemma is required; install it in an isolated environment") from exc


TOKEN_RE = re.compile(r"[a-zăâîșț]+(?:-[a-zăâîșț]+)*", re.IGNORECASE)
CEDILLA_TRANSLATION = str.maketrans({"ş": "ș", "ţ": "ț", "Ş": "Ș", "Ţ": "Ț"})
TRACKS = {"news_core", "news_extension", "specialist", "scenario_phrasebook", "quarantine"}
SPECIALIST_BOOK_BY_TOPIC = {
    "law_public_affairs": "specialist_law_public_affairs",
    "economics_finance": "specialist_economics_finance",
    "health_medicine": "specialist_health_medicine",
    "science_technology": "specialist_science_technology",
    "defense_security": "specialist_defense_security",
    "work_management": "specialist_work_management",
    "nature_agriculture": "specialist_environment_agriculture",
    "history_culture_arts": "specialist_history_culture",
    "education_language": "specialist_education_language",
    "philosophy_abstract": "specialist_philosophy",
}


def normalize(text: object) -> str:
    value = unicodedata.normalize("NFC", str(text or "")).translate(CEDILLA_TRANSLATION)
    return " ".join(value.lower().strip().split())


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(normalize(text))


def lemma_token(token: str) -> str:
    return normalize(simplemma.lemmatize(normalize(token), lang="ro"))


def teaching_lemma_tokens(word: dict) -> list[str]:
    tokens = tokenize(word.get("ro", ""))
    if word.get("part_of_speech") == "verb" and tokens[:1] == ["a"]:
        tokens = tokens[1:]
    return [lemma_token(token) for token in tokens]


def teaching_surface_tokens(word: dict) -> list[str]:
    tokens = tokenize(word.get("ro", ""))
    if word.get("part_of_speech") == "verb" and tokens[:1] == ["a"]:
        tokens = tokens[1:]
    return tokens


def load_vocab(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    words = payload if isinstance(payload, list) else payload.get("words", [])
    if not words:
        raise SystemExit("vocabulary is empty")
    return words


def load_corola(path: Path) -> tuple[dict[str, int], dict[str, int]]:
    ranks: dict[str, int] = {}
    frequencies: dict[str, int] = {}
    with path.open(encoding="utf-8") as handle:
        for rank, line in enumerate(handle, start=1):
            try:
                lemma, raw_frequency = line.rstrip("\n").split("\t", 1)
                key = normalize(lemma)
                frequency = int(raw_frequency)
            except (ValueError, TypeError):
                continue
            if key and key not in ranks:
                ranks[key] = rank
                frequencies[key] = frequency
    return ranks, frequencies


def evidence_tokens(word: dict, corola_ranks: dict[str, int]) -> tuple[list[str], str]:
    """Prefer the exact teaching headword over an automatic lemma.

    Automatic lemmatization is useful for phrase inflection recall, but it is
    not a part-of-speech or word-sense disambiguator.  A surface headword that
    already exists in CoRoLa must therefore keep its own evidence instead of
    inheriting a more frequent homograph family (for example aplică/aplica).
    """
    surfaces = teaching_surface_tokens(word)
    lemmas = teaching_lemma_tokens(word)
    if len(surfaces) == 1 and surfaces[0] in corola_ranks:
        return surfaces, "exact_headword"
    return lemmas, "automatic_lemma"


def load_news_documents(prefixes: list[Path]) -> list[tuple[str, str]]:
    documents: list[tuple[str, str]] = []
    for prefix in prefixes:
        samples_path = Path(f"{prefix}_samples.txt")
        dialects_path = Path(f"{prefix}_dialects.txt")
        categories_path = Path(f"{prefix}_categories.txt")
        samples = samples_path.read_text(encoding="utf-8").splitlines()
        dialects = dialects_path.read_text(encoding="utf-8").splitlines()
        categories = categories_path.read_text(encoding="utf-8").splitlines()
        if not (len(samples) == len(dialects) == len(categories)):
            raise SystemExit(f"misaligned MOROCO files for {prefix}")
        for sample, dialect, category in zip(samples, dialects, categories):
            sample_id, _, body = sample.partition("\t")
            dialect_id, _, dialect_label = dialect.partition("\t")
            category_id, _, category_label = category.partition("\t")
            if sample_id != dialect_id or sample_id != category_id:
                raise SystemExit(f"misaligned MOROCO row {sample_id}")
            if dialect_label.strip() == "2":
                documents.append((category_label.strip(), body))
    return documents


def make_phrase_trie(candidate_tokens: dict[int, tuple[str, ...]]) -> dict:
    root: dict = {}
    for word_id, tokens in candidate_tokens.items():
        node = root
        for token in tokens:
            node = node.setdefault(token, {})
        node.setdefault("$", []).append(word_id)
    return root


def match_phrases(tokens: list[str], trie: dict) -> Counter:
    matches: Counter = Counter()
    for start in range(len(tokens)):
        node = trie
        cursor = start
        while cursor < len(tokens) and tokens[cursor] in node:
            node = node[tokens[cursor]]
            cursor += 1
            for word_id in node.get("$", []):
                matches[word_id] += 1
    return matches


def collect_news_evidence(
    words: list[dict],
    documents: list[tuple[str, str]],
    corola_ranks: dict[str, int],
) -> tuple[dict, int]:
    candidate_tokens = {
        int(word["id"]): tuple(evidence_tokens(word, corola_ranks)[0])
        for word in words
    }
    candidate_tokens = {word_id: tokens for word_id, tokens in candidate_tokens.items() if tokens}
    phrase_tokens = {word_id: tokens for word_id, tokens in candidate_tokens.items() if len(tokens) > 1}
    evidence_method_by_id = {
        int(word["id"]): evidence_tokens(word, corola_ranks)[1]
        for word in words
    }
    single_surface_ids: dict[str, list[int]] = defaultdict(list)
    single_lemma_ids: dict[str, list[int]] = defaultdict(list)
    for word_id, tokens in candidate_tokens.items():
        if len(tokens) == 1:
            target = single_surface_ids if evidence_method_by_id[word_id] == "exact_headword" else single_lemma_ids
            target[tokens[0]].append(word_id)
    trie = make_phrase_trie(phrase_tokens)

    token_counts: Counter = Counter()
    document_counts: Counter = Counter()
    categories_by_id: dict[int, set[str]] = defaultdict(set)
    total_tokens = 0

    for category, body in documents:
        surfaces = tokenize(body)
        lemmas = [lemma_token(token) for token in surfaces]
        total_tokens += len(lemmas)
        seen_ids: set[int] = set()
        for surface, lemma in zip(surfaces, lemmas):
            for word_id in single_surface_ids.get(surface, []):
                token_counts[word_id] += 1
                seen_ids.add(word_id)
            for word_id in single_lemma_ids.get(lemma, []):
                token_counts[word_id] += 1
                seen_ids.add(word_id)
        for word_id, count in match_phrases(lemmas, trie).items():
            token_counts[word_id] += count
            seen_ids.add(word_id)
        for word_id in seen_ids:
            document_counts[word_id] += 1
            categories_by_id[word_id].add(category)

    evidence = {
        int(word["id"]): {
            "news_frequency": int(token_counts[int(word["id"])]),
            "news_document_count": int(document_counts[int(word["id"])]),
            "news_category_count": len(categories_by_id[int(word["id"])]),
        }
        for word in words
    }
    return evidence, total_tokens


def specialist_book(word: dict) -> str | None:
    return SPECIALIST_BOOK_BY_TOPIC.get(word.get("topic"))


def classify(word: dict, corpus_rank: int | None, news: dict, evidence_method: str) -> tuple[str, str]:
    grammar = word.get("grammar_data") or {}
    phrase_quality = grammar.get("phrase_quality")
    unit_type = word.get("unit_type")
    topic = word.get("topic")
    news_docs = news["news_document_count"]
    news_categories = news["news_category_count"]
    is_multiword = len(teaching_lemma_tokens(word)) > 1

    if phrase_quality == "core":
        if topic == "daily_life" and news_docs < 3:
            return "scenario_phrasebook", "已人工核验的生活场景表达，放入场景词书"
        return "news_core", "已人工核验的高价值通用表达"
    if is_multiword:
        if news_docs >= 8 and news_categories >= 2:
            return "news_core", "新闻语料中跨栏目重复出现的多词表达"
        if news_docs >= 3:
            return "news_extension", "新闻语料中有重复证据的多词表达"
        if topic == "daily_life":
            return "scenario_phrasebook", "自然生活场景表达，按需学习而非默认新闻新词"
        return "specialist", "领域多词术语或搭配，移入专项词书"

    if evidence_method == "automatic_lemma" and word.get("verification_status") != "verified":
        if topic == "daily_life":
            return "scenario_phrasebook", "自动词元证据无法确认当前词性或义项，降入场景词书待复核"
        if specialist_book(word):
            return "specialist", "自动词元证据无法确认当前词性或义项，移入专项词书待复核"
        return "news_extension", "自动词元证据无法确认当前词性或义项，降入扩展层待复核"
    if corpus_rank is not None and corpus_rank <= 10_000:
        return "news_core", "CoRoLa 前10000词的现代通用词"
    if news_docs >= 20 and news_categories >= 2:
        return "news_core", "新闻语料中高频且跨栏目出现"
    if (corpus_rank is not None and corpus_rank <= 20_000) or news_docs >= 5:
        return "news_extension", "当代中频词或新闻扩展词"
    if topic == "daily_life":
        return "scenario_phrasebook", "低频生活场景词，放入场景词书"
    if specialist_book(word):
        return "specialist", "领域词，保留在专项词书"
    return "news_extension", "通用主题低频词，保留在扩展层待复核"


def build_manifest(words: list[dict], corola_path: Path, news_prefixes: list[Path]) -> dict:
    corola_ranks, corola_frequencies = load_corola(corola_path)
    documents = load_news_documents(news_prefixes)
    news_evidence, news_token_total = collect_news_evidence(words, documents, corola_ranks)
    rows = []
    track_counts: Counter = Counter()
    for word in words:
        word_id = int(word["id"])
        tokens, evidence_method = evidence_tokens(word, corola_ranks)
        corpus_lemma = tokens[0] if len(tokens) == 1 else ""
        corpus_rank = corola_ranks.get(corpus_lemma) if corpus_lemma else None
        corpus_frequency = corola_frequencies.get(corpus_lemma) if corpus_lemma else None
        track, reason = classify(word, corpus_rank, news_evidence[word_id], evidence_method)
        if track not in TRACKS:
            raise AssertionError(track)
        track_counts[track] += 1
        frequency_source = None
        if corpus_rank:
            frequency_source = "CoRoLa lemma frequency v1 (2022)"
        elif news_evidence[word_id]["news_document_count"]:
            frequency_source = "MOROCO Romanian news 2018 snapshot"
        rows.append({
            "id": word_id,
            "ro": word.get("ro", ""),
            "learning_track": track,
            "specialist_book": specialist_book(word),
            "content_status": "needs_review" if track == "quarantine" else "active",
            "naturalness_status": "needs_review" if word.get("verification_status") != "verified" else "verified",
            "frequency_rank": corpus_rank,
            "frequency_source": frequency_source,
            "corpus_frequency": corpus_frequency,
            **news_evidence[word_id],
            "curation_reason": reason,
            "evidence_method": evidence_method,
        })
    return {
        "schemaVersion": 1,
        "generatedFrom": {
            "corola": "CoRoLa lemma frequency v1 (2022)",
            "news": "MOROCO Romanian-only news documents (2018 snapshot)",
            "newsDocuments": len(documents),
            "newsTokens": news_token_total,
        },
        "trackCounts": dict(sorted(track_counts.items())),
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vocab", type=Path, required=True)
    parser.add_argument("--corola", type=Path, required=True)
    parser.add_argument("--news-prefix", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_manifest(load_vocab(args.vocab), args.corola, args.news_prefix)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "rows": len(manifest["rows"]),
        "trackCounts": manifest["trackCounts"],
        **manifest["generatedFrom"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
