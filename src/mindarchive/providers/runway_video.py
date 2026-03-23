"""Runway Gen-3 video provider — generates hero motion scenes via API."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import httpx

from mindarchive.providers.base import VideoSettings
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Runway API base URL
RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1"

# Cost per generation (~105 credits for 10s, ~5 credits per second)
CREDITS_PER_SECOND = 5
COST_PER_CREDIT = 0.01


class RunwayVideoProvider:
    """Runway Gen-3 Alpha video generation implementing the VideoProvider protocol."""

    def __init__(
        self,
        api_key: str,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        self._api_key = api_key
        self._rate_limiter = rate_limiter

    def provider_name(self) -> str:
        return "runway"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "X-Runway-Version": "2024-11-06",
        }

    async def generate_video(
        self,
        prompt: str,
        settings: VideoSettings,
        output_path: Path,
        reference_image_path: Path | None = None,
    ) -> Path:
        """Generate a video clip from a text prompt (and optional reference image).

        Args:
            prompt: Motion description for the scene.
            settings: Video generation settings (duration, resolution).
            output_path: Where to save the generated MP4.
            reference_image_path: Optional DALL-E image as first-frame reference.

        Returns:
            Path to the generated video.
        """
        if self._rate_limiter:
            await self._rate_limiter.acquire("runway")

        logger.info(
            "Runway generation: duration=%ds, prompt=%s...",
            settings.duration_seconds,
            prompt[:80],
        )

        # Build request payload
        payload: dict[str, Any] = {
            "promptText": prompt,
            "model": "gen3a_turbo",
            "duration": min(settings.duration_seconds, 10),
            "ratio": "16:9" if settings.resolution == "1080p" else "16:9",
        }

        # If we have a reference image, use image-to-video
        if reference_image_path and reference_image_path.exists():
            import base64

            image_data = reference_image_path.read_bytes()
            b64 = base64.b64encode(image_data).decode()
            mime = "image/png" if reference_image_path.suffix == ".png" else "image/jpeg"
            payload["promptImage"] = f"data:{mime};base64,{b64}"

        # Submit generation task
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUNWAY_API_BASE}/image_to_video",
                headers=self._headers(),
                json=payload,
                timeout=30.0,
            )
            response.raise_for_status()
            task = response.json()

        task_id = task.get("id")
        if not task_id:
            raise ValueError(f"Runway did not return a task ID: {task}")

        logger.info("Runway task submitted: %s", task_id)

        # Poll for completion
        video_url = await self._poll_task(task_id)

        # Download the video
        output_path.parent.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", video_url, timeout=120.0) as resp:
                resp.raise_for_status()
                with open(output_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)

        file_size = output_path.stat().st_size
        logger.info("Runway video saved: %s (%d bytes)", output_path, file_size)
        return output_path

    async def _poll_task(
        self,
        task_id: str,
        max_wait: int = 300,
        poll_interval: int = 5,
    ) -> str:
        """Poll Runway API until the task completes. Returns the video URL."""
        elapsed = 0
        async with httpx.AsyncClient() as client:
            while elapsed < max_wait:
                response = await client.get(
                    f"{RUNWAY_API_BASE}/tasks/{task_id}",
                    headers=self._headers(),
                    timeout=15.0,
                )
                response.raise_for_status()
                data = response.json()

                status = data.get("status")
                if status == "SUCCEEDED":
                    output = data.get("output", [])
                    if output:
                        return output[0]
                    raise ValueError(f"Runway task succeeded but no output URL: {data}")
                elif status == "FAILED":
                    failure = data.get("failure", "Unknown error")
                    raise RuntimeError(f"Runway generation failed: {failure}")

                logger.debug("Runway task %s: %s (elapsed=%ds)", task_id, status, elapsed)
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

        raise TimeoutError(f"Runway task {task_id} did not complete within {max_wait}s")

    async def generate_hero_scenes(
        self,
        scenes: list[dict[str, Any]],
        settings: VideoSettings,
        output_dir: Path,
        reference_images: dict[int, Path] | None = None,
    ) -> list[dict[str, Any]]:
        """Generate video for all RUNWAY-tagged scenes.

        Args:
            scenes: List of dicts with 'scene_id' and 'prompt'.
            settings: Video generation settings.
            output_dir: Directory to save generated videos.
            reference_images: Optional mapping of scene_id → DALL-E image path.

        Returns:
            List of result dicts with 'scene_id', 'path', 'status'.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict[str, Any]] = []

        for scene in scenes:
            scene_id = scene.get("scene_id", len(results))
            prompt = scene.get("prompt", "")
            output_path = output_dir / f"runway_scene_{scene_id:03d}.mp4"
            ref_image = reference_images.get(scene_id) if reference_images else None

            try:
                path = await self.generate_video(prompt, settings, output_path, ref_image)
                results.append({
                    "scene_id": scene_id,
                    "path": str(path),
                    "status": "generated",
                })
            except Exception as e:
                logger.error("Runway scene %d failed: %s", scene_id, e)
                results.append({
                    "scene_id": scene_id,
                    "path": None,
                    "status": "error",
                    "error": str(e),
                })

        return results

    async def estimate_cost(self, count: int = 1, duration_seconds: int = 5) -> float:
        """Estimate cost for generating N video clips."""
        credits = count * duration_seconds * CREDITS_PER_SECOND
        return credits * COST_PER_CREDIT

    async def check_credits(self) -> float:
        """Check remaining Runway credits (returns credit balance)."""
        # Runway API doesn't have a standard credits endpoint yet
        # This is a placeholder that returns -1 indicating unknown
        logger.warning("Runway credit check not yet available via API")
        return -1.0
