from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.database import session
from app.services import knowledge
from app.services.library import import_markdown
from app.services.rag import retrieve
from app.services.reading_workspace import create_annotation, create_note, reading_context


@pytest.fixture
def library(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / 'library'))
    first = import_markdown('专注方法.md', '# 专注方法\n\n专注力可以通过减少通知干扰来改善。'.encode())
    second = import_markdown('时间管理.md', '# 时间管理\n\n专注力也受休息和睡眠影响，不能只依赖关闭通知。'.encode())
    return first, second


def test_unified_retrieval_and_type_filters(library):
    first, _ = library
    note = create_note(first['id'], {'title': '个人体验', 'body_md': '专注力对我而言与睡眠有关。'})
    context = reading_context(first['id'])
    block = next(b for b in context['blocks'] if '减少通知' in b['text'])
    create_annotation(first['id'], {'revision_id': context['revision_id'],
        'anchor': {'revision_id': context['revision_id'], 'normalization_version': context['normalization_version'], 'block_id': block['id'], 'exact': block['text'], 'start': 0, 'end': len(block['text'])},
        'comment_md': '专注力仍然需要个人练习。', 'color': 'yellow'})
    sources = retrieve('专注力', limit=40)
    assert {s['source_type'] for s in sources} == {'article', 'note', 'annotation'}
    assert any(s['record_id'] == note['id'] for s in sources)
    assert all(s['source_type'] == 'note' for s in retrieve('专注力', kinds=['note']))
    assert all(s['content_hash'] and s['chunk_id'] for s in sources)
    assert retrieve('专注力', kinds=[]) == []


def test_long_paragraph_and_short_notes_are_searchable(library):
    first, _ = library
    create_note(first['id'], {'body_md': '量子纠错'})
    import_markdown('long.md', ('# 长文\n\n' + '普通材料' * 400 + '量子纠错可以减少噪声').encode())
    sources = retrieve('量子纠错', limit=10)
    assert {s['source_type'] for s in sources} == {'article', 'note'}
    assert all('量子纠错' in s['text'] for s in sources)


def test_category_folder_scope_and_note_updates(library):
    first, second = library
    note = create_note(first['id'], {'body_md': '专注力练习'})
    with session() as db:
        db.execute("INSERT INTO categories(id,name,created_at) VALUES (123,'分类','now')")
        db.execute("UPDATE contents SET category_id=123 WHERE id=?", (first['id'],))
        db.execute("INSERT INTO folders(id,name) VALUES ('folder','夹')")
        db.execute("INSERT INTO folder_contents(folder_id,content_id,first_seen_at,last_seen_at) VALUES ('folder',?,'now','now')", (second['id'],))
    assert {s['content_id'] for s in retrieve('专注力', category_id=123)} == {first['id']}
    assert {s['content_id'] for s in retrieve('专注力', folder_id='folder')} == {second['id']}
    before = retrieve('专注力', kinds=['note'])[0]['chunk_id']
    with session() as db:
        db.execute('UPDATE notes SET body_md=? WHERE id=?', ('专注力练习已更新', note['id']))
    assert retrieve('专注力', kinds=['note'])[0]['chunk_id'] != before
    with session() as db:
        db.execute('DELETE FROM notes WHERE id=?', (note['id'],))
    assert retrieve('专注力', kinds=['note']) == []


async def _valid_model(*args, **kwargs):
    return '## 核心结论\n\n减少通知可能改善专注力 [S1]。休息也很重要 [S2]。'


def test_research_snapshot_save_and_retrieval(library, monkeypatch):
    monkeypatch.setattr(knowledge, 'chat_completion', _valid_model)
    selected = retrieve('专注力', kinds=['article'])
    note = asyncio.run(knowledge.research('专注力', [s['chunk_id'] for s in selected], kinds=['article']))
    assert note['status'] == 'draft'
    assert knowledge.list_research() == []
    saved = knowledge.save_research(note['id'])
    assert saved['status'] == 'saved'
    assert len({s['source_id'] for s in saved['sources']}) == 2
    assert retrieve('专注力', kinds=['research'])[0]['record_id'] == note['id']
    original = saved['sources'][0]['text']
    first, _ = library
    with session() as db:
        db.execute('DELETE FROM contents WHERE id=?', (first['id'],))
    assert knowledge.research_note(note['id'])['sources'][0]['text'] == original
    assert len(knowledge.list_research('核心结论')) == 1
    with pytest.raises(ValueError):
        knowledge.save_research(note['id'], body_md='错误出处 [S999]')


def test_stale_selection_and_single_source_rejected(library, monkeypatch):
    monkeypatch.setattr(knowledge, 'chat_completion', _valid_model)
    selected = retrieve('专注力', kinds=['article'])
    with pytest.raises(ValueError, match='两份'):
        asyncio.run(knowledge.research('专注力', [selected[0]['chunk_id']], kinds=['article']))
    with session() as db:
        db.execute('DELETE FROM contents WHERE id=?', (selected[0]['content_id'],))
    with pytest.raises(ValueError, match='变化'):
        asyncio.run(knowledge.research('专注力', [s['chunk_id'] for s in selected], kinds=['article']))


