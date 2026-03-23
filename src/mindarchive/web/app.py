"""FastAPI web application — HTMX dashboard, API endpoints, SSE events."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

from mindarchive import __version__

TEMPLATES_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="MindArchive Production Hub",
        version=__version__,
        description="Automated faceless YouTube video production dashboard.",
    )

    # Mount static files
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    templates = Jinja2Templates(directory=TEMPLATES_DIR)

    # ═══════════════════════════════════════════════════════
    # Full-page HTML routes
    # ═══════════════════════════════════════════════════════

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request) -> HTMLResponse:
        return templates.TemplateResponse("dashboard.html", {
            "request": request,
            "version": __version__,
            "active_page": "dashboard",
        })

    @app.get("/projects", response_class=HTMLResponse)
    async def projects_page(
        request: Request,
        status: str = Query("all", alias="status"),
    ) -> HTMLResponse:
        return templates.TemplateResponse("projects.html", {
            "request": request,
            "version": __version__,
            "active_page": "projects",
            "status_filter": status,
        })

    @app.get("/projects/{slug}", response_class=HTMLResponse)
    async def project_detail_page(request: Request, slug: str) -> HTMLResponse:
        project = _get_project_summary(slug)
        if not project:
            return templates.TemplateResponse("dashboard.html", {
                "request": request,
                "version": __version__,
                "active_page": "projects",
            })
        return templates.TemplateResponse("project_detail.html", {
            "request": request,
            "version": __version__,
            "active_page": "projects",
            "project": project,
        })

    @app.get("/profiles", response_class=HTMLResponse)
    async def profiles_page(request: Request) -> HTMLResponse:
        from mindarchive.config.settings import get_settings
        from mindarchive.profiles.manager import ProfileManager

        settings = get_settings()
        manager = ProfileManager(settings.profiles_dir)
        profiles = manager.list_profiles()

        return templates.TemplateResponse("profiles.html", {
            "request": request,
            "profiles": profiles,
            "version": __version__,
            "active_page": "profiles",
        })

    @app.get("/formats", response_class=HTMLResponse)
    async def formats_page(request: Request) -> HTMLResponse:
        from mindarchive.config.settings import get_settings
        from mindarchive.formats.presets import list_presets

        settings = get_settings()
        presets = list_presets(settings.formats_dir)

        return templates.TemplateResponse("formats.html", {
            "request": request,
            "presets": presets,
            "version": __version__,
            "active_page": "formats",
        })

    @app.get("/costs", response_class=HTMLResponse)
    async def costs_page(request: Request) -> HTMLResponse:
        cost_data = _get_cost_dashboard_data()
        return templates.TemplateResponse("costs.html", {
            "request": request,
            "version": __version__,
            "active_page": "costs",
            **cost_data,
        })

    # ═══════════════════════════════════════════════════════
    # HTMX partial routes (return HTML fragments)
    # ═══════════════════════════════════════════════════════

    @app.get("/partials/stats", response_class=HTMLResponse)
    async def partial_stats(request: Request) -> HTMLResponse:
        stats = _get_dashboard_stats()
        return templates.TemplateResponse("partials/stats.html", {
            "request": request,
            **stats,
        })

    @app.get("/partials/recent-projects", response_class=HTMLResponse)
    async def partial_recent_projects(
        request: Request,
        limit: int = Query(10),
        status: str | None = Query(None),
    ) -> HTMLResponse:
        projects = _list_projects(limit=limit, status=status)
        return templates.TemplateResponse("partials/recent_projects.html", {
            "request": request,
            "projects": projects,
        })

    @app.get("/partials/live-activity", response_class=HTMLResponse)
    async def partial_live_activity(request: Request) -> HTMLResponse:
        running = _list_projects(status="running", limit=10)
        return templates.TemplateResponse("partials/live_activity.html", {
            "request": request,
            "running_projects": running,
        })

    @app.get("/partials/project-steps/{slug}", response_class=HTMLResponse)
    async def partial_project_steps(request: Request, slug: str) -> HTMLResponse:
        steps = _get_project_steps(slug)
        return templates.TemplateResponse("partials/project_steps.html", {
            "request": request,
            "steps": steps,
        })

    @app.get("/partials/project-artifacts/{slug}", response_class=HTMLResponse)
    async def partial_project_artifacts(request: Request, slug: str) -> HTMLResponse:
        artifacts = _get_project_artifacts(slug)
        return templates.TemplateResponse("partials/project_artifacts.html", {
            "request": request,
            "artifacts": artifacts,
        })

    @app.get("/partials/project-costs/{slug}", response_class=HTMLResponse)
    async def partial_project_costs(request: Request, slug: str) -> HTMLResponse:
        costs = _get_project_costs(slug)
        total_estimated = sum(c.get("estimated_cost_usd", 0) or 0 for c in costs)
        total_actual = sum(c.get("actual_cost_usd", 0) or 0 for c in costs)
        return templates.TemplateResponse("partials/project_costs.html", {
            "request": request,
            "costs": costs,
            "total_estimated": total_estimated,
            "total_actual": total_actual,
        })

    @app.get("/partials/project-distribution/{slug}", response_class=HTMLResponse)
    async def partial_project_distribution(request: Request, slug: str) -> HTMLResponse:
        dist = _get_distribution_summary(slug)
        return templates.TemplateResponse("partials/project_distribution.html", {
            "request": request,
            "distribution": dist,
            "project_slug": slug,
        })

    @app.get("/partials/profile-detail/{slug}", response_class=HTMLResponse)
    async def partial_profile_detail(request: Request, slug: str) -> HTMLResponse:
        from mindarchive.config.settings import get_settings
        from mindarchive.profiles.manager import ProfileManager

        settings = get_settings()
        manager = ProfileManager(settings.profiles_dir)
        try:
            profile = manager.load(slug)
        except FileNotFoundError:
            return HTMLResponse("<p class='text-muted'>Profile not found.</p>")

        return templates.TemplateResponse("partials/profile_detail.html", {
            "request": request,
            "profile": profile,
        })

    @app.get("/partials/cost-ledger", response_class=HTMLResponse)
    async def partial_cost_ledger(request: Request) -> HTMLResponse:
        entries = _get_recent_cost_entries(limit=50)
        return templates.TemplateResponse("partials/cost_ledger.html", {
            "request": request,
            "entries": entries,
        })

    # ═══════════════════════════════════════════════════════
    # JSON API routes
    # ═══════════════════════════════════════════════════════

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "version": __version__}

    @app.get("/api/events")
    async def sse_events() -> EventSourceResponse:
        from mindarchive.web.events import subscribe
        return EventSourceResponse(subscribe())

    @app.get("/api/projects")
    async def api_projects(
        status: str | None = Query(None),
        limit: int = Query(50),
    ) -> list[dict]:
        return _list_projects(status=status, limit=limit)

    @app.get("/api/projects/{slug}")
    async def api_project_detail(slug: str) -> dict:
        project = _get_project_summary(slug)
        if not project:
            return {"error": "not found"}
        return project

    @app.get("/api/projects/{slug}/steps")
    async def api_project_steps(slug: str) -> list[dict]:
        return _get_project_steps(slug)

    @app.get("/api/formats")
    async def api_formats() -> list[dict]:
        from mindarchive.config.settings import get_settings
        from mindarchive.formats.presets import list_presets

        settings = get_settings()
        presets = list_presets(settings.formats_dir)
        return [
            {
                "slug": p.slug,
                "name": p.name,
                "duration": f"{p.duration_range_min}-{p.duration_range_max} min",
                "target_words": p.target_words,
                "builtin": p.builtin,
            }
            for p in presets
        ]

    @app.get("/api/profiles")
    async def api_profiles() -> list[dict]:
        from mindarchive.config.settings import get_settings
        from mindarchive.profiles.manager import ProfileManager

        settings = get_settings()
        manager = ProfileManager(settings.profiles_dir)
        profiles = manager.list_profiles()
        return [
            {
                "slug": p.slug,
                "name": p.name,
                "niche": p.niche,
                "voice_locked": p.voice_locked,
                "brand_locked": p.brand_locked,
                "default_format": p.default_format,
            }
            for p in profiles
        ]

    @app.post("/api/profiles", response_class=HTMLResponse)
    async def api_create_profile(
        name: str = Form(...),
        niche: str = Form(...),
        slug: str = Form(""),
    ) -> HTMLResponse:
        from mindarchive.config.settings import get_settings
        from mindarchive.profiles.manager import ProfileManager

        settings = get_settings()
        settings.ensure_dirs()
        manager = ProfileManager(settings.profiles_dir)

        try:
            profile = manager.create_profile(
                name=name,
                niche=niche,
                slug=slug or None,
            )
            return HTMLResponse(
                f'<p class="text-green-400 text-sm">Profile "{profile.slug}" created! '
                '<a href="/profiles" class="underline">Refresh</a></p>'
            )
        except ValueError as e:
            return HTMLResponse(f'<p class="accent-red text-sm">{e}</p>')

    @app.get("/api/costs/summary")
    async def api_cost_summary() -> dict:
        return _get_cost_dashboard_data()

    return app


# ═══════════════════════════════════════════════════════════
# Data access helpers
# ═══════════════════════════════════════════════════════════


def _get_dashboard_stats() -> dict[str, Any]:
    """Get dashboard statistics."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()

    # Profile count
    try:
        manager = ProfileManager(settings.profiles_dir)
        profile_count = len(manager.list_profiles())
    except Exception:
        profile_count = 0

    # Project counts from DB
    active_count = 0
    complete_count = 0
    cost_today = 0.0

    try:
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            all_projects = mgr.list_projects()
            active_count = sum(1 for p in all_projects if p.status in ("running", "created", "paused"))
            complete_count = sum(1 for p in all_projects if p.status == "complete")
    except Exception:
        pass

    return {
        "active_count": active_count,
        "complete_count": complete_count,
        "profile_count": profile_count,
        "cost_today": cost_today,
    }


