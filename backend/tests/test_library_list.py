from app.core.database import session
from app.services.library import list_contents


def test_library_sort_uses_last_sync_and_sorts_before_paging(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path / 'library'))
    with session() as db:
        db.execute("INSERT INTO folders(id,name) VALUES ('folder','测试')")
        for content_id, title, updated in [('a','Z article','2026-09-20'), ('b','A article','2026-09-21')]:
            db.execute("""INSERT INTO contents(id,title,markdown_path,created_at,updated_at)
                VALUES (?,?,?,'2026-09-01',?)""", (content_id,title,f'articles/{content_id}/article.md',updated))
        db.execute("""INSERT INTO folder_contents(folder_id,content_id,first_seen_at,last_seen_at)
            VALUES ('folder','a','2026-09-01','2026-09-30')""")
    from app.services.zhihu_content import _record_membership
    _record_membership("a", "folder", "2026-09-30")
    synced = list_contents(page_size=1)
    assert synced['items'][0]['id'] == 'a'
    assert synced['items'][0]['last_synced_at'] == '2026-09-30'
    assert list_contents(page_size=1, sort='title')['items'][0]['id'] == 'b'
    assert list_contents(page=2, page_size=1, sort='title')['items'][0]['id'] == 'a'


def test_same_sync_time_places_newly_collected_content_first(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path / 'library'))
    with session() as db:
        db.execute("INSERT INTO folders(id,name) VALUES ('folder','测试')")
        for content_id, created in [('zhihu_article_999', '2026-09-20'), ('zhihu_answer_111', '2026-09-30')]:
            db.execute("INSERT INTO contents(id,title,markdown_path,created_at,updated_at) VALUES (?,?,?,?,?)",
                       (content_id, content_id, f'articles/{content_id}/article.md', created, created))
            db.execute("INSERT INTO folder_contents(folder_id,content_id,first_seen_at,last_seen_at) VALUES ('folder',?,?,'2026-09-30')",
                       (content_id, created))
        db.execute("UPDATE contents SET last_synced_at='2026-09-30'")
    assert list_contents()['items'][0]['id'] == 'zhihu_answer_111'


def test_same_sync_orders_by_real_collection_time_not_download_sequence(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path / 'library'))
    with session() as db:
        for content_id, created, collected in [('newest', '2026-09-30T05:00:00', '2026-09-30T00:50:00'), ('older', '2026-09-30T05:01:00', '2026-09-29T09:00:00')]:
            db.execute("INSERT INTO contents(id,title,markdown_path,created_at,updated_at,last_synced_at,collected_at) VALUES (?,?,?,?,?,'2026-09-30T05:00:00',?)",
                       (content_id, content_id, f'articles/{content_id}/article.md', created, created, collected))
    assert list_contents(page_size=1)['items'][0]['id'] == 'newest'


def test_source_filter_combines_with_search_and_pagination(monkeypatch, tmp_path):
    monkeypatch.setenv('ZHILIB_LIBRARY_DIR', str(tmp_path / 'library'))
    with session() as db:
        for cid, kind, title in [('local_one', 'article', '共同 A'),
                                 ('local_two', 'article', '共同 B'),
                                 ('zhihu_article_1', 'article', '共同 C'),
                                 ('zhihu_answer_2', 'answer', '共同 D')]:
            db.execute("INSERT INTO contents(id,kind,title,markdown_path,created_at,updated_at) VALUES (?,?,?,?,'2026-10-01','2026-10-01')",
                       (cid, kind, title, f'articles/{cid}/article.md'))
            db.execute('INSERT INTO content_search(content_id,title,body) VALUES (?,?,?)', (cid, title, title))
    result = list_contents(q='共同', source='local', sort='title', page=2, page_size=1)
    assert result['total'] == 2
    assert [item['id'] for item in result['items']] == ['local_two']
    assert [item['id'] for item in list_contents(source='article')['items']] == ['zhihu_article_1']
    assert [item['id'] for item in list_contents(source='answer')['items']] == ['zhihu_answer_2']
    assert list_contents(source='all')['total'] == 4