def test_invalid_citations_repaired_or_rejected(library, monkeypatch):
    sources = knowledge.numbered(retrieve('专注力', kinds=['article']))
    replies = iter(['臆造 [S99]', '有依据的结论 [S1]'])
    async def model(*args, **kwargs):
        return next(replies)
    monkeypatch.setattr(knowledge, 'chat_completion', model)
    assert asyncio.run(knowledge.grounded_answer('专注力', sources)) == '有依据的结论 [S1]'
    async def bad_model(*args, **kwargs):
        return '没有出处'
    monkeypatch.setattr(knowledge, 'chat_completion', bad_model)
    with pytest.raises(ValueError, match='有效出处'):
        asyncio.run(knowledge.grounded_answer('专注力', sources))


def test_rerank_ids_must_be_candidates(library, monkeypatch):
    sources = retrieve('专注力')
    async def model(*args, **kwargs):
        return '[999]'
    monkeypatch.setattr(knowledge, 'chat_completion', model)
    ranked, method = asyncio.run(knowledge.rerank('专注力', sources, limit=1))
    assert ranked == sources[:1] and method == 'unified-bm25'
    async def valid_model(*args, **kwargs):
        return '[1, 1, 0]'
    monkeypatch.setattr(knowledge, 'chat_completion', valid_model)
    ranked, _ = asyncio.run(knowledge.rerank('专注力', sources, limit=1))
    assert ranked == [sources[1]]


def test_api_search_generate_save_reload(library, monkeypatch):
    from app.main import app
    monkeypatch.setattr(knowledge, 'chat_completion', _valid_model)
    client = TestClient(app, base_url="http://127.0.0.1")
    payload = {'question': '专注力', 'kinds': ['article']}
    response = client.post('/api/v1/knowledge/search', json=payload)
    assert response.status_code == 200
    sources = response.json()['sources']
    response = client.post('/api/v1/research-notes', json={**payload, 'chunk_ids': [s['chunk_id'] for s in sources]})
    assert response.status_code == 201
    note_id = response.json()['id']
    assert client.post(f'/api/v1/research-notes/{note_id}/save', json={}).status_code == 200
    assert client.get('/api/v1/research-notes').json()['items'][0]['id'] == note_id
    assert client.get(f'/api/v1/research-notes/{note_id}').json()['sources'] == response.json()['sources']
    assert client.post('/api/v1/ask', json=payload).json()['sources'][0]['source_type'] == 'article'
    assert client.post('/api/v1/knowledge/search', json={**payload, 'kinds': []}).status_code == 422
    assert client.delete(f'/api/v1/research-notes/{note_id}').status_code == 204
    assert client.get(f'/api/v1/research-notes/{note_id}').status_code == 404


def test_generation_cannot_write_to_another_library(library, monkeypatch, tmp_path):
    selected = retrieve("专注力", kinds=["article"])
    async def switch_library(*args, **kwargs):
        monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "other-library"))
        return "结论 [S1]"
    monkeypatch.setattr(knowledge, "chat_completion", switch_library)
    with pytest.raises(ValueError, match="切换"):
        asyncio.run(knowledge.research("专注力", [s["chunk_id"] for s in selected], kinds=["article"]))
    assert knowledge.list_research() == []


def test_no_evidence_and_unconfigured_model(library, monkeypatch):
    from app.main import app
    client = TestClient(app, base_url="http://127.0.0.1")
    async def unconfigured(*args, **kwargs):
        raise ValueError("AI_NOT_CONFIGURED")
    monkeypatch.setattr(knowledge, "chat_completion", unconfigured)
    assert client.post("/api/v1/ask", json={"question": "量子纠错"}).json()["sources"] == []
    assert client.post("/api/v1/ask", json={"question": "专注力"}).status_code == 503


def test_model_error_is_actionable_and_does_not_expose_provider_body(library, monkeypatch):
    import httpx

    from app.main import app
    from app.services.ai import AIRequestError
    client = TestClient(app, base_url="http://127.0.0.1")
    async def timeout(*args, **kwargs):
        raise AIRequestError("OpenCode 模型响应超过 240 秒，请减少所选片段或稍后重试")
    monkeypatch.setattr(knowledge, "chat_completion", timeout)
    response = client.post("/api/v1/ask", json={"question": "专注力"})
    assert response.status_code == 502
    assert "240 秒" in response.json()["detail"]
    async def throttled(*args, **kwargs):
        request = httpx.Request("POST", "https://provider.invalid/chat/completions")
        response = httpx.Response(429, request=request, text="private provider details")
        response.raise_for_status()
    monkeypatch.setattr(knowledge, "chat_completion", throttled)
    response = client.post("/api/v1/ask", json={"question": "专注力"})
    assert "限流" in response.json()["detail"]
    assert "private" not in response.text


def test_evidence_budget_keeps_query_matches_and_snapshots():
    source = {"text": "普通段落" * 300 + "量子纠错的重要证据", "chunk_id": "original", "content_hash": "original-hash"}
    result = knowledge.budget_sources("量子纠错", [source], budget=300)[0]
    assert len(result["text"]) <= 300
    assert "量子纠错" in result["text"]
    assert result["excerpted"]
    assert result["chunk_id"] == source["chunk_id"]
    assert result["content_hash"] == source["content_hash"]
