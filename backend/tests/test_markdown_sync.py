import pytest
import yaml

from app.services import markdown_sync as sync
from app.services.library import import_markdown
from app.services.reading_workspace import create_note, patch_note
from app.services.personal_notes import create_personal_note, get_personal_note


def test_export_external_edit_import_and_conflict(monkeypatch, tmp_path):
    library = tmp_path / "lib"
    vault = tmp_path / "vault"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    a = import_markdown("article.md", "# 标题\n\n文章正文。".encode())
    note = create_note(a["id"], {"title": "个人笔记", "body_md": "我的想法"})
    sync.configure(str(vault))
    result = sync.export_all()
    assert all(x["status"] == "exported" for x in result["items"])
    assert all(x["status"] == "unchanged" for x in sync.preview()["items"])
    path = vault / "note" / f"{note['id']}.md"
    path.write_text(path.read_text() + "\n\n外部修改")
    item = next(x for x in sync.preview()["items"] if x["source_id"] == "note:" + note["id"])
    assert item["status"] == "update"
    assert (
        sync.apply([item["path"]], {item["path"]: item["file_hash"]})["items"][0]["status"]
        == "imported"
    )
    assert "外部修改" in sync._record("note:" + note["id"])["body"]
    path.write_text(path.read_text() + "\n再次修改")
    patch_note(note["id"], {"title": "个人笔记", "body_md": "本地修改", "revision": 2})
    assert (
        next(x for x in sync.preview()["items"] if x["source_id"] == "note:" + note["id"])["status"]
        == "conflict"
    )
    before = path.read_text()
    sync.export_all()
    assert path.read_text() == before


def test_batch_import_metadata_images_and_no_duplicates(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "photo.png").write_bytes(b"image")
    (vault / "new.md").write_text(
        "---\ntitle: 自由笔记\nauthor: 作者\n---\n正文\n\n![图](photo.png)"
    )
    sync.configure(str(vault))
    result = sync.apply(["new.md"])["items"][0]
    assert result["status"] == "imported"
    record = sync._record(result["source_id"])
    assert record["title"] == "自由笔记"
    assert "(assets/" in record["body"]
    assert sync.preview()["items"][0]["status"] == "unchanged"
    assert sync.apply(["new.md"])["items"][0]["status"] == "skipped"
    (vault / "photo.png").write_bytes(b"changed image")
    assert sync.preview()["items"][0]["status"] == "update"


