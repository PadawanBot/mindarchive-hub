"""Tests for channel profile management."""

from __future__ import annotations

from pathlib import Path

import pytest


class TestProfileManager:
    def test_create_profile(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        profile = mgr.create_profile(name="Test Channel", niche="psychology")

        assert profile.name == "Test Channel"
        assert profile.niche == "psychology"
        assert profile.slug == "test-channel"
        assert profile.default_format == "documentary"
        assert not profile.voice_locked
        assert not profile.brand_locked

    def test_create_profile_custom_slug(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        profile = mgr.create_profile(name="My Channel", niche="science", slug="sci-channel")
        assert profile.slug == "sci-channel"

    def test_create_duplicate_raises(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="Dup", niche="test")
        with pytest.raises(ValueError, match="already exists"):
            mgr.create_profile(name="Dup", niche="test")

    def test_load_profile(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="Load Test", niche="history")
        loaded = mgr.load("load-test")
        assert loaded.name == "Load Test"
        assert loaded.niche == "history"

    def test_load_missing_raises(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        with pytest.raises(FileNotFoundError):
            mgr.load("nonexistent")

    def test_list_profiles(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="First", niche="a")
        mgr.create_profile(name="Second", niche="b")
        profiles = mgr.list_profiles()
        assert len(profiles) >= 2
        slugs = {p.slug for p in profiles}
        assert "first" in slugs
        assert "second" in slugs

    def test_exists(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="Exists", niche="test")
        assert mgr.exists("exists")
        assert not mgr.exists("nope")

    def test_delete_profile(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="ToDelete", niche="test")
        assert mgr.exists("todelete")
        mgr.delete("todelete")
        assert not mgr.exists("todelete")

    def test_export_import_profile(self, app_dir: Path, tmp_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        mgr.create_profile(name="Portable", niche="travel")

        archive = tmp_dir / "portable.tar.gz"
        mgr.export_profile("portable", archive)
        assert archive.exists()

        # Delete and re-import
        mgr.delete("portable")
        assert not mgr.exists("portable")

        slug = mgr.import_profile(archive)
        assert slug == "portable"
        assert mgr.exists("portable")

    def test_profile_toml_roundtrip(self, app_dir: Path):
        from mindarchive.profiles.manager import ProfileManager

        mgr = ProfileManager(app_dir / "profiles")
        original = mgr.create_profile(name="Roundtrip", niche="math")

        # Modify and save
        original.voice_locked = True
        original.voice_name = "TestVoice"
        mgr.save(original)

        # Reload and verify
        loaded = mgr.load("roundtrip")
        assert loaded.voice_locked is True
        assert loaded.voice_name == "TestVoice"


class TestFormatPresets:
    def test_builtin_presets(self):
        from mindarchive.formats.presets import list_presets

        presets = list_presets()
        assert len(presets) >= 5
        slugs = {p.slug for p in presets}
        assert "documentary" in slugs
        assert "explainer" in slugs
        assert "listicle" in slugs
        assert "story" in slugs
        assert "short" in slugs

    def test_get_preset(self):
        from mindarchive.formats.presets import get_preset

        doc = get_preset("documentary")
        assert doc is not None
        assert doc.name == "Documentary"
        assert doc.target_duration_min == 9
        assert doc.base_wpm == 140
        assert doc.builtin is True

    def test_get_missing_preset(self):
        from mindarchive.formats.presets import get_preset

        assert get_preset("nonexistent") is None

    def test_preset_word_ranges(self):
        from mindarchive.formats.presets import get_preset

        doc = get_preset("documentary")
        assert doc.word_range_min < doc.target_words < doc.word_range_max

    def test_short_preset(self):
        from mindarchive.formats.presets import get_preset

        short = get_preset("short")
        assert short is not None
        assert short.duration_range_max <= 1
        assert short.runway_max_scenes == 1
