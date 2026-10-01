from fastapi.testclient import TestClient

from app.main import app
from app.services import knowledge
from app.services.library import import_markdown


def test_workspace_routes_provenance_and_revision(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path/'lib'))
    article = import_markdown('a.md', '# 资料\n\n睡眠有助于专注。'.encode())
    async def model(*args, **kwargs):
        return '睡眠有助于专注 [S1]'
    monkeypatch.setattr(knowledge, 'grounded_answer', model)
    client = TestClient(app, base_url='http://127.0.0.1')
    root = '/api/v1/knowledge'
    response = client.post(root+'/projects', json={'title':'研究','question':'如何保持专注？','source_ids':['article:'+article['id']]})
    assert response.status_code == 201
    project = response.json()
    path = root+'/projects/'+project['id']
    assert client.get(path).json()['evidence'][0]['content_hash']
    asked = client.post(path+'/ask', json={'question':'有什么依据？','revision':project['revision']})
    assert asked.status_code == 200
    assert len(asked.json()['project']['turns']) == 1
    stale = client.patch(path+'/evidence', json={'revision':project['revision'],'source_ids':['article:'+article['id']]})
    assert stale.status_code == 409
    result = client.post(path+'/research', json={'question':'整理研究笔记','revision':asked.json()['project']['revision']})
    assert result.status_code == 200
    note_id = result.json()['note_id']
    note = client.get('/api/v1/research-notes/'+note_id).json()
    assert note['status'] == 'draft'
    assert client.get('/api/v1/research-notes').json()['items'] == []
    draft_list = client.get('/api/v1/research-notes', params={'include_drafts': True}).json()['items']
    assert [(item['id'], item['status']) for item in draft_list] == [(note_id, 'draft')]
    assert client.get('/api/v1/research-notes', params={
        'include_drafts': True, 'q': '整理研究笔记',
    }).json()['items'][0]['id'] == note_id
    assert client.get('/api/v1/research-notes', params={
        'include_drafts': True, 'q': '不存在的笔记',
    }).json()['items'] == []
    saved = client.post('/api/v1/research-notes/'+note_id+'/save', json={'body_md':'编辑后的结论 [S1]','revision':note['revision']})
    assert saved.status_code == 200
    listed = client.get('/api/v1/research-notes', params={'include_drafts': True}).json()['items']
    assert [(item['id'], item['status']) for item in listed] == [(note_id, 'saved')]
    assert len(client.get('/api/v1/research-notes').json()['items']) == 1
    versions = client.get(root+'/versions/'+note_id).json()['items']
    original = versions[-1]['id']
    comparison = client.get(root+'/versions/'+note_id+'/'+original).json()
    assert '编辑后的结论' in comparison['diff']
    restored = client.post(root+'/versions/'+note_id+'/'+original+'/restore', json={'revision':saved.json()['revision']})
    assert restored.status_code == 200
    assert restored.json()['sources'] == note['sources']
    missing = client.get(root+'/projects/missing')
    assert missing.status_code == 404


def test_inline_link_resolution_rejects_ambiguous_titles(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path/'lib'))
    a = import_markdown('a.md', '# 同名\n\n一'.encode())
    import_markdown('b.md', '# 同名\n\n二'.encode())
    client = TestClient(app, base_url='http://127.0.0.1')
    result = client.post('/api/v1/knowledge/resolve-links', json={'targets':['同名','article:'+a['id'],'不存在']})
    assert result.status_code == 200
    assert list(result.json()['items']) == ['article:'+a['id']]
