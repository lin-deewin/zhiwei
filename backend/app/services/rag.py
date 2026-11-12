from __future__ import annotations

import hashlib
import json
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
CHUNK_CHARS = 450
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


def _records(category_id: int | None, folder_id: str | None,
             kinds: list[str] | None = None, library: Path | None = None) -> list[dict]:
    kinds = kinds if kinds is not None else ["article", "note", "annotation", "research", "topic", "personal_note"]
    clauses, params = [], []
    if category_id is not None:
        clauses.append("c.category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)")
        params.extend([category_id, category_id])
    if folder_id:
        clauses.append("EXISTS (SELECT 1 FROM folder_contents fc WHERE fc.content_id=c.id AND fc.folder_id=? AND fc.source_status='active')")
        params.append(folder_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    records = []
    with session(library) as db:
        articles = db.execute(f"SELECT c.* FROM contents c{where} ORDER BY c.id", params).fetchall()
        allowed = {row["id"]: row for row in articles}
        if "article" in kinds:
            library = (library or get_library_dir()).resolve()
            for row in articles:
                path = (library / row["markdown_path"]).resolve()
                if not path.is_relative_to(library) or not path.is_file():
                    continue
                try:
                    text = path.read_text(encoding="utf-8-sig")
                except (OSError, UnicodeError):
                    continue
                records.append({"source_id": "article:" + row["id"], "content_id": row["id"],
                                "title": row["title"], "source_type": "article", "text": text,
                                "url": row["url"], "markdown_path": row["markdown_path"], "record_id": row["id"], "updated_at": row["updated_at"]})
        for kind, table in (("note", "notes"), ("annotation", "annotations")):
            if kind not in kinds:
                continue
            for row in db.execute(f"SELECT * FROM {table} ORDER BY id"):
                article = allowed.get(row["content_id"])
                if article is None:
                    continue
                if kind == "note":
                    title, text = row["title"] or "个人笔记", row["body_md"]
                else:
                    # Orphaned anchors cannot be presented as current original text.
                    quote = ""
                    if row["anchor_status"] == "resolved":
                        anchor = json.loads(row["current_anchor_json"] or row["original_anchor_json"])
                        quote = str(anchor.get("exact") or "")
                    title = "高亮批注"
                    text = ("原文引用（批注保存时的快照）：" + quote + "\n\n" if quote else "") + "个人批注：" + row["comment_md"]
                records.append({"source_id": kind + ":" + row["id"], "record_id": row["id"],
                                "content_id": row["content_id"], "title": title,
                                "article_title": article["title"], "source_type": kind,
                                "text": text, "url": article["url"], "markdown_path": article["markdown_path"], "updated_at": row["updated_at"]})
        if "research" in kinds and category_id is None and not folder_id:
            for row in db.execute("SELECT * FROM research_notes WHERE status='saved' ORDER BY id"):
                records.append({"source_id": "research:" + row["id"], "record_id": row["id"],
                                "content_id": None, "title": row["title"], "source_type": "research",
                                "text": row["body_md"], "url": None, "updated_at": row["updated_at"]})
        if "personal_note" in kinds and category_id is None and not folder_id:
            for row in db.execute("SELECT * FROM personal_notes ORDER BY id"):
                records.append({
                    "source_id": "personal_note:" + row["id"],
                    "record_id": row["id"],
                    "content_id": None,
                    "title": row["title"] or "未命名个人笔记",
                    "source_type": "personal_note",
                    "text": row["body_md"],
                    "url": None,
                    "updated_at": row["updated_at"],
                })
        if "topic" in kinds and category_id is None and not folder_id:
            for row in db.execute("SELECT * FROM knowledge_topics ORDER BY id"):
                records.append({"source_id": "topic:"+row["id"], "record_id": row["id"],
                                "content_id": None, "title": row["title"], "source_type": "topic",
                                "text": row["body_md"], "url": None, "updated_at": row["updated_at"]})
    return records


def _plain_text(block: str) -> str:
    plain = MARKDOWN_LINK.sub(r"\1", block)
    return " ".join(MARKDOWN_NOISE.sub(" ", plain).split())


def _evidence_chunks(record: dict) -> list[dict]:
    text = record["text"]
    digest = hashlib.sha256(text.encode()).hexdigest()
    chunks = []
    # Split before ranking so matches late in a long paragraph are preserved.
    for position, paragraph in enumerate(PARAGRAPH_SPLIT.split(text), start=1):
        if not paragraph.strip() or re.fullmatch(r"#{1,6}\s+[^\n]+", paragraph.strip()):
            continue
        for start in range(0, len(paragraph), CHUNK_CHARS):
            fragment = paragraph[start:start + CHUNK_CHARS]
            plain = _plain_text(fragment)
            if not plain:
                continue
            metadata = {key: value for key, value in record.items() if key != "text"}
            chunks.append({**metadata, "text": fragment,
                           "heading": f"段落 {position} · 片段 {start // CHUNK_CHARS + 1}",
                           "chunk_id": f"{record['source_id']}:{digest[:16]}:{position}:{start}",
                           "content_hash": digest, "search_text": plain})
    return chunks


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


_CORPUS_LOCK = threading.Lock()
_CORPUS_SIGNATURE: tuple = ()
_CORPUS: tuple = ()


def _corpus(records: list[dict]) -> tuple:
    global _CORPUS_SIGNATURE, _CORPUS
    # Exact per-record fingerprints invalidate edits, deletions and library switches.
    signature = tuple(hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).digest()
                      for record in records)
    with _CORPUS_LOCK:
        if signature == _CORPUS_SIGNATURE and _CORPUS:
            return _CORPUS
        chunks = [chunk for record in records for chunk in _evidence_chunks(record)]
        postings: dict[str, list[tuple[int, int]]] = {}
        lengths = []
        for i, chunk in enumerate(chunks):
            counts = Counter(_term_list(chunk["search_text"]))
            lengths.append(max(1, sum(counts.values())))
            for term, count in counts.items():
                postings.setdefault(term, []).append((i, count))
        average = sum(lengths) / len(lengths) if lengths else 1.0
        _CORPUS_SIGNATURE, _CORPUS = signature, (chunks, postings, lengths, average)
        return _CORPUS


