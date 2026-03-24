"""MindArchive CLI — Typer-based command interface."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from mindarchive import __version__

console = Console()
app = typer.Typer(
    name="mindarchive",
    help="MindArchive Production Hub — automated faceless YouTube video production.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)

# ─── Sub-command groups ───

config_app = typer.Typer(help="Manage configuration and API credentials.")
profile_app = typer.Typer(help="Manage channel profiles.")
format_app = typer.Typer(help="Manage format presets.")

app.add_typer(config_app, name="config")
app.add_typer(profile_app, name="profile")
app.add_typer(format_app, name="format")


# ═══════════════════════════════════════════════════════════
# Top-level commands
# ═══════════════════════════════════════════════════════════


@app.command()
def produce(
    topic: Optional[str] = typer.Option(None, "--topic", "-t", help="Video topic (omit to let Topic Miner generate one)"),
    profile: str = typer.Option("mindarchive", "--profile", "-p", help="Channel profile slug"),
    format: str = typer.Option("documentary", "--format", "-f", help="Format preset slug"),
    mode: str = typer.Option("phase_gate", "--mode", "-m", help="Run mode: auto, gate, phase_gate"),
    model: str = typer.Option("claude-sonnet-4-6", "--model", help="Claude model to use"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate without running (no API calls)"),
) -> None:
    """Start a new video production pipeline."""
    from mindarchive.config.settings import get_settings
    from mindarchive.formats.presets import get_preset

    settings = get_settings()
    settings.ensure_dirs()

    preset = get_preset(format, settings.formats_dir)
    if preset is None:
        console.print(f"[red]Format preset not found: {format}[/red]")
        raise typer.Exit(1)

    if dry_run:
        _show_dry_run(topic or "(auto — Topic Miner will generate)", profile, preset.name, mode, model, settings)
        return

    from mindarchive.pipeline.runner import PipelineRunner

    runner = PipelineRunner(settings)
    results = runner.run_cli(
        topic=topic or "",
        profile_slug=profile,
        format_slug=format,
        mode=mode,
        model=model,
    )

    if not results:
        console.print("[red]Pipeline did not produce any results.[/red]")
        raise typer.Exit(1)

    # Summary
    completed = sum(1 for r in results.values() if r.status == "complete")
    skipped = sum(1 for r in results.values() if r.status == "skipped")
    errors = sum(1 for r in results.values() if r.status == "error")
    console.print(f"\n[bold]Results:[/bold] {completed} complete, {skipped} skipped, {errors} errors")


@app.command()
def resume(
    project_slug: str = typer.Argument(..., help="Project slug to resume"),
    approve: bool = typer.Option(False, "--approve", help="Approve the current gate"),
    reject: bool = typer.Option(False, "--reject", help="Reject the current gate"),
    notes: str = typer.Option("", "--notes", help="Rejection notes"),
) -> None:
    """Resume a paused pipeline run."""
    console.print(f"[yellow]Resume not yet implemented. Project: {project_slug}[/yellow]")


@app.command()
def rerun(
    project_slug: str = typer.Argument(..., help="Project slug"),
    step: str = typer.Option(..., "--step", help="Step to re-run (e.g. step08)"),
) -> None:
    """Re-run a specific step for an existing project."""
    console.print(f"[yellow]Rerun not yet implemented. Project: {project_slug}, Step: {step}[/yellow]")


@app.command()
def interactive(
    project_slug: str = typer.Argument(..., help="Project slug"),
    step_range: str = typer.Option("2-13", "--step-range", help="Steps to run interactively"),
) -> None:
    """Run steps interactively with manual approval at each gate."""
    console.print(f"[yellow]Interactive mode not yet implemented. Project: {project_slug}[/yellow]")


@app.command(name="list")
def list_projects(
    profile: Optional[str] = typer.Option(None, "--profile", "-p", help="Filter by profile"),
    status: Optional[str] = typer.Option(None, "--status", help="Filter by status"),
) -> None:
    """List all projects."""
    console.print("[yellow]Project listing not yet implemented (needs DB).[/yellow]")


@app.command()
def status(
    project_slug: str = typer.Argument(..., help="Project slug"),
) -> None:
    """Show detailed status of a project."""
    console.print(f"[yellow]Status not yet implemented. Project: {project_slug}[/yellow]")


@app.command()
def thumbnail(
    project_slug: str = typer.Argument(..., help="Project slug"),
    text: str = typer.Option("", "--text", help="Thumbnail text overlay"),
    base_image: Optional[str] = typer.Option(None, "--image", help="Path to base image (or auto-generate)"),
) -> None:
    """Generate a thumbnail for a project."""
    from pathlib import Path as _Path

    from mindarchive.config.settings import get_settings
    from mindarchive.production.compositor import ThumbnailCompositor

    settings = get_settings()
    output_path = settings.projects_dir / project_slug / "thumbnails" / "thumbnail.jpg"

    if not base_image:
        console.print("[yellow]No base image provided. Use --image <path> or generate via DALL-E.[/yellow]")
        return

    compositor = ThumbnailCompositor()
    result = compositor.compose(
        base_image_path=_Path(base_image),
        text=text or project_slug.replace("-", " ").title(),
        output_path=output_path,
        overlay_darken=0.2,
    )
    console.print(f"[green]Thumbnail saved: {result}[/green]")


@app.command()
def distribute(
    project_slug: str = typer.Argument(..., help="Project slug to distribute"),
    skip: Optional[str] = typer.Option(None, "--skip", help="Steps to skip: D1,D2,D3,D4,D5"),
    privacy: str = typer.Option("private", "--privacy", help="YouTube privacy: private, unlisted, public"),
) -> None:
    """Run distribution pipeline (D1-D5) for a completed project."""
    import asyncio

    from mindarchive.config.settings import get_settings

    settings = get_settings()
    project_dir = settings.projects_dir / project_slug

    if not project_dir.exists():
        console.print(f"[red]Project not found: {project_slug}[/red]")
        raise typer.Exit(1)

    skip_steps = set(s.strip().upper() for s in skip.split(",")) if skip else set()

    from mindarchive.distribution.orchestrator import (
        DistributionContext,
        DistributionOrchestrator,
    )

    def on_event(step_id: str, status: str, data: dict) -> None:
        msg = data.get("message", "")
        if status == "start":
            console.print(f"\n[cyan]▶ {step_id}: {msg}[/cyan]")
        elif status == "complete":
            console.print(f"[green]  ✓ {msg}[/green]")
        elif status == "error":
            console.print(f"[red]  ✗ {msg}[/red]")
        elif status == "skip":
            console.print(f"[dim]  ⊘ {msg}[/dim]")

    orch = DistributionOrchestrator(settings=settings, event_callback=on_event)

    # Build minimal context from project directory
    ctx = DistributionContext(
        project_slug=project_slug,
        project_dir=project_dir,
        privacy=privacy,
    )

    # Try to load metadata
    meta_path = project_dir / "metadata" / "upload_blueprint.json"
    if meta_path.exists():
        import json
        bp = json.loads(meta_path.read_text())
        ctx.video_title = bp.get("title", project_slug)
        ctx.video_description = bp.get("description", "")
        ctx.video_tags = bp.get("tags", [])
        ctx.hashtags = bp.get("hashtags", [])

    # Find final video
    video_dir = project_dir / "video"
    if video_dir.exists():
        mp4s = list(video_dir.glob("*_final.mp4"))
        if mp4s:
            ctx.final_video_path = mp4s[0]

    # Find thumbnail
    thumb = project_dir / "thumbnails" / "thumbnail.jpg"
    if thumb.exists():
        ctx.thumbnail_path = thumb

    results = asyncio.run(orch.run(ctx, skip_steps=skip_steps))

    completed = sum(1 for r in results if r.status == "complete")
    errors = sum(1 for r in results if r.status == "error")
    console.print(f"\n[bold]Distribution:[/bold] {completed} complete, {errors} errors")

    if ctx.youtube_url:
        console.print(f"[bold green]YouTube:[/bold green] {ctx.youtube_url}")


@app.command()
def schedule(
    profile: str = typer.Option("mindarchive", "--profile", "-p", help="Channel profile"),
) -> None:
    """Run or update the Consistency Scheduler (Step 14)."""
    console.print(f"[yellow]Schedule not yet implemented. Profile: {profile}[/yellow]")


@app.command()
def monetize(
    profile: str = typer.Option("mindarchive", "--profile", "-p", help="Channel profile"),
) -> None:
    """Run or update the Monetization Map (Step 15)."""
    console.print(f"[yellow]Monetize not yet implemented. Profile: {profile}[/yellow]")


@app.command()
def dashboard(
    port: int = typer.Option(8080, "--port", help="Port for web dashboard"),
) -> None:
    """Launch the web dashboard."""
    console.print(f"[cyan]Starting dashboard on port {port}...[/cyan]")
    import uvicorn

    from mindarchive.web.app import create_app

    web_app = create_app()
    uvicorn.run(web_app, host="0.0.0.0", port=port)


@app.command()
def init(
    force: bool = typer.Option(False, "--force", help="Re-initialize even if already set up"),
) -> None:
    """Initialize MindArchive directories and database."""
    from mindarchive.config.settings import get_settings
    from mindarchive.models import create_tables

    settings = get_settings()
    settings.ensure_dirs()
    create_tables(settings.db_url_sync)

    console.print("[green]MindArchive initialized successfully.[/green]")
    console.print(f"  App dir:      {settings.app_dir}")
    console.print(f"  Projects dir: {settings.projects_dir}")
    console.print(f"  Database:     {settings.app_dir / settings.db_name}")
    console.print(f"  Profiles:     {settings.profiles_dir}")
    console.print(f"  Formats:      {settings.formats_dir}")


@app.callback(invoke_without_command=True)
def main(
    version: bool = typer.Option(False, "--version", "-v", help="Show version"),
) -> None:
    """MindArchive Production Hub."""
    if version:
        console.print(f"mindarchive {__version__}")
        raise typer.Exit()


# ═══════════════════════════════════════════════════════════
# Config sub-commands
# ═══════════════════════════════════════════════════════════


@config_app.command("set")
def config_set(
    key: str = typer.Argument(..., help="Configuration key (e.g. ANTHROPIC_API_KEY)"),
    value: str = typer.Argument(None, help="Value to set (omit to enter securely)"),
) -> None:
    """Set a configuration value or API credential.

    If VALUE is omitted, you will be prompted to enter it securely (hidden input).
    This is recommended for API keys to avoid exposing them in shell history.
    """
    import getpass

    from mindarchive.config.settings import CredentialStore, get_settings

    if value is None:
        console.print("[dim]Paste your key and press Enter (input is hidden for security)[/dim]")
        value = getpass.getpass(f"Enter value for {key}: ")
        if not value.strip():
            console.print("[red]No value provided. Aborted.[/red]")
            raise typer.Exit(1)

    value = value.strip()

    settings = get_settings()
    settings.ensure_dirs()
    store = CredentialStore(settings.credentials_path)
    store.set(key, value)
    console.print(f"[green]Set {key} ({'*' * min(len(value), 8)}...)[/green]")


@config_app.command("get")
def config_get(
    key: str = typer.Argument(..., help="Configuration key to retrieve"),
    unmask: bool = typer.Option(False, "--unmask", help="Show the full value (use with caution)"),
) -> None:
    """Show a stored credential value (masked by default)."""
    from mindarchive.config.settings import CredentialStore, get_settings

    settings = get_settings()
    store = CredentialStore(settings.credentials_path)
    value = store.get(key)
    if value is None:
        console.print(f"[yellow]{key} is not set.[/yellow]")
        raise typer.Exit(1)
    if unmask:
        console.print(f"  {key} = {value}")
    else:
        masked = value[:4] + "*" * (len(value) - 8) + value[-4:] if len(value) > 12 else "****"
        console.print(f"  {key} = {masked}")


@config_app.command("list")
def config_list() -> None:
    """List all stored configuration keys."""
    from mindarchive.config.settings import CredentialStore, get_settings

    settings = get_settings()
    store = CredentialStore(settings.credentials_path)
    keys = store.list_keys()
    if not keys:
        console.print("[yellow]No credentials stored yet. Use 'mindarchive config set <KEY> <value>'[/yellow]")
        return
    for key in sorted(keys):
        console.print(f"  {key}")


@config_app.command("validate")
def config_validate() -> None:
    """Check which API keys are configured."""
    from mindarchive.config.settings import CredentialStore, get_settings

    settings = get_settings()
    store = CredentialStore(settings.credentials_path)
    results = store.validate()

    table = Table(title="API Key Status")
    table.add_column("Key", style="bold")
    table.add_column("Status")
    table.add_column("Required")

    required_keys = {"ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY", "PEXELS_API_KEY"}
    for key, present in sorted(results.items()):
        status_str = "[green]✓ Set[/green]" if present else "[red]✗ Missing[/red]"
        req = "Yes" if key in required_keys else "Optional"
        table.add_row(key, status_str, req)

    console.print(table)


# ═══════════════════════════════════════════════════════════
# Profile sub-commands
# ═══════════════════════════════════════════════════════════


@profile_app.command("list")
def profile_list() -> None:
    """List all channel profiles."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()
    manager = ProfileManager(settings.profiles_dir)
    profiles = manager.list_profiles()

    if not profiles:
        console.print("[yellow]No profiles found. Use 'mindarchive profile create' to add one.[/yellow]")
        return

    table = Table(title="Channel Profiles")
    table.add_column("Slug", style="bold")
    table.add_column("Name")
    table.add_column("Niche")
    table.add_column("Voice")
    table.add_column("Brand")
    table.add_column("Format")

    for p in profiles:
        voice = f"[green]✓ {p.voice_name}[/green]" if p.voice_locked else "[yellow]○[/yellow]"
        brand = "[green]✓ Locked[/green]" if p.brand_locked else "[yellow]○[/yellow]"
        table.add_row(p.slug, p.name, p.niche, voice, brand, p.default_format)

    console.print(table)


