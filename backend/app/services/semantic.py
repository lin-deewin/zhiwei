from __future__ import annotations

import asyncio
import fcntl
import json
import math
import threading
import uuid
from array import array
from pathlib import Path

import numpy as np

from app.core import config
from app.core.database import session
from app.services.library import now
from app.services.rag import _corpus, _records, retrieve

DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
_MODEL = None
_MODEL_NAME = ""
_MODEL_LOCK = threading.RLock()


def _model(name: str, download: bool = False):
    global _MODEL, _MODEL_NAME
    with _MODEL_LOCK:
        if _MODEL is None or _MODEL_NAME != name:
            from fastembed import TextEmbedding

            _MODEL = TextEmbedding(
                name,
                cache_dir=str(config.APP_HOME / "embedding-models"),
                threads=2,
                local_files_only=not download,
            )
            _MODEL_NAME = name
        return _MODEL


def _embed(
    texts: list[str], name: str, query: bool = False, download: bool = False
) -> list[list[float]]:
    with _MODEL_LOCK:
        model = _model(name, download)
        vectors = (
            model.query_embed(texts[0]) if query else model.passage_embed(texts, batch_size=16)
        )
        output = []
        for vector in vectors:
            values = [float(x) for x in vector]
            norm = math.sqrt(sum(x * x for x in values))
            if not norm or any(not math.isfinite(x) for x in values):
                raise ValueError("向量模型返回无效数值")
            output.append([x / norm for x in values])
        return output


def status(library: Path | None = None) -> dict:
    with session(library) as db:
        job = db.execute("SELECT * FROM semantic_jobs ORDER BY created_at DESC LIMIT 1").fetchone()
        count = db.execute("SELECT COUNT(*) FROM semantic_vectors").fetchone()[0]
    return {
        "job": dict(job) if job else None,
        "indexed_chunks": count,
        "default_model": config.get_ai_config()["embedding_model"] or DEFAULT_MODEL,
    }


