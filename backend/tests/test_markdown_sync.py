import pytest

from app.services import markdown_sync as sync
from app.services.library import import_markdown
from app.services.reading_workspace import create_note, patch_note


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