@profile_app.command("create")
def profile_create(
    name: str = typer.Option(..., "--name", "-n", help="Channel name"),
    niche: str = typer.Option(..., "--niche", help="Channel niche"),
    slug: Optional[str] = typer.Option(None, "--slug", help="Profile slug (auto-generated if not set)"),
) -> None:
    """Create a new channel profile."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()
    settings.ensure_dirs()
    manager = ProfileManager(settings.profiles_dir)

    try:
        profile = manager.create_profile(name=name, niche=niche, slug=slug)
        console.print(f"[green]Profile created: {profile.slug}[/green]")
        console.print(f"  Path: {settings.profiles_dir / profile.slug / 'profile.toml'}")
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


@profile_app.command("show")
def profile_show(
    slug: str = typer.Argument(..., help="Profile slug"),
) -> None:
    """Show details of a channel profile."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()
    manager = ProfileManager(settings.profiles_dir)

    try:
        p = manager.load(slug)
    except FileNotFoundError:
        console.print(f"[red]Profile not found: {slug}[/red]")
        raise typer.Exit(1)

    console.print(Panel(
        f"[bold]Name:[/bold]   {p.name}\n"
        f"[bold]Niche:[/bold]  {p.niche}\n"
        f"[bold]Voice:[/bold]  {'✓ ' + (p.voice_name or '') + ' (locked)' if p.voice_locked else '○ Not set'}\n"
        f"[bold]Brand:[/bold]  {'✓ Locked' if p.brand_locked else '○ Not set'}\n"
        f"[bold]Format:[/bold] {p.default_format}\n"
        f"[bold]Model:[/bold]  {p.default_model}\n"
        f"[bold]Runway:[/bold] max {p.runway_max_scenes} scenes",
        title=f"[bold cyan]{p.slug}[/bold cyan]",
        border_style="cyan",
    ))