def retrieve(question: str, category_id: int | None = None, folder_id: str | None = None,
             limit: int = 8, kinds: list[str] | None = None) -> list[dict]:
    weights = _query_weights(question)
    if not weights:
        return []
    chunks, postings, lengths, average = _corpus(_records(category_id, folder_id, kinds))
    if not chunks:
        return []
    totals: dict[int, float] = {}
    for term, weight in weights.items():
        for i, score in _bm25(postings, lengths, average, len(chunks), term, weight).items():
            totals[i] = totals.get(i, 0) + score
    literal = set(_term_list(question))
    for i, chunk in enumerate(chunks):
        title_terms = set(_term_list(chunk["title"]))
        if literal & title_terms:
            totals.setdefault(i, 0.0)
    for i in totals:
        terms = set(_term_list(chunks[i]["search_text"]))
        coverage = len(literal & terms) / max(1, len(literal))
        # Literal coverage limits broad synonym matches; title is a bounded bonus.
        title_terms = set(_term_list(chunks[i]["title"]))
        totals[i] *= 0.5 + coverage
        totals[i] += 0.5 * len(literal & title_terms) / max(1, len(literal))
    ranked = sorted(totals, key=lambda i: (-totals[i], chunks[i]["chunk_id"]))
    chosen, deferred = [], []
    counts: dict[str, int] = {}
    seen_text = set()
    for i in ranked:
        chunk = chunks[i]
        if chunk["search_text"] in seen_text:
            continue
        key = chunk["source_id"]
        if counts.get(key, 0) >= MAX_PER_CONTENT:
            continue
        seen_text.add(chunk["search_text"])
        counts[key] = counts.get(key, 0) + 1
        evidence = {key: value for key, value in chunk.items() if key != "search_text"}
        evidence["score"] = round(totals[i], 4)
        (chosen if counts[key] == 1 else deferred).append(evidence)
    # Cover multiple records before taking second passages from the same record.
    return (chosen + deferred)[:limit]
