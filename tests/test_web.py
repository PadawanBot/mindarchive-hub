"""Tests for the web dashboard and API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Provide a FastAPI test client."""
    from mindarchive.web.app import create_app

    app = create_app()
    return TestClient(app)


class TestHealthEndpoint:
    def test_health(self, client: TestClient):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestDashboardPages:
    def test_dashboard_page(self, client: TestClient):
        response = client.get("/")
        assert response.status_code == 200
        assert "Production Dashboard" in response.text
        assert "MindArchive" in response.text

    def test_formats_page(self, client: TestClient):
        response = client.get("/formats")
        assert response.status_code == 200
        assert "Format Library" in response.text
        assert "Documentary" in response.text

    def test_profiles_page(self, client: TestClient):
        response = client.get("/profiles")
        assert response.status_code == 200
        assert "Channel Profiles" in response.text

    def test_costs_page(self, client: TestClient):
        response = client.get("/costs")
        assert response.status_code == 200
        assert "Cost Dashboard" in response.text

    def test_projects_page(self, client: TestClient):
        response = client.get("/projects")
        assert response.status_code == 200
        assert "Projects" in response.text


class TestAPIEndpoints:
    def test_api_formats(self, client: TestClient):
        response = client.get("/api/formats")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 5
        slugs = {f["slug"] for f in data}
        assert "documentary" in slugs

    def test_api_projects(self, client: TestClient):
        response = client.get("/api/projects")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_api_profiles(self, client: TestClient):
        response = client.get("/api/profiles")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_api_cost_summary(self, client: TestClient):
        response = client.get("/api/costs/summary")
        assert response.status_code == 200
        data = response.json()
        assert "total_cost" in data
        assert "video_count" in data


class TestHTMXPartials:
    def test_stats_partial(self, client: TestClient):
        response = client.get("/partials/stats")
        assert response.status_code == 200
        assert "Active Projects" in response.text

    def test_recent_projects_partial(self, client: TestClient):
        response = client.get("/partials/recent-projects")
        assert response.status_code == 200

    def test_live_activity_partial(self, client: TestClient):
        response = client.get("/partials/live-activity")
        assert response.status_code == 200

    def test_cost_ledger_partial(self, client: TestClient):
        response = client.get("/partials/cost-ledger")
        assert response.status_code == 200


class TestSSEEvents:
    def test_subscribe_count(self):
        from mindarchive.web.events import subscriber_count

        assert subscriber_count() == 0

    def test_broadcast_event(self):
        from mindarchive.pipeline.orchestrator import PipelineEvent
        from mindarchive.web.events import broadcast_event

        # Should not raise even with no subscribers
        event = PipelineEvent(
            event_type="step_complete",
            step_number=2,
            step_name="Script Writer",
            message="Done",
        )
        broadcast_event(event)

    def test_broadcast_production_event(self):
        from mindarchive.web.events import broadcast_production_event

        # Should not raise even with no subscribers
        broadcast_production_event("P1", "complete", {"message": "Voiceover done"})
