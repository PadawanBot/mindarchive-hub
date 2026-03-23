"""Tests for configuration, settings, and credential store."""

from __future__ import annotations

from pathlib import Path

import pytest


class TestAppSettings:
    def test_default_settings(self, app_dir: Path, projects_dir: Path):
        from mindarchive.config.settings import AppSettings

        s = AppSettings(app_dir=app_dir, projects_dir=projects_dir)
        assert s.app_dir == app_dir
        assert s.projects_dir == projects_dir
        assert s.default_model == "claude-sonnet-4-6"
        assert s.default_mode == "phase_gate"

    def test_db_url(self, settings):
        assert "sqlite" in settings.db_url
        assert settings.db_name in settings.db_url

    def test_ensure_dirs(self, settings):
        settings.ensure_dirs()
        assert settings.profiles_dir.exists()
        assert settings.formats_dir.exists()

    def test_credentials_path(self, settings):
        assert "credentials.enc" in str(settings.credentials_path)

    def test_profiles_dir(self, settings):
        assert settings.profiles_dir.exists()


class TestCredentialStore:
    def test_set_and_get(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        store.set("TEST_KEY", "test_value_123")
        assert store.get("TEST_KEY") == "test_value_123"

    def test_get_missing_key(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        assert store.get("NONEXISTENT") is None

    def test_list_keys(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        store.set("KEY_A", "val_a")
        store.set("KEY_B", "val_b")
        keys = store.list_keys()
        assert "KEY_A" in keys
        assert "KEY_B" in keys

    def test_delete_key(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        store.set("TO_DELETE", "value")
        assert store.get("TO_DELETE") == "value"
        store.delete("TO_DELETE")
        assert store.get("TO_DELETE") is None

    def test_validate(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        store.set("ANTHROPIC_API_KEY", "sk-ant-test")
        results = store.validate()
        assert results["ANTHROPIC_API_KEY"] is True
        assert results["ELEVENLABS_API_KEY"] is False

    def test_fernet_encryption(self, app_dir: Path):
        from mindarchive.config.settings import CredentialStore

        store = CredentialStore(app_dir / "credentials.enc")
        store.set("SECRET", "my_secret_key")

        # Raw file should not contain the plaintext
        raw = (app_dir / "credentials.enc").read_bytes()
        assert b"my_secret_key" not in raw

        # But we can still retrieve it
        assert store.get("SECRET") == "my_secret_key"


class TestConstants:
    def test_step_numbers(self):
        from mindarchive.config.constants import ALL_STEPS, STEP_TOPIC_MINER, STEP_MONETIZATION_MAP

        assert STEP_TOPIC_MINER == 1
        assert STEP_MONETIZATION_MAP == 15
        assert len(ALL_STEPS) == 15

    def test_resolutions(self):
        from mindarchive.config.constants import OUTPUT_RESOLUTION, SHORTS_RESOLUTION, THUMBNAIL_RESOLUTION

        assert OUTPUT_RESOLUTION == (1920, 1080)
        assert SHORTS_RESOLUTION == (1080, 1920)
        assert THUMBNAIL_RESOLUTION == (1280, 720)

    def test_phase_step_map(self):
        from mindarchive.config.constants import PHASE_STEP_MAP

        assert 1 in PHASE_STEP_MAP["pre_production"]
        assert 13 in PHASE_STEP_MAP["pre_production"]
        assert 14 in PHASE_STEP_MAP["strategy"]

    def test_distribution_constants(self):
        from mindarchive.config.constants import ALL_DIST_STEPS, DIST_YOUTUBE_UPLOAD

        assert DIST_YOUTUBE_UPLOAD == "D1"
        assert len(ALL_DIST_STEPS) == 5
