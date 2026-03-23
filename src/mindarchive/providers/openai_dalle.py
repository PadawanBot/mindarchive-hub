"""OpenAI DALL-E 3 image provider — generates cinematic scene images."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from mindarchive.config.constants import DALLE_DEFAULT_SIZE, DALLE_QUALITY, DALLE_STYLE
from mindarchive.providers.base import ImageSettings
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# DALL-E 3 pricing
COST_HD_1792 = 0.080
COST_HD_1024 = 0.080
COST_STANDARD = 0.040


class DallEImageProvider:
    """DALL-E 3 image generation implementing the ImageProvider protocol."""

    def __init__(
        self,
        api_key: str,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        self._api_key = api_key
        self._rate_limiter = rate_limiter
        self._client: Any = None

    def provider_name(self) -> str:
        return "openai_dalle"

    def _get_client(self) -> Any:
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=self._api_key)
        return self._client

    async def generate_image(
        self,
        prompt: str,
        settings: ImageSettings,
        output_path: Path,
    ) -> Path:
        """Generate a single image with DALL-E 3.

        CRITICAL: The prompt must NOT contain text/word instructions.
        Text overlays are handled by Pillow in the compositor.

        Args:
            prompt: Visual description (no text instructions).
            settings: Image generation settings.
            output_path: Where to save the PNG file.

        Returns:
            Path to the generated image.
        """
        if self._rate_limiter:
            await self._rate_limiter.acquire("openai_dalle")

        # Append style suffix to maintain visual consistency
        full_prompt = f"{prompt}. {settings.style_suffix}"

        client = self._get_client()

        logger.info("DALL-E generation: size=%s, quality=%s", settings.size, settings.quality)

        response = await client.images.generate(
            model="dall-e-3",
            prompt=full_prompt,
            size=settings.size,
            quality=settings.quality,
            style=settings.style,
            n=1,
        )

        image_url = response.data[0].url
        revised_prompt = response.data[0].revised_prompt

        # Download the image
        output_path.parent.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient() as http:
            img_response = await http.get(image_url, timeout=60.0)
            img_response.raise_for_status()
            output_path.write_bytes(img_response.content)

        file_size = output_path.stat().st_size
        logger.info("Image saved: %s (%d bytes)", output_path, file_size)
        logger.debug("Revised prompt: %s", revised_prompt)

        return output_path

    async def generate_scene_images(
        self,
        scenes: list[dict[str, Any]],
        settings: ImageSettings,
        output_dir: Path,
    ) -> list[dict[str, Any]]:
        """Generate images for all DALL-E scenes from the visual direction plan.

        Args:
            scenes: List of scene dicts with 'scene_id' and 'prompt' keys.
            settings: Image generation settings.
            output_dir: Directory to save images.

        Returns:
            List of result dicts with 'scene_id', 'path', 'status'.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict[str, Any]] = []

        for scene in scenes:
            scene_id = scene.get("scene_id", len(results))
            prompt = scene.get("prompt", "")
            output_path = output_dir / f"scene_{scene_id:03d}.png"

            try:
                path = await self.generate_image(prompt, settings, output_path)
                results.append({
                    "scene_id": scene_id,
                    "path": str(path),
                    "status": "generated",
                    "prompt": prompt,
                })
            except Exception as e:
                logger.error("Failed to generate scene %d: %s", scene_id, e)
                results.append({
                    "scene_id": scene_id,
                    "path": None,
                    "status": "error",
                    "error": str(e),
                    "prompt": prompt,
                })

        return results

    async def estimate_cost(self, count: int = 1) -> float:
        """Estimate cost for generating N images."""
        return count * COST_HD_1792

    async def generate_thumbnail_base(
        self,
        prompt: str,
        output_path: Path,
    ) -> Path:
        """Generate a thumbnail base image (1792x1024, text added by Pillow).

        CRITICAL: No text in the DALL-E prompt. Pillow handles all text overlays.
        """
        settings = ImageSettings(
            size="1792x1024",
            quality="hd",
            style="vivid",
            style_suffix="hyper-detailed, dramatic lighting, cinematic composition, thumbnail-worthy, no text",
        )
        return await self.generate_image(prompt, settings, output_path)