def test_boundaries_and_changed_preview(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    vault = tmp_path / "vault"
    vault.mkdir()
    sync.configure(str(vault))
    outside = tmp_path / "outside.md"
    outside.write_text("private")
    (vault / "bad.md").symlink_to(outside)
    assert sync.preview()["items"][0]["status"] == "error"
    (vault / "new.md").write_text("正文")
    item = next(x for x in sync.preview()["items"] if x["path"] == "new.md")
    (vault / "new.md").write_text("修改后正文")
    assert sync.apply(["new.md"], {"new.md": item["file_hash"]})["items"][0]["status"] == "conflict"
    with pytest.raises(ValueError):
        sync.configure(str(tmp_path))
    (vault / "bad-image.md").write_text("![坏图](../outside.png)")
    (tmp_path / "outside.png").write_bytes(b"private")
    assert (
        next(x for x in sync.preview()["items"] if x["path"] == "bad-image.md")["status"] == "error"
    )


def test_rename_symlink_image_and_explicit_merge(monkeypatch, tmp_path):
    library = tmp_path / "lib"
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    sync.configure(str(vault))
    original = vault / "original.md"
    original.write_text("# 文档\n\n初始内容")
    imported = sync.apply(["original.md"])["items"][0]
    original.rename(vault / "renamed.md")
    item = next(x for x in sync.preview()["items"] if x["path"] == "renamed.md")
    assert item["source_id"] == imported["source_id"]
    assert item["status"] == "update"
    assert sync.apply(["renamed.md"])["items"][0]["source_id"] == imported["source_id"]
    a = import_markdown("a.md", "# 内容\n\n文章".encode())
    note = create_note(a["id"], {"title": "笔记", "body_md": "旧正文"})
    sync.export_all()
    path = vault / "note" / f"{note['id']}.md"
    path.write_text(path.read_text() + "\n外部合并")
    patch_note(note["id"], {"title": "笔记", "body_md": "本地编辑", "revision": 1})
    item = next(x for x in sync.preview()["items"] if x["source_id"] == "note:" + note["id"])
    assert item["status"] == "conflict"
    assert sync.apply([item["path"]])["items"][0]["status"] == "skipped"
    result = sync.apply(
        [item["path"]], {item["path"]: item["file_hash"]}, {item["path"]: item["record_hash"]}
    )
    assert result["items"][0]["status"] == "imported"
    assert next((vault / ".zhilib/conflicts").rglob("local.md")).read_text() == "本地编辑"
    (vault / "real.png").write_bytes(b"img")
    (vault / "symlink.png").symlink_to(vault / "real.png")
    (vault / "symlink-image.md").write_text("![图](symlink.png)")
    assert (
        next(x for x in sync.preview()["items"] if x["path"] == "symlink-image.md")["status"]
        == "error"
    )


def test_personal_note_markdown_export_and_external_tag_sync(monkeypatch, tmp_path):
    library = tmp_path / "lib"
    vault = tmp_path / "vault"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    article = import_markdown("source.md", "# 来源文章\n\n引用来源。".encode())
    note = create_personal_note({
        "title": "长期投资原则",
        "body_md": "先理解企业，再考虑价格。",
        "source_ids": ["article:" + article["id"]],
        "tags": ["投资", "长期主义"],
    })
    sync.configure(str(vault))

    exported = sync.export_all()
    item = next(x for x in exported["items"] if x["path"] == f"personal_note/{note['id']}.md")
    assert item["status"] == "exported"
    path = vault / item["path"]
    metadata, body = sync._parse(path)
    assert metadata["zhilib_source"] == "personal_note:" + note["id"]
    assert metadata["tags"] == ["投资", "长期主义"]
    assert next(x for x in sync.preview()["items"] if x["path"] == item["path"])["status"] == "unchanged"

    metadata["title"] = "长期投资与风险控制"
    metadata["tags"] = ["投资", "风险控制"]
    path.write_text(
        "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n"
        + body + "\n\n新增的外部思考。",
        encoding="utf-8",
    )
    preview = next(x for x in sync.preview()["items"] if x["path"] == item["path"])
    assert preview["status"] == "update"
    result = sync.apply([item["path"]], {item["path"]: preview["file_hash"]})
    assert result["items"][0]["status"] == "imported"

    updated = get_personal_note(note["id"])
    assert updated["title"] == "长期投资与风险控制"
    assert "新增的外部思考" in updated["body_md"]
    assert updated["tags"] == ["投资", "风险控制"]
    assert [source["source_id"] for source in updated["sources"]] == ["article:" + article["id"]]


def test_cross_library_personal_note_restore_preserves_source_snapshots(monkeypatch, tmp_path):
    original = tmp_path / "original"
    restored = tmp_path / "restored"
    vault = tmp_path / "vault"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(original))
    article = import_markdown("origin.md", "# 来源\n\n原文".encode())
    created = create_personal_note({
        "title": "独立的理解",
        "body_md": "跨资料库笔记必须保留原来源快照。",
        "source_ids": ["article:" + article["id"]],
        "tags": ["学习", "阅读"],
    })
    sync.configure(str(vault))
    sync.export_all()
    path = f"personal_note/{created['id']}.md"
    metadata, _body = sync._parse(vault / path)
    assert metadata["zhilib_kind"] == "personal_note"
    assert metadata["sources"][0]["source_id"] == "article:" + article["id"]

    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(restored))
    sync.configure(str(vault))
    items = sync.preview()["items"]
    restored_item = next(item for item in items if item["path"] == path)
    assert restored_item["status"] == "restore"
    assert restored_item["source_id"] == "personal_note:" + created["id"]
    applied = sync.apply([path], {path: restored_item["file_hash"]})["items"][0]
    assert applied["status"] == "imported"
    assert applied["source_id"] != restored_item["source_id"]
    restored_id = applied["source_id"].partition(":")[2]
    recovered = get_personal_note(restored_id)
    assert recovered["title"] == "独立的理解"
    assert recovered["tags"] == ["学习", "阅读"]
    assert recovered["sources"][0]["source_id"] == "article:" + article["id"]
    assert recovered["sources"][0]["title_snapshot"] == "来源"
    assert recovered["sources"][0]["available"] is False
    assert next(item for item in sync.preview()["items"] if item["path"] == path)["status"] == "unchanged"
    assert sync.apply([path])["items"][0]["status"] == "skipped"


def test_cross_library_personal_note_restore_requires_valid_sources(monkeypatch, tmp_path):
    library = tmp_path / "empty"
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    sync.configure(str(vault))
    path = vault / "foreign.md"
    metadata = {
        "zhilib_source": "personal_note:foreign123",
        "zhilib_kind": "personal_note",
        "zhilib_library": "another-library",
        "title": "无效快照",
        "sources": [{"source_id": "article:one", "source_type": "topic", "title_snapshot": "错误"}],
    }
    path.write_text(
        "---\n" + yaml.safe_dump(metadata, allow_unicode=True) + "---\n正文",
        encoding="utf-8",
    )
    item = sync.preview()["items"][0]
    assert item["status"] == "restore"
    result = sync.apply(["foreign.md"], {"foreign.md": item["file_hash"]})["items"][0]
    assert result["status"] == "error"
    assert "类型与 ID 不一致" in result["message"]
    with sync.session() as db:
        assert db.execute("SELECT COUNT(*) FROM personal_notes").fetchone()[0] == 0


def test_cross_library_duplicate_personal_note_ids_are_not_imported(monkeypatch, tmp_path):
    library = tmp_path / "empty"
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    sync.configure(str(vault))
    metadata = {
        "zhilib_source": "personal_note:duplicate",
        "zhilib_kind": "personal_note",
        "zhilib_library": "outside",
        "sources": [],
    }
    contents = "---\n" + yaml.safe_dump(metadata) + "---\n正文"
    (vault / "a.md").write_text(contents)
    (vault / "b.md").write_text(contents)
    preview = sync.preview()
    assert {item["status"] for item in preview["items"]} == {"conflict"}
    applied = sync.apply(["a.md", "b.md"])["items"]
    assert all(item["status"] == "skipped" for item in applied)