def _list_projects(
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List projects as dicts."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            status_filter = status if status and status != "all" else None
            projects = mgr.list_projects(status=status_filter, limit=limit)
            return [
                {
                    "slug": p.slug,
                    "title": p.title,
                    "topic": p.topic,
                    "profile": p.profile_slug,
                    "format": p.format_preset,
                    "status": p.status,
                    "current_step": p.current_step,
                    "model": p.model,
                    "created_at": str(p.created_at) if p.created_at else "",
                    "step_statuses": {},
                }
                for p in projects
            ]
    except Exception:
        return []


def _get_project_summary(slug: str) -> dict[str, Any] | None:
    """Get a single project summary."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            p = mgr.get_by_slug(slug)
            if not p:
                return None
            return {
                "slug": p.slug,
                "title": p.title,
                "topic": p.topic,
                "profile": p.profile_slug,
                "format": p.format_preset,
                "status": p.status,
                "current_step": p.current_step,
                "model": p.model,
                "mode": p.mode,
                "created_at": str(p.created_at) if p.created_at else "",
            }
    except Exception:
        return None


def _get_project_steps(slug: str) -> list[dict[str, Any]]:
    """Get step results for a project's latest run."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            p = mgr.get_by_slug(slug)
            if not p or not p.runs:
                return []

            latest_run = max(p.runs, key=lambda r: r.run_number)
            return [
                {
                    "step_number": s.step_number,
                    "step_name": s.step_name,
                    "status": s.status,
                    "quality_score": s.quality_score,
                    "duration_seconds": s.duration_seconds,
                    "summary": s.summary,
                    "error_detail": s.error_detail,
                    "artifact_name": s.artifact_name,
                }
                for s in sorted(latest_run.steps, key=lambda s: s.step_number)
            ]
    except Exception:
        return []


def _get_project_artifacts(slug: str) -> list[dict[str, Any]]:
    """Get asset records for a project."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            p = mgr.get_by_slug(slug)
            if not p:
                return []
            return [
                {
                    "asset_type": a.asset_type,
                    "artifact_name": getattr(a, "artifact_name", a.asset_type),
                    "status": a.status,
                    "provider": a.provider,
                    "file_size_bytes": a.file_size_bytes,
                    "duration_seconds": a.duration_seconds,
                    "step_number": a.step_number,
                }
                for a in p.assets
            ]
    except Exception:
        return []


def _get_project_costs(slug: str) -> list[dict[str, Any]]:
    """Get cost ledger entries for a project."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            p = mgr.get_by_slug(slug)
            if not p:
                return []
            return [
                {
                    "service": c.service,
                    "operation": c.operation,
                    "step_number": c.step_number,
                    "estimated_cost_usd": c.estimated_cost_usd,
                    "actual_cost_usd": c.actual_cost_usd,
                    "units_used": c.units_used,
                    "unit_type": c.unit_type,
                }
                for c in p.costs
            ]
    except Exception:
        return []


def _get_distribution_summary(slug: str) -> dict[str, Any] | None:
    """Load distribution summary from project metadata JSON."""
    from mindarchive.config.settings import get_settings

    settings = get_settings()
    summary_path = settings.projects_dir / slug / "metadata" / "distribution_summary.json"

    if summary_path.exists():
        try:
            return json.loads(summary_path.read_text())
        except Exception:
            pass
    return None


def _get_cost_dashboard_data() -> dict[str, Any]:
    """Get cost dashboard aggregate data."""
    service_colors = {
        "anthropic": "#9b59b6",
        "elevenlabs": "#1abc9c",
        "openai_dalle": "#f1c40f",
        "runway": "#e74c3c",
        "pexels": "#3498db",
    }

    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            all_projects = mgr.list_projects()

            total_cost = 0.0
            service_totals: dict[str, float] = {}
            video_count = sum(1 for p in all_projects if p.status == "complete")

            for p in all_projects:
                for c in p.costs:
                    cost = c.actual_cost_usd or c.estimated_cost_usd or 0
                    total_cost += cost
                    service_totals[c.service] = service_totals.get(c.service, 0) + cost

            max_service_cost = max(service_totals.values()) if service_totals else 0
            service_costs = [
                {
                    "service": svc,
                    "total": total,
                    "color": service_colors.get(svc, "#8892a4"),
                }
                for svc, total in sorted(service_totals.items(), key=lambda x: -x[1])
            ]

            return {
                "total_cost": total_cost,
                "month_cost": total_cost,  # Simplified — same as total for now
                "avg_per_video": total_cost / video_count if video_count else 0,
                "video_count": video_count,
                "service_costs": service_costs,
                "max_service_cost": max_service_cost,
            }
    except Exception:
        return {
            "total_cost": 0,
            "month_cost": 0,
            "avg_per_video": 0,
            "video_count": 0,
            "service_costs": [],
            "max_service_cost": 0,
        }


def _get_recent_cost_entries(limit: int = 50) -> list[dict[str, Any]]:
    """Get recent cost ledger entries across all projects."""
    try:
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            all_projects = mgr.list_projects()

            entries: list[dict[str, Any]] = []
            for p in all_projects:
                for c in p.costs:
                    entries.append({
                        "service": c.service,
                        "operation": c.operation,
                        "project_slug": p.slug,
                        "cost": c.actual_cost_usd or c.estimated_cost_usd or 0,
                        "units": c.units_used,
                        "unit_type": c.unit_type,
                        "created_at": str(c.created_at) if c.created_at else "",
                    })

            # Sort by newest first, limit
            entries.sort(key=lambda e: e["created_at"], reverse=True)
            return entries[:limit]
    except Exception:
        return []
