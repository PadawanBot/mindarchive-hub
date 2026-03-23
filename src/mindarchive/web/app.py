"""FastAPI web application — dashboard, profile manager, project viewer."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
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

    # ─── Routes ───

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request) -> HTMLResponse:
        """Main dashboard page."""
        return templates.TemplateResponse("dashboard.html", {
            "request": request,
            "version": __version__,
        })

    @app.get("/profiles", response_class=HTMLResponse)
    async def profiles_page(request: Request) -> HTMLResponse:
        """Profile manager page."""
        from mindarchive.config.settings import get_settings
        from mindarchive.profiles.manager import ProfileManager

        settings = get_settings()
        manager = ProfileManager(settings.profiles_dir)
        profiles = manager.list_profiles()

        return templates.TemplateResponse("profiles.html", {
            "request": request,
            "profiles": profiles,
            "version": __version__,
        })

    @app.get("/formats", response_class=HTMLResponse)
    async def formats_page(request: Request) -> HTMLResponse:
        """Format library page."""
        from mindarchive.config.settings import get_settings
        from mindarchive.formats.presets import list_presets

        settings = get_settings()
        presets = list_presets(settings.formats_dir)

        return templates.TemplateResponse("formats.html", {
            "request": request,
            "presets": presets,
            "version": __version__,
        })

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "version": __version__}

    @app.get("/api/events")
    async def sse_events() -> EventSourceResponse:
        """SSE endpoint for real-time pipeline event streaming."""
        from mindarchive.web.events import subscribe

        return EventSourceResponse(subscribe())

    @app.get("/api/projects")
    async def api_projects() -> list[dict]:
        """List projects as JSON."""
        from mindarchive.config.settings import get_settings
        from mindarchive.models.database import get_database
        from mindarchive.services.project_manager import ProjectManager

        settings = get_settings()
        db = get_database(settings)
        with db.session() as session:
            mgr = ProjectManager(session, settings)
            projects = mgr.list_projects()
            return [
                {
                    "slug": p.slug,
                    "title": p.title,
                    "topic": p.topic,
                    "profile": p.profile_slug,
                    "format": p.format_preset,
                    "status": p.status,
                    "current_step": p.current_step,
                }
                for p in projects
            ]

    @app.get("/api/formats")
    async def api_formats() -> list[dict]:
        """List format presets as JSON."""
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

    return app
