"""Tests for database models and project manager."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def db_session(settings):
    """Provide a database session for testing."""
    from mindarchive.models import create_tables
    from mindarchive.models.database import Database

    create_tables(settings.db_url_sync)
    database = Database(settings)
    with database.session() as session:
        yield session


class TestDatabase:
    def test_create_tables(self, settings):
        from mindarchive.models import create_tables

        # Should not raise
        create_tables(settings.db_url_sync)

    def test_session_context_manager(self, settings):
        from mindarchive.models import create_tables
        from mindarchive.models.database import Database

        create_tables(settings.db_url_sync)
        database = Database(settings)
        with database.session() as session:
            assert session is not None


class TestProjectManager:
    def test_create_project(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(
            topic="Dark Triad Psychology",
            profile_slug="mindarchive",
            format_preset="documentary",
        )
        assert project.topic == "Dark Triad Psychology"
        assert project.profile_slug == "mindarchive"
        assert project.format_preset == "documentary"
        assert project.status == "created"
        assert project.slug  # Should auto-generate

    def test_get_by_slug(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(
            topic="Test Topic",
            profile_slug="test",
            format_preset="explainer",
        )
        db_session.flush()
        found = mgr.get_by_slug(project.slug)
        assert found is not None
        assert found.topic == "Test Topic"

    def test_get_missing_slug(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        assert mgr.get_by_slug("nonexistent-slug") is None

    def test_list_projects(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        mgr.create_project(topic="A", profile_slug="p1", format_preset="documentary")
        mgr.create_project(topic="B", profile_slug="p2", format_preset="explainer")
        db_session.flush()
        projects = mgr.list_projects()
        assert len(projects) >= 2

    def test_list_projects_filter_status(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        p = mgr.create_project(topic="C", profile_slug="p1", format_preset="short")
        mgr.update_status(p, "complete")
        db_session.flush()

        complete = mgr.list_projects(status="complete")
        assert any(proj.slug == p.slug for proj in complete)

    def test_create_run(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(topic="Run Test", profile_slug="p", format_preset="doc")
        run = mgr.create_run(project)
        assert run.run_number == 1
        assert run.status == "running"

    def test_step_lifecycle(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(topic="Steps", profile_slug="p", format_preset="doc")
        run = mgr.create_run(project)

        step = mgr.create_step_result(run, step_number=2, step_name="Script Writer")
        assert step.status == "running"

        mgr.complete_step(
            step,
            artifact_name="script.md",
            summary="Generated 1200-word script",
            quality_score=0.85,
        )
        assert step.status == "complete"
        assert step.quality_score == 0.85

    def test_fail_step(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(topic="Fail", profile_slug="p", format_preset="doc")
        run = mgr.create_run(project)
        step = mgr.create_step_result(run, step_number=3, step_name="Hook Generator")
        mgr.fail_step(step, "API rate limit exceeded")
        assert step.status == "error"

    def test_skip_step(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(topic="Skip", profile_slug="p", format_preset="doc")
        run = mgr.create_run(project)
        step = mgr.create_step_result(run, step_number=4, step_name="Voice Crafter")
        mgr.skip_step(step, "Voice already locked")
        assert step.status == "skipped"

    def test_save_artifact(self, db_session, settings):
        from mindarchive.services.project_manager import ProjectManager

        mgr = ProjectManager(db_session, settings)
        project = mgr.create_project(topic="Art", profile_slug="p", format_preset="doc")
        path = mgr.save_artifact(project, "test_script.md", "# Script\nHello world", "scripts")
        assert path.exists()
        assert path.read_text() == "# Script\nHello world"
