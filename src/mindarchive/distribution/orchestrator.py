"""Distribution orchestrator — runs D1-D5 after production completes.

Distribution Steps:
  D1: YouTube Upload (video + thumbnail + metadata)
  D2: Google Drive Backup (full project archive)
  D3: Vizard Repurposing (Shorts/clips with subtitles)
  D4: Buffer Social Scheduling (promotional posts)
  D5: Post-launch tracking (status check + analytics bookmark)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from mindarchive.config.settings import AppSettings, CredentialStore

logger = logging.getLogger(__name__)

DistributionEventCallback = Callable[[str, str, dict[str, Any]], Any]


@dataclass
class DistributionContext:
    """Everything the distribution pipeline needs."""

    project_slug: str
    project_dir: Path

    # From pre-production (Step 13: Upload Blueprint)
    upload_blueprint: dict[str, Any] = field(default_factory=dict)

    # Video assets
    final_video_path: Path | None = None
    thumbnail_path: Path | None = None

    # Metadata from pre-production
    video_title: str = ""
    video_description: str = ""
    video_tags: list[str] = field(default_factory=list)
    video_category: str = "education"
    hashtags: list[str] = field(default_factory=list)

    # Schedule
    scheduled_publish_at: str | None = None
    privacy: str = "private"

    # Profile settings
    profile_slug: str = ""
    notification_config: dict[str, Any] = field(default_factory=dict)

    # Results (populated by each step)
    youtube_video_id: str = ""
    youtube_url: str = ""
    drive_folder_id: str = ""
    vizard_project_id: str = ""
    vizard_clips: list[dict[str, Any]] = field(default_factory=list)
    buffer_posts: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class DistributionStepResult:
    """Result of a distribution step."""

    step_id: str
    status: str  # complete, error, skip
    message: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class DistributionOrchestrator:
    """Runs distribution steps D1-D5 sequentially after production."""

    def __init__(
        self,
        settings: AppSettings,
        event_callback: DistributionEventCallback | None = None,
    ) -> None:
        self._settings = settings
        self._event_cb = event_callback
        self._cred_store = CredentialStore(settings.credentials_path)

    async def run(
        self,
        ctx: DistributionContext,
        skip_steps: set[str] | None = None,
    ) -> list[DistributionStepResult]:
        """Run the full distribution pipeline D1-D5.

        Args:
            ctx: Distribution context with production artifacts.
            skip_steps: Optional set of step IDs to skip.

        Returns:
            List of DistributionStepResult for each step.
        """
        skip = skip_steps or set()
        results: list[DistributionStepResult] = []

        # ─── D1: YouTube Upload ───
        if "D1" not in skip:
            r = await self._d1_youtube_upload(ctx)
            results.append(r)
        else:
            self._emit("D1", "skip", {"message": "YouTube upload skipped"})

        # ─── D2: Google Drive Backup ───
        if "D2" not in skip:
            r = await self._d2_gdrive_backup(ctx)
            results.append(r)
        else:
            self._emit("D2", "skip", {"message": "Drive backup skipped"})

        # ─── D3: Vizard Repurposing ───
        if "D3" not in skip:
            r = await self._d3_vizard_repurpose(ctx)
            results.append(r)
        else:
            self._emit("D3", "skip", {"message": "Vizard repurposing skipped"})

        # ─── D4: Buffer Social Scheduling ───
        if "D4" not in skip:
            r = await self._d4_buffer_schedule(ctx)
            results.append(r)
        else:
            self._emit("D4", "skip", {"message": "Buffer scheduling skipped"})

        # ─── D5: Post-launch Status ───
        if "D5" not in skip:
            r = await self._d5_post_launch_check(ctx)
            results.append(r)
        else:
            self._emit("D5", "skip", {"message": "Post-launch check skipped"})

        # Summary
        completed = sum(1 for r in results if r.status == "complete")
        errors = sum(1 for r in results if r.status == "error")
        skipped = sum(1 for r in results if r.status == "skip")

        self._emit("distribution_complete", "complete", {
            "completed": completed,
            "errors": errors,
            "skipped": skipped,
            "youtube_url": ctx.youtube_url,
            "vizard_clips": len(ctx.vizard_clips),
            "buffer_posts": len(ctx.buffer_posts),
        })

        return results

    # ─── D1: YouTube Upload ───

    async def _d1_youtube_upload(self, ctx: DistributionContext) -> DistributionStepResult:
        """Upload video to YouTube with metadata and thumbnail."""
        self._emit("D1", "start", {"message": "Uploading to YouTube..."})

        youtube_oauth = self._settings.youtube_oauth_path
        if not youtube_oauth:
            return DistributionStepResult(
                step_id="D1", status="skip",
                message="YouTube OAuth not configured",
            )

        if not ctx.final_video_path or not ctx.final_video_path.exists():
            return DistributionStepResult(
                step_id="D1", status="error",
                error="Final video file not found",
            )

        try:
            from mindarchive.distribution.youtube_uploader import YouTubeUploader

            uploader = YouTubeUploader(Path(youtube_oauth))

            result = await uploader.upload_video(
                video_path=ctx.final_video_path,
                title=ctx.video_title or ctx.project_slug,
                description=ctx.video_description,
                tags=ctx.video_tags,
                category=ctx.video_category,
                privacy=ctx.privacy,
                scheduled_publish_at=ctx.scheduled_publish_at,
            )

            ctx.youtube_video_id = result["video_id"]
            ctx.youtube_url = result["url"]

            # Set custom thumbnail
            if ctx.thumbnail_path and ctx.thumbnail_path.exists() and ctx.youtube_video_id:
                await uploader.set_thumbnail(ctx.youtube_video_id, ctx.thumbnail_path)

            self._emit("D1", "complete", {
                "message": f"Uploaded: {ctx.youtube_url}",
                "video_id": ctx.youtube_video_id,
            })

            return DistributionStepResult(
                step_id="D1", status="complete",
                message=f"YouTube upload: {ctx.youtube_url}",
                data=result,
            )

        except Exception as e:
            logger.error("YouTube upload failed: %s", e)
            self._emit("D1", "error", {"message": str(e)})
            return DistributionStepResult(
                step_id="D1", status="error", error=str(e),
            )

    # ─── D2: Google Drive Backup ───

    async def _d2_gdrive_backup(self, ctx: DistributionContext) -> DistributionStepResult:
        """Backup full project to Google Drive."""
        self._emit("D2", "start", {"message": "Backing up to Google Drive..."})

        gdrive_oauth = self._settings.gdrive_oauth_path
        if not gdrive_oauth:
            return DistributionStepResult(
                step_id="D2", status="skip",
                message="Google Drive OAuth not configured",
            )

        try:
            from mindarchive.distribution.gdrive_backup import GoogleDriveBackup

            backup = GoogleDriveBackup(Path(gdrive_oauth))
            result = await backup.backup_project(
                project_dir=ctx.project_dir,
                project_slug=ctx.project_slug,
            )

            ctx.drive_folder_id = result.get("drive_folder_id", "")

            self._emit("D2", "complete", {
                "message": f"Backed up {result['files_uploaded']} files",
                "drive_folder_id": ctx.drive_folder_id,
            })

            return DistributionStepResult(
                step_id="D2", status="complete",
                message=f"Drive backup: {result['files_uploaded']} files, {result['total_bytes'] / 1_000_000:.1f} MB",
                data=result,
            )

        except Exception as e:
            logger.error("Drive backup failed: %s", e)
            self._emit("D2", "error", {"message": str(e)})
            return DistributionStepResult(
                step_id="D2", status="error", error=str(e),
            )

    # ─── D3: Vizard Repurposing ───

    async def _d3_vizard_repurpose(self, ctx: DistributionContext) -> DistributionStepResult:
        """Repurpose video into Shorts/clips via Vizard."""
        self._emit("D3", "start", {"message": "Creating Shorts with Vizard..."})

        vizard_key = self._cred_store.get("VIZARD_API_KEY") or self._settings.vizard_api_key
        if not vizard_key:
            return DistributionStepResult(
                step_id="D3", status="skip",
                message="Vizard API key not configured",
            )

        try:
            from mindarchive.distribution.vizard_repurpose import VizardRepurposer

            vizard = VizardRepurposer(api_key=vizard_key)
            clips_dir = ctx.project_dir / "shorts"

            # Prefer YouTube URL if uploaded, otherwise local file
            result = await vizard.repurpose_video(
                video_url=ctx.youtube_url if ctx.youtube_url else None,
                video_path=ctx.final_video_path if not ctx.youtube_url else None,
                video_title=ctx.video_title or ctx.project_slug,
                output_dir=clips_dir,
            )

            ctx.vizard_project_id = result.get("project_id", "")
            ctx.vizard_clips = result.get("clips", [])

            self._emit("D3", "complete", {
                "message": f"Generated {result['clip_count']} clips/Shorts",
                "clip_count": result["clip_count"],
            })

            return DistributionStepResult(
                step_id="D3", status="complete",
                message=f"Vizard: {result['clip_count']} Shorts generated",
                data=result,
            )

        except Exception as e:
            logger.error("Vizard repurposing failed: %s", e)
            self._emit("D3", "error", {"message": str(e)})
            return DistributionStepResult(
                step_id="D3", status="error", error=str(e),
            )

    # ─── D4: Buffer Social Scheduling ───

    async def _d4_buffer_schedule(self, ctx: DistributionContext) -> DistributionStepResult:
        """Schedule promotional posts via Buffer."""
        self._emit("D4", "start", {"message": "Scheduling social posts..."})

        buffer_key = self._cred_store.get("BUFFER_API_KEY") or self._settings.buffer_api_key
        if not buffer_key:
            return DistributionStepResult(
                step_id="D4", status="skip",
                message="Buffer API key not configured",
            )

        if not ctx.youtube_url:
            return DistributionStepResult(
                step_id="D4", status="skip",
                message="No YouTube URL — skipping social scheduling",
            )

        try:
            from mindarchive.distribution.buffer_scheduler import BufferScheduler

            buffer = BufferScheduler(api_key=buffer_key)

            results = await buffer.schedule_video_promotion(
                video_url=ctx.youtube_url,
                video_title=ctx.video_title or ctx.project_slug,
                description=ctx.video_description[:200] if ctx.video_description else "",
                hashtags=ctx.hashtags,
                post_count=3,
                interval_hours=24,
            )

            ctx.buffer_posts = results
            successful = sum(1 for r in results if r.get("success"))

            self._emit("D4", "complete", {
                "message": f"Scheduled {successful}/{len(results)} posts",
                "posts": len(results),
            })

            return DistributionStepResult(
                step_id="D4", status="complete",
                message=f"Buffer: {successful} posts scheduled",
                data={"posts": results},
            )

        except Exception as e:
            logger.error("Buffer scheduling failed: %s", e)
            self._emit("D4", "error", {"message": str(e)})
            return DistributionStepResult(
                step_id="D4", status="error", error=str(e),
            )

    # ─── D5: Post-launch Status Check ───

    async def _d5_post_launch_check(self, ctx: DistributionContext) -> DistributionStepResult:
        """Post-launch status check and summary."""
        self._emit("D5", "start", {"message": "Running post-launch check..."})

        summary: dict[str, Any] = {
            "project_slug": ctx.project_slug,
            "youtube_url": ctx.youtube_url or "not uploaded",
            "youtube_video_id": ctx.youtube_video_id or "n/a",
            "drive_folder_id": ctx.drive_folder_id or "not backed up",
            "vizard_clips": len(ctx.vizard_clips),
            "buffer_posts": len(ctx.buffer_posts),
        }

        # Check YouTube processing status if uploaded
        if ctx.youtube_video_id and self._settings.youtube_oauth_path:
            try:
                from mindarchive.distribution.youtube_uploader import YouTubeUploader

                uploader = YouTubeUploader(Path(self._settings.youtube_oauth_path))
                yt_status = await uploader.get_video_status(ctx.youtube_video_id)
                summary["youtube_processing"] = yt_status.get("upload_status", "unknown")
            except Exception as e:
                summary["youtube_processing"] = f"check failed: {e}"

        # Write distribution summary to project metadata
        summary_path = ctx.project_dir / "metadata" / "distribution_summary.json"
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2))

        msg_parts = []
        if ctx.youtube_url:
            msg_parts.append(f"YouTube: {ctx.youtube_url}")
        if ctx.drive_folder_id:
            msg_parts.append("Drive: backed up")
        if ctx.vizard_clips:
            msg_parts.append(f"Shorts: {len(ctx.vizard_clips)}")
        if ctx.buffer_posts:
            msg_parts.append(f"Social: {len(ctx.buffer_posts)} posts")

        message = " | ".join(msg_parts) or "No distribution actions taken"

        self._emit("D5", "complete", {"message": message, "summary": summary})

        return DistributionStepResult(
            step_id="D5", status="complete",
            message=message,
            data=summary,
        )

    # ─── Context Builder ───

    def build_context(
        self,
        project_slug: str,
        project_dir: Path,
        preproduction_artifacts: dict[int, Any],
        production_ctx: Any = None,
        profile_data: dict[str, Any] | None = None,
    ) -> DistributionContext:
        """Build a DistributionContext from pre-production + production results.

        Args:
            project_slug: Project identifier.
            project_dir: Project output directory.
            preproduction_artifacts: Dict of step_number → artifact.
            production_ctx: ProductionContext from Phase C (optional).
            profile_data: Channel profile settings.

        Returns:
            Configured DistributionContext.
        """
        profile = profile_data or {}

        # Extract Upload Blueprint (Step 13)
        blueprint: dict[str, Any] = {}
        if 13 in preproduction_artifacts:
            bp = preproduction_artifacts[13]
            blueprint = bp if isinstance(bp, dict) else {}

        # Extract video metadata from blueprint or script metadata
        title = blueprint.get("title", "")
        description = blueprint.get("description", "")
        tags = blueprint.get("tags", [])
        category = blueprint.get("category", profile.get("default_category", "education"))

        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

        # Get final video and thumbnail paths from production
        final_video: Path | None = None
        thumbnail: Path | None = None

        if production_ctx:
            if hasattr(production_ctx, "final_video_path") and production_ctx.final_video_path:
                final_video = production_ctx.final_video_path
            if hasattr(production_ctx, "thumbnail_path") and production_ctx.thumbnail_path:
                thumbnail = production_ctx.thumbnail_path

        # Fall back to expected paths
        if not final_video:
            expected = project_dir / "video" / f"{project_slug}_final.mp4"
            if expected.exists():
                final_video = expected

        if not thumbnail:
            expected = project_dir / "thumbnails" / "thumbnail.jpg"
            if expected.exists():
                thumbnail = expected

        return DistributionContext(
            project_slug=project_slug,
            project_dir=project_dir,
            upload_blueprint=blueprint,
            final_video_path=final_video,
            thumbnail_path=thumbnail,
            video_title=title,
            video_description=description,
            video_tags=tags,
            video_category=category,
            hashtags=blueprint.get("hashtags", []),
            scheduled_publish_at=blueprint.get("scheduled_publish_at"),
            privacy=blueprint.get("privacy", "private"),
            profile_slug=profile.get("slug", ""),
            notification_config=profile.get("notification_config", {}),
        )

    def _emit(self, step_id: str, status: str, data: dict[str, Any]) -> None:
        logger.info("[%s] %s: %s", step_id, status, data.get("message", ""))
        if self._event_cb:
            self._event_cb(step_id, status, data)
