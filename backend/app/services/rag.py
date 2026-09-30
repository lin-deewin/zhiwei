from __future__ import annotations

import math
import re
import threading
from collections import Counter
from pathlib import Path

from app.core.config import get_library_dir
from app.core.database import session

BM25_K1 = 1.5
BM25_B = 0.75
TITLE_WEIGHT = 2.5
TITLE_MATCH_BONUS = 0.25
EXPANSION_WEIGHT = 0.45
MAX_PER_CONTENT = 2
CHUNK_CHARS = 900
MIN_CHUNK_CHARS = 20

LATIN = re.compile(r"[A-Za-z0-9_]{2,}")
CHINESE_RUN = re.compile(r"[\u3400-\u9fff]+")
CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
MARKDOWN_LINK = re.compile(r"!?\[([^]]*)\]\([^)]*\)")
MARKDOWN_NOISE = re.compile(r"[#>*`_~|]")

# 同义/近义组：查询命中组内任一说法时把整组词加入查询，权重低于字面命中。
SYNONYM_GROUPS: tuple[tuple[str, ...], ...] = (
    ("投资", "理财", "投资理财", "财富", "资产配置", "积累财富", "变有钱", "致富", "发财",
     "赚钱", "挣钱", "搞钱", "财务自由", "基金", "定投", "股票", "副业", "收入"),
    ("专注", "专注力", "注意力", "专心", "沉浸", "效率", "时间管理", "拖延", "拖延症"),
    ("学习", "学习方法", "阅读", "读书", "看书", "记忆", "记不住", "笔记", "知识管理"),
    ("工作", "职场", "上班", "就业", "求职", "面试", "offer", "加薪", "涨薪", "工资",
     "薪资", "失业", "裁员", "被裁", "职业发展"),
    ("创业", "创业公司", "startup", "商业", "商业模式", "融资", "增长"),
    ("人工智能", "AI", "大模型", "模型", "机器学习", "深度学习", "LLM", "GPT"),
    ("编程", "写代码", "开发", "软件开发", "代码", "程序", "算法"),
    ("开源", "开源项目", "github", "仓库", "repository"),
    ("焦虑", "压力", "内耗", "情绪", "抑郁", "心理健康", "心理"),
    ("睡眠", "失眠", "作息", "健康", "体检", "锻炼", "运动"),
    ("房子", "房价", "买房", "房产", "不动产", "租房", "楼市"),
    ("沟通", "表达", "说话", "演讲", "写作", "写作表达", "汇报"),
    ("工具", "生产力", "提效", "自动化", "脚本"),
    ("考试", "考研", "考公", "刷题", "上岸"),
)


def _term_list(value: str) -> list[str]:
    """Split text into matchable terms: latin words plus in-run Chinese bigrams.

    Returned with duplicates so callers can build real term frequencies.
    """
    terms = LATIN.findall(value.lower())
    for run in CHINESE_RUN.findall(value):
        if len(run) == 1:
            terms.append(run)
            continue
        terms.extend(run[index:index + 2] for index in range(len(run) - 1))
        if len(run) <= 4:
            terms.append(run)
    return terms


_GROUP_TERMS: tuple[frozenset[str], ...] = tuple(
    frozenset(term for phrase in group for term in _term_list(phrase))
    for group in SYNONYM_GROUPS
)


def _query_weights(question: str) -> dict[str, float]:
    """Map every candidate query term to its scoring weight (literal beats expanded)."""
    literal = set(_term_list(question))
    weights: dict[str, float] = dict.fromkeys(literal, 1.0)
    for group in _GROUP_TERMS:
        if literal & group:
            for term in group - literal:
                weights.setdefault(term, EXPANSION_WEIGHT)
    return weights


class _Index:
    """In-memory BM25 index over article paragraphs, built once and cached."""

    __slots__ = (
        "avg_len",
        "avg_title_len",
        "block_content",
        "block_heading",
        "block_len",
        "block_postings",
        "block_text",
        "content_id",
        "content_postings",
        "content_title",
        "content_title_len",
        "signature",
    )

    def __init__(self) -> None:
        self.signature: tuple = ()
        self.content_id: list[str] = []
        self.content_title: list[str] = []
        self.content_title_len: list[int] = []
        self.content_postings: dict[str, list[tuple[int, int]]] = {}
        self.block_content: list[int] = []
        self.block_heading: list[str] = []
        self.block_text: list[str] = []
        self.block_len: list[int] = []
        self.block_postings: dict[str, list[tuple[int, int]]] = {}
        self.avg_len = 1.0
        self.avg_title_len = 1.0


_INDEX: _Index | None = None
_INDEX_LOCK = threading.Lock()


def _plain_text(block: str) -> str:
    plain = MARKDOWN_LINK.sub(r"\1", block)
    plain = MARKDOWN_NOISE.sub(" ", plain)
    return " ".join(plain.split())