class SemanticManager:
    def __init__(self):
        self.tasks: dict[str, asyncio.Task] = {}
        self.cancelled: dict[str, threading.Event] = {}

    def recover(self) -> None:
        with session() as db:
            db.execute(
                "UPDATE semantic_jobs SET status='interrupted',error='服务重启，点击更新索引可继续' WHERE status IN ('queued','running')"
            )

    async def start(self) -> dict:
        library = config.get_library_dir().resolve()
        key = str(library)
        if key in self.tasks and not self.tasks[key].done():
            return status(library)
        name = config.get_ai_config()["embedding_model"] or DEFAULT_MODEL
        job_id, timestamp = uuid.uuid4().hex, now()
        with session(library) as db:
            db.execute(
                "INSERT INTO semantic_jobs(id,model,status,created_at,updated_at) VALUES (?,?,'queued',?,?)",
                (job_id, name, timestamp, timestamp),
            )
        event = threading.Event()
        self.cancelled[key] = event
        self.tasks[key] = asyncio.create_task(
            asyncio.to_thread(self._run, library, job_id, name, event)
        )
        return status(library)

    def cancel(self) -> dict:
        key = str(config.get_library_dir().resolve())
        if key in self.cancelled:
            self.cancelled[key].set()
        return status()

    def _run(self, library: Path, job_id: str, name: str, event: threading.Event) -> None:
        def update(**values):
            with session(library) as db:
                columns = ",".join(f"{key}=?" for key in values)
                db.execute(
                    f"UPDATE semantic_jobs SET {columns},updated_at=? WHERE id=?",
                    (*values.values(), now(), job_id),
                )

        lock_path = library / "app-data/semantic-index.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock = lock_path.open("a")
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                update(status="cancelled", error="另一进程正在更新索引")
                return
            # Capture this library; switching the UI cannot redirect worker writes.
            if config.get_library_dir().resolve() != library:
                update(status="cancelled")
                return
            chunks = _corpus(_records(None, None, library=library))[0]
            with session(library) as db:
                known = {
                    row[0]
                    for row in db.execute(
                        "SELECT chunk_id FROM semantic_vectors WHERE model=?", (name,)
                    )
                }
            pending = [s for s in chunks if s["chunk_id"] not in known]
            update(status="running", total=len(pending))
            _model(name, download=True)
            for start in range(0, len(pending), 16):
                if event.is_set():
                    update(status="cancelled")
                    return
                batch = pending[start : start + 16]
                vectors = _embed([s["title"] + "\n" + s["text"] for s in batch], name)
                with session(library) as db:
                    for s, vector in zip(batch, vectors, strict=True):
                        db.execute(
                            "INSERT OR REPLACE INTO semantic_vectors(model,chunk_id,source_id,vector_json) VALUES (?,?,?,?)",
                            (name, s["chunk_id"], s["source_id"], array("f", vector).tobytes()),
                        )
                update(processed=min(start + len(batch), len(pending)))
            # Prune only after complete success; cancelled work remains resumable.
            alive = {s["chunk_id"] for s in chunks}
            with session(library) as db:
                for row in db.execute("SELECT model,chunk_id FROM semantic_vectors").fetchall():
                    if row["model"] != name or row["chunk_id"] not in alive:
                        db.execute(
                            "DELETE FROM semantic_vectors WHERE model=? AND chunk_id=?", tuple(row)
                        )
            # Compact legacy JSON vectors to native float32 without recomputing embeddings.
            with session(library) as db:
                legacy = db.execute(
                    "SELECT chunk_id,vector_json FROM semantic_vectors WHERE model=? AND typeof(vector_json)='text'",
                    (name,),
                ).fetchall()
                for row in legacy:
                    db.execute(
                        "UPDATE semantic_vectors SET vector_json=? WHERE model=? AND chunk_id=?",
                        (
                            array("f", json.loads(row["vector_json"])).tobytes(),
                            name,
                            row["chunk_id"],
                        ),
                    )
            update(status="completed")
        except Exception as error:  # noqa: BLE001 - persist worker failure, no private text
            update(
                status="failed",
                error=f"本地模型或索引不可用（{type(error).__name__}），请检查模型缓存和网络后重试",
            )
        finally:
            lock.close()

    async def shutdown(self) -> None:
        for event in self.cancelled.values():
            event.set()
        tasks = list(self.tasks.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


semantic_manager = SemanticManager()


def semantic_retrieve(
    question: str,
    category_id: int | None = None,
    folder_id: str | None = None,
    limit: int = 40,
    kinds: list[str] | None = None,
) -> list[dict]:
    current = status()
    job = current["job"]
    if not job or not current["indexed_chunks"]:
        return []
    name = config.get_ai_config()["embedding_model"] or DEFAULT_MODEL
    if job["model"] != name:
        return []
    chunks = _corpus(_records(category_id, folder_id, kinds))[0]
    live = {s["chunk_id"]: s for s in chunks}
    with session() as db:
        stored = db.execute(
            "SELECT chunk_id,vector_json FROM semantic_vectors WHERE model=?", (name,)
        ).fetchall()
    query = _embed([question], name, query=True)[0]
    scored = []
    query_array = np.asarray(query, dtype=np.float32)
    for start in range(0, len(stored), 1024):
        selected, vectors = [], []
        for row in stored[start : start + 1024]:
            if row["chunk_id"] not in live:
                continue
            vector = (
                np.frombuffer(row["vector_json"], dtype=np.float32)
                if isinstance(row["vector_json"], bytes)
                else np.asarray(json.loads(row["vector_json"]), dtype=np.float32)
            )
            if len(vector) == len(query):
                selected.append(row["chunk_id"])
                vectors.append(vector)
        if not vectors:
            continue
        similarities = np.einsum("ij,j->i", np.stack(vectors), query_array)
        for chunk_id, similarity in zip(selected, similarities, strict=True):
            if similarity >= 0.35:
                s = {key: value for key, value in live[chunk_id].items() if key != "search_text"}
                scored.append(
                    {
                        **s,
                        "score": round(float(similarity), 5),
                        "semantic_score": round(float(similarity), 5),
                    }
                )
    return sorted(scored, key=lambda s: (-s["score"], s["chunk_id"]))[:limit]


def hybrid_retrieve(
    question: str,
    category_id: int | None = None,
    folder_id: str | None = None,
    limit: int = 40,
    kinds: list[str] | None = None,
) -> list[dict]:
    lexical = retrieve(question, category_id, folder_id, max(limit, 60), kinds)
    try:
        semantic = semantic_retrieve(question, category_id, folder_id, max(limit, 60), kinds)
    except (OSError, RuntimeError, ValueError, ImportError):
        semantic = []
    if not semantic:
        return [{**s, "match_methods": ["keyword"]} for s in lexical[:limit]]
    merged = {}
    for method, results in [("keyword", lexical), ("semantic", semantic)]:
        for rank, source in enumerate(results, 1):
            entry = merged.setdefault(
                source["chunk_id"], {**source, "score": 0.0, "match_methods": []}
            )
            entry["score"] += 1 / (60 + rank)
            entry["match_methods"].append(method)
    ranked = sorted(merged.values(), key=lambda s: (-s["score"], s["chunk_id"]))
    selected, extras, seen, counts = [], [], set(), {}
    for s in ranked:
        if s["text"] in seen or counts.get(s["source_id"], 0) >= 2:
            continue
        seen.add(s["text"])
        counts[s["source_id"]] = counts.get(s["source_id"], 0) + 1
        (selected if counts[s["source_id"]] == 1 else extras).append(s)
    return (selected + extras)[:limit]


async def evaluate(k: int = 5) -> dict:
    with session() as db:
        cases = [
            dict(row) for row in db.execute("SELECT * FROM retrieval_cases ORDER BY created_at")
        ]
    results = []
    for case in cases:
        expected = set(json.loads(case["expected_sources_json"]))
        lexical = await asyncio.to_thread(retrieve, case["question"], None, None, k)
        hybrid = await asyncio.to_thread(hybrid_retrieve, case["question"], None, None, k)
        scores = {}
        for method, hits in [("keyword", lexical), ("hybrid", hybrid)]:
            ids = [s["source_id"] for s in hits]
            scores[method] = {
                "recall": len(expected & set(ids)) / max(1, len(expected)),
                "rr": next((1 / i for i, x in enumerate(ids, 1) if x in expected), 0),
                "hits": ids,
            }
        results.append(
            {"id": case["id"], "question": case["question"], "expected": sorted(expected), **scores}
        )
    summary = {
        method: {
            "recall_at_k": sum(r[method]["recall"] for r in results) / max(1, len(results)),
            "mrr": sum(r[method]["rr"] for r in results) / max(1, len(results)),
        }
        for method in ["keyword", "hybrid"]
    }
    return {
        "k": k,
        "cases": results,
        "summary": summary,
        "indexed_chunks": status()["indexed_chunks"],
    }


def selected_passages(question: str, records: list[dict], per_source: int = 2) -> list[dict]:
    """Rank passages inside each explicitly selected source, including late paragraphs."""
    from collections import Counter

    from app.services.rag import _evidence_chunks, _query_weights, _term_list

    groups = [(record, _evidence_chunks(record)) for record in records]
    semantic_scores = {}
    name = config.get_ai_config()["embedding_model"] or DEFAULT_MODEL
    if records:
        placeholders = ",".join("?" for _ in records)
        with session() as db:
            rows = db.execute(
                f"SELECT chunk_id,vector_json FROM semantic_vectors WHERE model=? AND source_id IN ({placeholders})",
                (name, *(r["source_id"] for r in records)),
            ).fetchall()
        if rows:
            try:
                query = np.asarray(_embed([question], name, query=True)[0], dtype=np.float32)
                for row in rows:
                    vector = (
                        np.frombuffer(row["vector_json"], dtype=np.float32)
                        if isinstance(row["vector_json"], bytes)
                        else np.asarray(json.loads(row["vector_json"]), dtype=np.float32)
                    )
                    if len(vector) == len(query):
                        score = float(np.dot(vector, query))
                        if score >= 0.35:
                            semantic_scores[row["chunk_id"]] = score
            except (OSError, RuntimeError, ValueError, ImportError):
                pass
    weights = _query_weights(question)
    output = []
    for record, chunks in groups:
        lexical_scores = {}
        for i, chunk in enumerate(chunks):
            terms = Counter(_term_list(chunk["search_text"]))
            score = sum(weight * min(3, terms.get(term, 0)) for term, weight in weights.items())
            if score:
                lexical_scores[i] = score
        ranks = {}
        for scores in [
            lexical_scores,
            {
                i: semantic_scores[c["chunk_id"]]
                for i, c in enumerate(chunks)
                if c["chunk_id"] in semantic_scores
            },
        ]:
            for rank, i in enumerate(sorted(scores, key=lambda j: (-scores[j], j)), 1):
                ranks[i] = ranks.get(i, 0) + 1 / (60 + rank)
        chosen = sorted(range(len(chunks)), key=lambda i: (-ranks.get(i, 0), i))[:per_source]
        output.extend({k: v for k, v in chunks[i].items() if k != "search_text"} for i in chosen)
    return output
