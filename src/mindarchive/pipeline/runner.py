"""Pipeline runner — wires CLI/web to the orchestrator with full context setup."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

from mindarchive.config.settings import AppSettings, CredentialStore, get_settings
from mindarchive.formats.presets import FormatPresetData, get_preset
from mindarchive.models.database import get_database
from mindarchive.notifications.base import NotificationManager
from mindarchive.pipeline.orchestrator import PipelineEvent, PipelineOrchestrator, RunMode
from mindarchive.pipeline.prompt_manager import PromptManager
from mindarchive.pipeline.step_base import StepContext, StepOutput
from mindarchive.pipeline.steps import create_all_steps
from mindarchive.profiles.manager import ProfileData, ProfileManager
from mindarchive.providers.anthropic_llm import AnthropicLLM
from mindarchive.services.cost_tracker import CostTracker
from mindarchive.services.project_manager import ProjectManager
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)
console = Console()


class PipelineRunner:
    """High-level runner that sets up all dependencies and runs the pipeline."""

    def __init__(self, settings: AppSettings | None = None) -> None:
        self._settings = settings or get_settings()
        self._settings.ensure_dirs()

    def run_cli(
        self,
        topic: str,
        profile_slug: str,
        format_slug: str,
        mode: str = "phase_gate",
        model: str = "claude-sonnet-4-6",
        step_range: tuple[int, int] | None = None,
    ) -> dict[int, StepOutput]:
        """Run the pipeline from CLI (blocking call)."""
        return asyncio.run(
            self._run_async(topic, profile_slug, format_slug, mode, model, step_range)
        )

    async def _run_async(
        self,
        topic: str,
        profile_slug: str,
        format_slug: str,
        mode: str,
        model: str,
        step_range: tuple[int, int] | None,
    ) -> dict[int, StepOutput]:
        """Async pipeline execution."""
        # Load profile
        profile_mgr = ProfileManager(self._settings.profiles_dir)
        if not profile_mgr.exists(profile_slug):
            console.print(f"[red]Profile not found: {profile_slug}[/red]")
            return {}
        profile = profile_mgr.load(profile_slug)

        # Load format preset
        preset = get_preset(format_slug, self._settings.formats_dir)
        if preset is None:
            console.print(f"[red]Format preset not found: {format_slug}[/red]")
            return {}

        # Get API key
        cred_store = CredentialStore(self._settings.credentials_path)
        api_key = (cred_store.get("ANTHROPIC_API_KEY") or self._settings.anthropic_api_key or "").strip()
        if not api_key:
            console.print("[red]ANTHROPIC_API_KEY not configured. Run: mindarchive config set ANTHROPIC_API_KEY <key>[/red]")
            return {}

        # Set up database and create project
        db = get_database(self._settings)
        db.create_all()

        with db.session() as session:
            proj_mgr = ProjectManager(session, self._settings)
            project = proj_mgr.create_project(
                topic=topic,
                profile_slug=profile_slug,
                format_preset=format_slug,
                mode=mode,
                model=model,
            )
            run = proj_mgr.create_run(project)
            project_slug = project.slug
            output_dir = Path(project.output_dir) if project.output_dir else self._settings.projects_dir / project_slug

        console.print(Panel(
            f"[bold]Project:[/bold]  {project_slug}\n"
            f"[bold]Profile:[/bold]  {profile.name} ({profile.niche})\n"
            f"[bold]Format:[/bold]   {preset.name} ({preset.target_duration_min} min, "
            f"{preset.target_words} words)\n"
            f"[bold]Topic:[/bold]    {topic}\n"
            f"[bold]Mode:[/bold]     {mode}  |  [bold]Model:[/bold] {model}",
            title="[bold cyan]MindArchive Production[/bold cyan]",
            border_style="cyan",
        ))

        # Build dependencies
        rate_limiter = RateLimiter()
        llm = AnthropicLLM(api_key=api_key, default_model=model, rate_limiter=rate_limiter)
        prompts_dir = Path(__file__).parent / "prompts"
        prompt_mgr = PromptManager(prompts_dir)
        cost_tracker = CostTracker()
        notifier = NotificationManager.from_config(profile.notification_config)

        # Create steps
        steps = create_all_steps(llm, prompt_mgr)

        # Build step context
        profile_dict = _profile_to_dict(profile)
        format_dict = _preset_to_dict(preset)

        context = StepContext(
            project_slug=project_slug,
            topic=topic,
            step_number=0,
            profile=profile_dict,
            format_preset=format_dict,
            output_dir=output_dir,
            model=model,
            extra_vars={
                "topic_provided_directly": True,  # topic came from --topic
            },
        )

        # CLI event handler
        def on_event(event: PipelineEvent) -> None:
            _cli_event_handler(event, console)

        # Create and run orchestrator
        run_mode = RunMode(mode)
        orchestrator = PipelineOrchestrator(
            steps=steps,
            mode=run_mode,
            cost_tracker=cost_tracker,
            notifier=notifier,
            event_callback=on_event,
        )

        results = await orchestrator.run(context, step_range=step_range)

        # Save artifacts to disk
        with db.session() as session:
            proj_mgr = ProjectManager(session, self._settings)
            project = proj_mgr.get_by_slug(project_slug)
            if project:
                for step_num, output in results.items():
                    if output.is_success and output.content and output.artifact_name:
                        subdir = "scripts" if "script" in output.artifact_name else "metadata"
                        proj_mgr.save_artifact(project, output.artifact_name, output.content, subdir)

                    # Record step result in DB
                    step_result = proj_mgr.create_step_result(run, step_num, output.step_name)
                    if output.is_success:
                        proj_mgr.complete_step(
                            step_result,
                            artifact_name=output.artifact_name,
                            summary=output.summary,
                            quality_score=output.quality_score,
                            quality_notes=output.quality_notes,
                        )
                    elif output.status == "skipped":
                        proj_mgr.skip_step(step_result, output.summary)
                    else:
                        proj_mgr.fail_step(step_result, output.error or "Unknown error")

                # Update project status
                all_done = all(r.is_success for r in results.values())
                proj_mgr.update_status(
                    project,
                    "complete" if all_done else "paused" if orchestrator.paused_at else "error",
                )
                if all_done:
                    proj_mgr.complete_run(run)

        # Print cost summary
        summary = cost_tracker.summary()
        if summary.get("total", 0) > 0:
            console.print(f"\n[dim]Estimated cost: ${summary['total']:.4f}[/dim]")

        # Run production pipeline if pre-production completed fully
        all_preprod_done = all(
            r.is_success for r in results.values()
        ) and not orchestrator.paused_at

        if all_preprod_done and not step_range:
            console.print("\n[bold cyan]── Production Pipeline ──[/bold cyan]")
            production_results = await self._run_production(
                project_slug=project_slug,
                output_dir=output_dir,
                artifacts=orchestrator.artifacts,
                profile_dict=profile_dict,
                cost_tracker=cost_tracker,
                rate_limiter=rate_limiter,
            )
            prod_ok = sum(1 for r in production_results if r.status == "complete")
            prod_err = sum(1 for r in production_results if r.status == "error")
            console.print(f"\n[bold]Production:[/bold] {prod_ok} complete, {prod_err} errors")

        return results

    async def _run_production(
        self,
        project_slug: str,
        output_dir: Path,
        artifacts: dict[int, Any],
        profile_dict: dict[str, Any],
        cost_tracker: CostTracker,
        rate_limiter: RateLimiter,
    ) -> list:
        """Run the P1-P7 production pipeline after pre-production."""
        from mindarchive.production.orchestrator import ProductionOrchestrator

        def on_prod_event(step_id: str, status: str, data: dict[str, Any]) -> None:
            msg = data.get("message", "")
            if status == "start":
                console.print(f"\n[cyan]▶ {step_id}: {msg}[/cyan]")
            elif status == "complete":
                console.print(f"[green]  ✓ {msg}[/green]")
            elif status == "error":
                console.print(f"[red]  ✗ {step_id} error: {data.get('error', msg)}[/red]")
            elif status == "skip":
                console.print(f"[dim]  ⊘ {msg}[/dim]")

        prod_orch = ProductionOrchestrator(
            settings=self._settings,
            cost_tracker=cost_tracker,
            rate_limiter=rate_limiter,
            event_callback=on_prod_event,
        )

        ctx = prod_orch.build_context(
            project_slug=project_slug,
            output_dir=output_dir,
            preproduction_artifacts=artifacts,
            profile_data=profile_dict,
        )

        return await prod_orch.run(ctx)


def _cli_event_handler(event: PipelineEvent, console: Console) -> None:
    """Handle pipeline events for CLI output."""
    if event.event_type == "step_start":
        console.print(f"\n[cyan]▶ Step {event.step_number}: {event.step_name}[/cyan]")
    elif event.event_type == "step_complete":
        summary = event.data.get("summary", "")
        score = event.data.get("quality_score")
        score_str = f" (quality: {score:.0%})" if score is not None else ""
        console.print(f"[green]  ✓ {summary}{score_str}[/green]")
    elif event.event_type == "step_skip":
        console.print(f"[dim]  ⊘ {event.message}[/dim]")
    elif event.event_type == "step_error":
        console.print(f"[red]  ✗ {event.message}[/red]")
    elif event.event_type == "gate_pause":
        console.print(Panel(
            f"Step {event.step_number}: {event.step_name}\n"
            f"{event.data.get('summary', '')}\n\n"
            "Resume with: [bold]mindarchive resume <project-slug> --approve[/bold]",
            title="[yellow]⏸ GATE PAUSE[/yellow]",
            border_style="yellow",
        ))
    elif event.event_type == "run_complete":
        console.print(Panel(
            event.message,
            title="[green]Pipeline Complete[/green]",
            border_style="green",
        ))
    elif event.event_type == "cost_update":
        console.print(f"[yellow]  ⚠ {event.message}[/yellow]")


def _profile_to_dict(profile: ProfileData) -> dict[str, Any]:
    """Convert ProfileData to dict for template rendering."""
    return asdict(profile)


def _preset_to_dict(preset: FormatPresetData) -> dict[str, Any]:
    """Convert FormatPresetData to dict for template rendering."""
    return asdict(preset)
