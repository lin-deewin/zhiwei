from __future__ import annotations

from app.performance_check import (
    _percentile,
    benchmark_library,
    create_synthetic_library,
)


def test_percentile_uses_nearest_rank():
    assert _percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.50) == 3.0
    assert _percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.95) == 5.0


def test_synthetic_performance_baseline_reports_core_read_paths(tmp_path):
    library = tmp_path / "synthetic"
    create_synthetic_library(library, article_count=12)
    report = benchmark_library(library, iterations=2)

    assert report["article_count"] == 12
    assert report["search_hits"] > 0
    assert report["reader_markdown_chars"] > 0
    assert report["knowledge_result_count"] > 0
    assert set(report["metrics"]) == {
        "library_first_page",
        "library_full_text_search",
        "reader_open",
        "knowledge_retrieval_keyword",
    }
    for metric in report["metrics"].values():
        assert metric["iterations"] == 2
        assert metric["p50_ms"] >= 0
        assert metric["p95_ms"] >= metric["p50_ms"]
