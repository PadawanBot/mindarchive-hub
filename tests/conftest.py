"""Shared test fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

from mindarchive.models.database import reset_database


@pytest.fixture(autouse=True)
def _reset_db_singleton():
    """Reset the database singleton between tests."""
    reset_database()
    yield
    reset_database()


@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for tests."""
    return tmp_path


@pytest.fixture
def app_dir(tmp_path: Path) -> Path:
    """Provide a temporary app directory (~/.mindarchive equivalent)."""
    d = tmp_path / ".mindarchive"
    d.mkdir()
    (d / "profiles").mkdir()
    (d / "formats").mkdir()
    return d


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    """Provide a temporary projects directory."""
    d = tmp_path / "projects"
    d.mkdir()
    return d


@pytest.fixture
def settings(app_dir: Path, projects_dir: Path):
    """Provide AppSettings configured for testing."""
    from mindarchive.config.settings import AppSettings

    return AppSettings(
        app_dir=app_dir,
        projects_dir=projects_dir,
        db_name="test.db",
    )