@profile_app.command("export")
def profile_export(
    slug: str = typer.Argument(..., help="Profile slug"),
    output: Path = typer.Option(".", "--output", "-o", help="Output directory"),
) -> None:
    """Export a profile as a portable archive."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()
    manager = ProfileManager(settings.profiles_dir)
    archive_path = output / f"{slug}-profile.tar.gz"

    try:
        result = manager.export_profile(slug, archive_path)
        console.print(f"[green]Exported to: {result}[/green]")
    except FileNotFoundError:
        console.print(f"[red]Profile not found: {slug}[/red]")
        raise typer.Exit(1)


@profile_app.command("import")
def profile_import(
    archive: Path = typer.Argument(..., help="Path to profile archive (.tar.gz)"),
) -> None:
    """Import a profile from a portable archive."""
    from mindarchive.config.settings import get_settings
    from mindarchive.profiles.manager import ProfileManager

    settings = get_settings()
    settings.ensure_dirs()
    manager = ProfileManager(settings.profiles_dir)

    try:
        slug = manager.import_profile(archive)
        console.print(f"[green]Imported profile: {slug}[/green]")
    except (FileNotFoundError, ValueError) as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


# ═══════════════════════════════════════════════════════════
# Format sub-commands
# ═══════════════════════════════════════════════════════════


@format_app.command("list")
def format_list() -> None:
    """List all available format presets."""
    from mindarchive.config.settings import get_settings
    from mindarchive.formats.presets import list_presets

    settings = get_settings()
    presets = list_presets(settings.formats_dir)

    table = Table(title="Format Presets")
    table.add_column("Slug", style="bold")
    table.add_column("Name")
    table.add_column("Duration")
    table.add_column("Words")
    table.add_column("WPM")
    table.add_column("Runway Max")
    table.add_column("Type")

    for p in presets:
        duration = f"{p.duration_range_min}-{p.duration_range_max} min"
        words = f"{p.word_range_min}-{p.word_range_max}"
        ptype = "[dim]built-in[/dim]" if p.builtin else "custom"
        table.add_row(p.slug, p.name, duration, words, str(p.base_wpm), str(p.runway_max_scenes), ptype)

    console.print(table)


@format_app.command("show")
def format_show(
    slug: str = typer.Argument(..., help="Format preset slug"),
) -> None:
    """Show details of a format preset."""
    from mindarchive.config.settings import get_settings
    from mindarchive.formats.presets import get_preset

    settings = get_settings()
    preset = get_preset(slug, settings.formats_dir)
    if preset is None:
        console.print(f"[red]Format preset not found: {slug}[/red]")
        raise typer.Exit(1)

    console.print(Panel(
        f"[bold]Name:[/bold]        {preset.name}\n"
        f"[bold]Description:[/bold] {preset.description}\n"
        f"[bold]Duration:[/bold]    {preset.duration_range_min}-{preset.duration_range_max} min (target: {preset.target_duration_min})\n"
        f"[bold]Words:[/bold]       {preset.word_range_min}-{preset.word_range_max} (target: {preset.target_words})\n"
        f"[bold]WPM:[/bold]         {preset.base_wpm}\n"
        f"[bold]Structure:[/bold]   {preset.structure}\n"
        f"[bold]Cold Open:[/bold]   ≤{preset.cold_open_max_seconds}s\n"
        f"[bold]Runway Max:[/bold]  {preset.runway_max_scenes} scenes\n"
        f"[bold]Visual:[/bold]      {preset.visual_style}\n"
        f"[bold]Tone:[/bold]        {preset.tone_instruction}",
        title=f"[bold cyan]{preset.slug}[/bold cyan]",
        border_style="cyan",
    ))


# ═══════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════


def _show_dry_run(
    topic: str, profile: str, format_name: str, mode: str, model: str, settings: Any
) -> None:
    """Show dry run validation results."""
    from mindarchive.config.settings import CredentialStore
    from mindarchive.profiles.manager import ProfileManager

    console.print(Panel("[bold]DRY RUN — Validation Only (no API calls)[/bold]", border_style="yellow"))

    # Check profile
    manager = ProfileManager(settings.profiles_dir)
    if manager.exists(profile):
        p = manager.load(profile)
        console.print(f"  [green]✓[/green] Profile: {p.name} ({p.niche})")
        if p.voice_locked:
            console.print(f"  [green]✓[/green] Voice locked: {p.voice_name} → Step 4 will skip")
        else:
            console.print(f"  [yellow]○[/yellow] Voice not locked → Step 4 will run")
        if p.brand_locked:
            console.print(f"  [green]✓[/green] Brand locked → Step 7 will skip")
        else:
            console.print(f"  [yellow]○[/yellow] Brand not locked → Step 7 will run")
    else:
        console.print(f"  [red]✗[/red] Profile not found: {profile}")

    # Check credentials
    store = CredentialStore(settings.credentials_path)
    results = store.validate()
    required_keys = {"ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY", "PEXELS_API_KEY"}
    for key in sorted(required_keys):
        if results.get(key):
            console.print(f"  [green]✓[/green] {key}")
        else:
            console.print(f"  [red]✗[/red] {key} — MISSING (required)")

    # Skip map
    console.print(f"\n  Topic: {topic}")
    if topic.startswith("(auto"):
        console.print(f"  Step 1: [green]RUN[/green] (no topic provided — Topic Miner will generate)")
    else:
        console.print(f"  Step 1: [dim]SKIP[/dim] (topic provided via --topic)")
    console.print(f"  Format: {format_name}")
    console.print(f"  Mode: {mode}")
    console.print(f"  Model: {model}")