def _build_index(library: Path, rows: list) -> tuple[_Index, float]:
    index = _Index()
    content_postings: dict[str, list[tuple[int, int]]] = {}
    block_postings: dict[str, list[tuple[int, int]]] = {}
    newest_mtime = 0.0
    for row in rows:
        path = (library / row["markdown_path"]).resolve()
        if not path.is_relative_to(library) or not path.is_file():
            continue
        try:
            newest_mtime = max(newest_mtime, path.stat().st_mtime)
            markdown = path.read_text(encoding="utf-8")
        except OSError:
            continue
        content_index = len(index.content_id)
        index.content_id.append(row["id"])
        index.content_title.append(row["title"])
        title_counts = Counter(_term_list(row["title"]))
        index.content_title_len.append(max(1, sum(title_counts.values())))
        for term, count in title_counts.items():
            content_postings.setdefault(term, []).append((content_index, count))
        blocks = PARAGRAPH_SPLIT.split(CODE_FENCE.sub(" ", markdown))
        for position, block in enumerate(blocks):
            plain = _plain_text(block)
            if len(plain) < MIN_CHUNK_CHARS:
                continue
            block_counts = Counter(_term_list(plain))
            block_index = len(index.block_len)
            index.block_content.append(content_index)
            index.block_heading.append(f"段落 {position + 1}")
            index.block_text.append(plain)
            index.block_len.append(max(1, sum(block_counts.values())))
            for term, count in block_counts.items():
                block_postings.setdefault(term, []).append((block_index, count))
    index.content_postings = content_postings
    index.block_postings = block_postings
    index.avg_len = (sum(index.block_len) / len(index.block_len)) if index.block_len else 1.0
    index.avg_title_len = (
        sum(index.content_title_len) / len(index.content_title_len)
        if index.content_title_len else 1.0
    )
    return index, newest_mtime


def _ensure_index(library: Path, rows: list) -> _Index:
    global _INDEX
    signature_rows = [(row["id"], row["markdown_path"]) for row in rows]
    with _INDEX_LOCK:
        if _INDEX is not None and _INDEX.signature[0:2] == (str(library), signature_rows):
            newest = 0.0
            for _, relative in signature_rows:
                try:
                    newest = max(newest, (library / relative).stat().st_mtime)
                except OSError:
                    continue
            if _INDEX.signature[2] == newest:
                return _INDEX
        index, newest_mtime = _build_index(library, rows)
        index.signature = (str(library), signature_rows, newest_mtime)
        _INDEX = index
        return index


def _bm25(postings: dict[str, list[tuple[int, int]]], lengths: list[int], average: float,
          total: int, term: str, weight: float) -> dict[int, float]:
    entries = postings.get(term)
    if not entries:
        return {}
    idf = math.log(1 + (total - len(entries) + 0.5) / (len(entries) + 0.5))
    shared = weight * idf * (BM25_K1 + 1)
    scores: dict[int, float] = {}
    for position, frequency in entries:
        normaliser = BM25_K1 * (1 - BM25_B + BM25_B * lengths[position] / average)
        scores[position] = shared * frequency / (frequency + normaliser)
    return scores


def retrieve(question: str, category_id: int | None = None, folder_id: str | None = None,
             limit: int = 6) -> list[dict]:
    clauses: list[str] = []
    params: list[object] = []
    if category_id is not None:
        clauses.append("c.category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)")
        params.extend([category_id, category_id])
    if folder_id:
        clauses.append("EXISTS (SELECT 1 FROM folder_contents fc WHERE fc.content_id=c.id AND fc.folder_id=? AND fc.source_status='active')")
        params.append(folder_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with session() as db:
        rows = db.execute(
            f"SELECT c.id, c.title, c.markdown_path FROM contents c{where} ORDER BY c.id", params
        ).fetchall()
    if not rows:
        return []
    weights = _query_weights(question)
    if not weights:
        return []
    index = _ensure_index(get_library_dir().resolve(), rows)
    allowed = {row["id"] for row in rows}
    reachable = [content_id in allowed for content_id in index.content_id]
    if not any(reachable):
        return []
    block_totals: dict[int, float] = {}
    title_totals: dict[int, float] = {}
    for term, weight in weights.items():
        for position, value in _bm25(
            index.block_postings, index.block_len, index.avg_len, len(index.block_len), term, weight
        ).items():
            if reachable[index.block_content[position]]:
                block_totals[position] = block_totals.get(position, 0.0) + value
        for position, value in _bm25(
            index.content_postings, index.content_title_len, index.avg_title_len,
            len(index.content_title_len), term, weight
        ).items():
            if reachable[position]:
                title_totals[position] = title_totals.get(position, 0.0) + value
    if not block_totals:
        return []
    lowered = question.lower()
    scored: list[tuple[float, int]] = []
    for position, body in block_totals.items():
        content_index = index.block_content[position]
        total = body + TITLE_WEIGHT * title_totals.get(content_index, 0.0)
        title = index.content_title[content_index]
        if title and title.lower() in lowered:
            total += TITLE_MATCH_BONUS
        scored.append((total, position))
    scored.sort(key=lambda item: item[0], reverse=True)
    best = scored[0][0] or 1.0
    chosen: list[dict] = []
    per_content: dict[str, int] = {}
    for total, position in scored:
        content_index = index.block_content[position]
        content_id = index.content_id[content_index]
        count = per_content.get(content_id, 0)
        if count >= MAX_PER_CONTENT:
            continue
        chosen.append({
            "content_id": content_id,
            "title": index.content_title[content_index],
            "heading": index.block_heading[position],
            "text": index.block_text[position][:CHUNK_CHARS],
            "score": round(total / best, 4),
        })
        per_content[content_id] = count + 1
        if len(chosen) >= limit:
            break
    return chosen
