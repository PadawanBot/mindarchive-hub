"""Production orchestrator — runs P1-P7 after pre-production completes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from mindarchive.config.settings import AppSettings, CredentialStore
from mindarchive.production.steps import (
    ProductionContext,
    ProductionStepResult,
    p1_generate_voiceover,
    p2_generate_images,
    p3_download_stock,
    p4_generate_runway,
    p5_ken_burns_animation,
    p6_motion_graphics,
    p7_final_assembly,
)
from mindarchive.services.cost_tracker import CostTracker
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

ProductionEventCallback = Callable[[str, str, dict[str, Any]], Any]


class ProductionOrchestrator:
    """Runs production steps P1-P7 sequentially.

    Requires pre-production artifacts (final script, scenes.json, etc.)
    and API credentials for ElevenLabs, OpenAI, Pexels, and Runway.
    """

    def __init__(
        self,
        settings: AppSettings,
        cost_tracker: CostTracker | None = None,
        rate_limiter: RateLimiter | None = None,
        event_callback: ProductionEventCallback | None = None,
    ) -> None:
        self._settings = settings
        self._cost = cost_tracker or CostTracker()
        self._rate_limiter = rate_limiter or RateLimiter()
        self._event_cb = event_callback
        self._cred_store = CredentialStore(settings.credentials_path)

    async def run(
        self,
        ctx: ProductionContext,
        skip_steps: set[str] | None = None,
    ) -> list[ProductionStepResult]:
        """Run the full production pipeline P1-P7.

        Args:
            ctx: Production context with pre-production artifacts.
            skip_steps: Optional set of step IDs to skip (e.g. {"P4"} to skip Runway).

        Returns:
            List of ProductionStepResult for each step.
        """
        skip = skip_steps or set()
        results: list[ProductionStepResult] = []

        # ─── P1: Voiceover ───
        if "P1" not in skip:
            self._emit("P1", "start", {"message": "Generating voiceover..."})
            voice = self._get_voice_provider()
            if voice:
                r = await p1_generate_voiceover(ctx, voice)
                results.append(r)
                self._track_cost(r)
                self._emit("P1", r.status, {"message": r.message})
            else:
                results.append(ProductionStepResult(
                    step_id="P1", status="error",
                    error="ElevenLabs API key not configured",
                ))
        else:
            self._emit("P1", "skip", {"message": "Voiceover skipped"})

        # ─── P2: DALL-E Images ───
        if "P2" not in skip:
            self._emit("P2", "start", {"message": "Generating scene images..."})
            dalle = self._get_image_provider()
            if dalle:
                r = await p2_generate_images(ctx, dalle)
                results.append(r)
                self._track_cost(r)
                self._emit("P2", r.status, {"message": r.message})
            else:
                results.append(ProductionStepResult(
                    step_id="P2", status="error",
                    error="OpenAI API key not configured",
                ))
        else:
            self._emit("P2", "skip", {"message": "Image generation skipped"})

        # ─── P3: Stock Footage ───
        if "P3" not in skip:
            self._emit("P3", "start", {"message": "Downloading stock footage..."})
            stock = self._get_stock_provider()
            if stock:
                r = await p3_download_stock(ctx, stock)
                results.append(r)
                self._emit("P3", r.status, {"message": r.message})
            else:
                results.append(ProductionStepResult(
                    step_id="P3", status="error",
                    error="Pexels API key not configured",
                ))
        else:
            self._emit("P3", "skip", {"message": "Stock download skipped"})

        # ─── P4: Runway ───
        if "P4" not in skip:
            runway = self._get_video_provider()
            if runway:
                self._emit("P4", "start", {"message": "Generating hero motion scenes..."})
                r = await p4_generate_runway(ctx, runway)
                results.append(r)
                self._track_cost(r)
                self._emit("P4", r.status, {"message": r.message})
            else:
                logger.info("Runway API key not configured — skipping P4")
                self._emit("P4", "skip", {"message": "Runway not configured"})
        else:
            self._emit("P4", "skip", {"message": "Runway generation skipped"})

        # ─── P5: Ken Burns ───
        if "P5" not in skip:
            self._emit("P5", "start", {"message": "Animating still images..."})
            r = await p5_ken_burns_animation(ctx)
            results.append(r)
            self._emit("P5", r.status, {"message": r.message})
        else:
            self._emit("P5", "skip", {"message": "Ken Burns skipped"})

        # ─── P6: Motion Graphics ───
        if "P6" not in skip:
            self._emit("P6", "start", {"message": "Rendering motion graphics..."})
            r = await p6_motion_graphics(ctx)
            results.append(r)
            self._emit("P6", r.status, {"message": r.message})
        else:
            self._emit("P6", "skip", {"message": "Motion graphics skipped"})

        # ─── P7: Final Assembly ───
        if "P7" not in skip:
            self._emit("P7", "start", {"message": "Assembling final video..."})
            r = await p7_final_assembly(ctx)
            results.append(r)
            self._emit("P7", r.status, {"message": r.message})
        else:
            self._emit("P7", "skip", {"message": "Assembly skipped"})

        # Summary
        total_cost = sum(r.cost_usd for r in results)
        completed = sum(1 for r in results if r.status == "complete")
        errors = sum(1 for r in results if r.status == "error")

        self._emit("production_complete", "complete", {
            "total_cost": total_cost,
            "completed": completed,
            "errors": errors,
            "final_video": str(ctx.final_video_path) if ctx.final_video_path else None,
        })

        return results

    def build_context(
        self,
        project_slug: str,
        output_dir: Path,
        preproduction_artifacts: dict[int, Any],
        profile_data: dict[str, Any],
    ) -> ProductionContext:
        """Build a ProductionContext from pre-production results.

        Args:
            project_slug: The project identifier.
            output_dir: Project output directory.
            preproduction_artifacts: Dict of step_number → artifact content/data.
            profile_data: Channel profile settings.

        Returns:
            Configured ProductionContext.
        """
        final_script = ""
        # Prefer Step 8 (edited script), fall back to Step 2 (draft)
        if 8 in preproduction_artifacts:
            final_script = _to_str(preproduction_artifacts[8])
        elif 2 in preproduction_artifacts:
            final_script = _to_str(preproduction_artifacts[2])

        scenes_json = None
        if 5 in preproduction_artifacts:
            s = preproduction_artifacts[5]
            scenes_json = s if isinstance(s, dict) else None

        timing_table = _to_str(preproduction_artifacts.get(9, ""))
        blend_plan = _to_str(preproduction_artifacts.get(6, ""))
        thumbnail_concepts = _to_str(preproduction_artifacts.get(10, ""))

        brand_intro = None
        if profile_data.get("brand_intro_path"):
            p = Path(profile_data["brand_intro_path"])
            if p.exists():
                brand_intro = p

        return ProductionContext(
            project_slug=project_slug,
            output_dir=output_dir,
            final_script=final_script,
            scenes_json=scenes_json,
            timing_table=timing_table,
            blend_plan=blend_plan,
            thumbnail_concepts=thumbnail_concepts,
            voice_settings={
                k: v for k, v in profile_data.items()
                if k.startswith("voice_") and v is not None
            },
            dalle_style_suffix=profile_data.get(
                "dalle_style_suffix",
                "cinematic, photorealistic, 4K documentary style, no text in frame",
            ),
            runway_max_scenes=profile_data.get("runway_max_scenes", 4),
            brand_intro_path=brand_intro,
        )

    # ─── Provider factories ───

    def _get_voice_provider(self) -> Any:
        from mindarchive.providers.elevenlabs_voice import ElevenLabsVoice

        key = self._cred_store.get("ELEVENLABS_API_KEY") or self._settings.elevenlabs_api_key
        if not key:
            return None
        return ElevenLabsVoice(api_key=key, rate_limiter=self._rate_limiter)

    def _get_image_provider(self) -> Any:
        from mindarchive.providers.openai_dalle import DallEImageProvider

        key = self._cred_store.get("OPENAI_API_KEY") or self._settings.openai_api_key
        if not key:
            return None
        return DallEImageProvider(api_key=key, rate_limiter=self._rate_limiter)

    def _get_stock_provider(self) -> Any:
        from mindarchive.providers.pexels_stock import PexelsStockProvider

        key = self._cred_store.get("PEXELS_API_KEY") or self._settings.pexels_api_key
        if not key:
            return None
        return PexelsStockProvider(api_key=key, rate_limiter=self._rate_limiter)

    def _get_video_provider(self) -> Any:
        from mindarchive.providers.runway_video import RunwayVideoProvider

        key = self._cred_store.get("RUNWAY_API_KEY") or self._settings.runway_api_key
        if not key:
            return None
        return RunwayVideoProvider(api_key=key, rate_limiter=self._rate_limiter)

    def _track_cost(self, result: ProductionStepResult) -> None:
        if result.cost_usd > 0:
            self._cost.log(
                service=result.step_id,
                operation=f"production_{result.step_id}",
                actual_usd=result.cost_usd,
            )

    def _emit(self, step_id: str, status: str, data: dict[str, Any]) -> None:
        logger.info("[%s] %s: %s", step_id, status, data.get("message", ""))
        if self._event_cb:
            self._event_cb(step_id, status, data)


def _to_str(value: Any) -> str:
    """Safely convert an artifact value to string."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        import json
        return json.dumps(value, indent=2)
    return str(value) if value else ""
