"""Keep tests independent of the user's configured model and credentials."""
import pytest

from app.core import config


@pytest.fixture(autouse=True)
def isolated_app_config(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "APP_HOME", tmp_path / "app-home")
    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "app-home" / "config.json")
