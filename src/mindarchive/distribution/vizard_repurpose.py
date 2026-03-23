"""Vizard repurposer — generates Shorts/clips and adds subtitles via Vizard API."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

VIZARD_API_BASE = "https://elb.vizard.ai/hvizard-server-front"


class VizardRepurposer:
    """Repurposes long-form videos into Shorts/clips with subtitles via Vizard AI.

    Vizard automatically:
    - Detects key moments for Shorts
    - Adds animated subtitles
    - Crops to vertical (9:16) for Shorts
    - Generates multiple clip variants
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {
            "VIZARDAI_API_KEY": self._api_key,
            "Content-Type": "application/json",
        }

    async def create_project_from_url(
        self,
        video_url: str,
        video_title: str,
        language: str = "en",
        preferred_clip_duration: str = "30-60",
    ) -> dict[str, Any]:
        """Create a Vizard project from a YouTube URL.

        Args:
            video_url: YouTube video URL.
            video_title: Title for the Vizard project.
            language: Language code for subtitle generation.
            preferred_clip_duration: Clip length preference: "15-30", "30-60", "60-90".

        Returns:
            Dict with 'project_id', 'status'.
        """
        payload = {
            "videoUrl": video_url,
            "projectName": video_title,
            "lang": language,
            "preferredClipDuration": preferred_clip_duration,
        }

        logger.info("Creating Vizard project: %s", video_title)

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{VIZARD_API_BASE}/v2/project/create",
                headers=self._headers(),
                json=payload,
                timeout=30.0,
            )
            response.raise_for_status()

        data = response.json()
        if data.get("code") != 200:
            raise RuntimeError(f"Vizard API error: {data.get('message', 'Unknown error')}")

        project_data = data.get("data", {})
        project_id = project_data.get("projectId", "")

        logger.info("Vizard project created: %s", project_id)

        return {
            "project_id": project_id,
            "status": "processing",
        }

    async def create_project_from_file(
        self,
        video_path: Path,
        video_title: str,
        language: str = "en",
        preferred_clip_duration: str = "30-60",
    ) -> dict[str, Any]:
        """Create a Vizard project by uploading a video file.

        Args:
            video_path: Path to the MP4 file.
            video_title: Title for the Vizard project.
            language: Language code.
            preferred_clip_duration: Clip length preference.

        Returns:
            Dict with 'project_id', 'status'.
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # Step 1: Get upload URL
        file_size = video_path.stat().st_size
        async with httpx.AsyncClient() as client:
            init_resp = await client.post(
                f"{VIZARD_API_BASE}/v2/project/upload/init",
                headers=self._headers(),
                json={
                    "fileName": video_path.name,
                    "fileSize": file_size,
                    "projectName": video_title,
                    "lang": language,
                    "preferredClipDuration": preferred_clip_duration,
                },
                timeout=15.0,
            )
            init_resp.raise_for_status()

        init_data = init_resp.json()
        if init_data.get("code") != 200:
            raise RuntimeError(f"Vizard upload init error: {init_data.get('message')}")

        upload_info = init_data.get("data", {})
        upload_url = upload_info.get("uploadUrl", "")
        project_id = upload_info.get("projectId", "")

        if not upload_url:
            raise RuntimeError("Vizard did not return upload URL")

        # Step 2: Upload video
        logger.info("Uploading to Vizard: %s (%.1f MB)", video_path.name, file_size / 1_000_000)

        async with httpx.AsyncClient() as client:
            with open(video_path, "rb") as f:
                upload_resp = await client.put(
                    upload_url,
                    content=f.read(),
                    headers={"Content-Type": "video/mp4"},
                    timeout=600.0,
                )
                upload_resp.raise_for_status()

        logger.info("Vizard upload complete: project=%s", project_id)

        return {
            "project_id": project_id,
            "status": "processing",
        }

    async def get_project_status(self, project_id: str) -> dict[str, Any]:
        """Check the processing status of a Vizard project.

        Returns:
            Dict with 'status', 'clips' (if complete), 'progress'.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{VIZARD_API_BASE}/v2/project/{project_id}",
                headers=self._headers(),
                timeout=15.0,
            )
            response.raise_for_status()

        data = response.json()
        if data.get("code") != 200:
            return {"project_id": project_id, "status": "error", "message": data.get("message")}

        project = data.get("data", {})
        status = project.get("status", "unknown")
        clips: list[dict[str, Any]] = []

        if status == "DONE":
            for clip in project.get("clips", []):
                clips.append({
                    "clip_id": clip.get("clipId", ""),
                    "title": clip.get("title", ""),
                    "duration": clip.get("duration", 0),
                    "download_url": clip.get("downloadUrl", ""),
                    "thumbnail_url": clip.get("thumbnailUrl", ""),
                    "start_time": clip.get("startTime", 0),
                    "end_time": clip.get("endTime", 0),
                })

        return {
            "project_id": project_id,
            "status": status.lower(),
            "progress": project.get("progress", 0),
            "clips": clips,
        }

    async def wait_for_completion(
        self,
        project_id: str,
        max_wait: int = 600,
        poll_interval: int = 15,
    ) -> dict[str, Any]:
        """Poll until Vizard processing completes.

        Args:
            project_id: Vizard project ID.
            max_wait: Maximum wait time in seconds.
            poll_interval: Time between polls in seconds.

        Returns:
            Final project status with clips.
        """
        elapsed = 0
        while elapsed < max_wait:
            status = await self.get_project_status(project_id)

            if status["status"] == "done":
                logger.info(
                    "Vizard complete: %d clips generated",
                    len(status.get("clips", [])),
                )
                return status
            elif status["status"] == "error":
                raise RuntimeError(f"Vizard processing failed: {status.get('message')}")

            progress = status.get("progress", 0)
            logger.debug("Vizard %s: %d%% (elapsed=%ds)", project_id, progress, elapsed)

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"Vizard project {project_id} did not complete within {max_wait}s")

    async def download_clips(
        self,
        clips: list[dict[str, Any]],
        output_dir: Path,
    ) -> list[dict[str, Any]]:
        """Download generated clips to local directory.

        Args:
            clips: List of clip dicts from get_project_status.
            output_dir: Where to save the downloaded clips.

        Returns:
            List of dicts with 'clip_id', 'path', 'title'.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        downloads: list[dict[str, Any]] = []

        for clip in clips:
            url = clip.get("download_url", "")
            if not url:
                continue

            clip_id = clip.get("clip_id", f"clip_{len(downloads)}")
            output_path = output_dir / f"{clip_id}.mp4"

            logger.info("Downloading Vizard clip: %s", clip_id)

            async with httpx.AsyncClient() as client:
                async with client.stream("GET", url, timeout=120.0) as response:
                    response.raise_for_status()
                    with open(output_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            f.write(chunk)

            downloads.append({
                "clip_id": clip_id,
                "path": str(output_path),
                "title": clip.get("title", ""),
                "duration": clip.get("duration", 0),
            })

        logger.info("Downloaded %d Vizard clips to %s", len(downloads), output_dir)
        return downloads

    async def repurpose_video(
        self,
        video_url: str | None = None,
        video_path: Path | None = None,
        video_title: str = "Untitled",
        output_dir: Path | None = None,
        language: str = "en",
        clip_duration: str = "30-60",
    ) -> dict[str, Any]:
        """Full repurposing workflow: create project → wait → download clips.

        Provide either video_url (YouTube) or video_path (local file).

        Returns:
            Dict with 'project_id', 'clips' (with local paths), 'clip_count'.
        """
        # Create project
        if video_url:
            project = await self.create_project_from_url(
                video_url, video_title, language, clip_duration
            )
        elif video_path:
            project = await self.create_project_from_file(
                video_path, video_title, language, clip_duration
            )
        else:
            raise ValueError("Must provide either video_url or video_path")

        project_id = project["project_id"]

        # Wait for processing
        result = await self.wait_for_completion(project_id)

        # Download clips if output_dir provided
        clips = result.get("clips", [])
        downloaded: list[dict[str, Any]] = []

        if output_dir and clips:
            downloaded = await self.download_clips(clips, output_dir)

        return {
            "project_id": project_id,
            "clips": downloaded or clips,
            "clip_count": len(clips),
        }
