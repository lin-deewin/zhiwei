"""Read-only performance baseline for library browsing, search, reading and RAG.

A supplied library is copied with SQLite's backup API before any application
service is called. The original library is never opened by the benchmark.
Without --library, a synthetic library is generated in a temporary directory.
"""
from __future__ import annotations

import argparse
import json
import math
import tempfile
import time
from pathlib import Path
from typing import Callable

from app.core.backup import backup_library, verify_backup
from app.core.config import library_scope
from app.services.library import get_content, import_markdown, list_contents
from app.services.rag import retrieve


DEFAULT_QUERY = "性能基线 检索架构"


def _percentile(samples: list[float], percentile: float) -> float:
    if not samples:
        raise ValueError("At least one timing sample is required")
    ordered = sorted(samples)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(ordered[index], 3)


def _measure(operation: Callable[[], object], iterations: int, warmups: int = 1) -> dict:
    for _ in range(warmups):
        operation()
    samples: list[float] = []
    for _ in range(iterations):
        started = time.perf_counter()
        operation()
        samples.append((time.perf_counter() - started) * 1000)
    return {
        "iterations": iterations,
        "p50_ms": _percentile(samples, 0.50),
        "p95_ms": _percentile(samples, 0.95),
        "max_ms": round(max(samples), 3),
    }


def create_synthetic_library(library: Path, article_count: int, query: str = DEFAULT_QUERY) -> None:
    """Seed deterministic, non-personal Markdown articles into an isolated library."""
    library.mkdir(parents=True, exist_ok=True)
    paragraph = (
        f"{query}。这是一篇自动生成的性能基线资料，用于验证资料列表、全文搜索、"
        "阅读器正文加载和知识检索的耗时。它不包含任何真实用户内容。"
    )
    markdown_body = "\n\n".join(paragraph * 8 for _ in range(4))
    with library_scope(library):
        for index in range(1, article_count + 1):
            markdown = f"# 性能基线资料 {index:04d}\n\n{markdown_body}\n\n记录编号：{index:04d}"
            import_markdown(f"performance-{index:04d}.md", markdown.encode("utf-8"))


def benchmark_library(library: Path, query: str = DEFAULT_QUERY, iterations: int = 10) -> dict:
    """Measure core read paths against a disposable library copy."""
    if iterations < 1:
        raise ValueError("iterations must be at least 1")
    with library_scope(library):
        first_page = list_contents(page=1, page_size=20)
        if not first_page["items"]:
            raise ValueError("资料库没有可供基准测试的文章")
        content_id = first_page["items"][0]["id"]
        search_result = list_contents(q=query, page=1, page_size=20)
        reader_result = get_content(content_id)
        knowledge_result = retrieve(query, limit=8)

        metrics = {
            "library_first_page": _measure(
                lambda: list_contents(page=1, page_size=20), iterations
            ),
            "library_full_text_search": _measure(
                lambda: list_contents(q=query, page=1, page_size=20), iterations
            ),
            "reader_open": _measure(lambda: get_content(content_id), iterations),
            "knowledge_retrieval_keyword": _measure(
                lambda: retrieve(query, limit=8), iterations
            ),
        }
        return {
            "article_count": first_page["total"],
            "search_hits": search_result["total"],
            "reader_markdown_chars": len((reader_result or {}).get("markdown", "")),
            "knowledge_result_count": len(knowledge_result),
            "query": query,
            "iterations": iterations,
            "metrics": metrics,
        }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="在临时副本或合成资料库上测量知微核心读取路径，不修改原始资料库"
    )
    parser.add_argument(
        "--library",
        type=Path,
        help="脱敏资料库目录；工具会先创建一致性副本，再在副本上运行",
    )
    parser.add_argument(
        "--synthetic-articles",
        type=int,
        default=None,
        help="未指定 --library 时生成的合成文章数量（默认 1000）",
    )
    parser.add_argument("--iterations", type=int, default=10, help="每项指标的预热后测量次数")
    parser.add_argument("--query", default=DEFAULT_QUERY, help="搜索与知识检索使用的查询词")
    args = parser.parse_args()

    if args.library and args.synthetic_articles is not None:
        parser.error("--library 与 --synthetic-articles 不能同时使用")
    if args.iterations < 1 or args.iterations > 100:
        parser.error("--iterations 必须在 1 到 100 之间")
    if not args.query.strip():
        parser.error("--query 不能为空")

    with tempfile.TemporaryDirectory(prefix="zhiwei-performance-") as temporary:
        root = Path(temporary)
        if args.library:
            source = args.library.expanduser().resolve()
            clone = root / "library-copy"
            started = time.perf_counter()
            backup_library(source, clone)
            backup_report = verify_backup(clone)
            snapshot_seconds = round(time.perf_counter() - started, 3)
            library = clone
            source_kind = "deidentified-library-copy"
        else:
            article_count = args.synthetic_articles if args.synthetic_articles is not None else 1000
            if article_count < 1 or article_count > 100_000:
                parser.error("--synthetic-articles 必须在 1 到 100000 之间")
            library = root / "synthetic-library"
            started = time.perf_counter()
            create_synthetic_library(library, article_count, args.query)
            snapshot_seconds = round(time.perf_counter() - started, 3)
            backup_report = None
            source_kind = "synthetic"

        report = benchmark_library(library, args.query, args.iterations)
        report.update({
            "schema_version": 1,
            "source": source_kind,
            "dataset_setup_seconds": snapshot_seconds,
            "backup_verification": backup_report,
            "privacy": "Only aggregate counts and timings are emitted; titles, IDs and article text are omitted.",
        })
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
