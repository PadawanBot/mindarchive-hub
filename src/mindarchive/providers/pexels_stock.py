"""Pexels stock footage provider — searches and downloads free B-roll clips."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from mindarchive.providers.base import StockSearchResult
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

PEXELS_API_BASE = "https://api.pexels.com"


class PexelsStockProvider:
    """Pexels video search and download implementing the StockProvider protocol."""

    def __init__(
        self,
        api_key: str,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        self._api_key = api_key
        self._rate_limiter = rate_limiter

    def provider_name(self) -> str:
        return "pexels"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": self._api_key}

    async def search_videos(
        self,
        keywords: list[str],
        per_page: int = 10,
        orientation: str = "landscape",
        min_duration: int = 3,
        max_duration: int = 30,
    ) -> list[StockSearchResult]:
        """Search Pexels for stock video clips.

        Args:
            keywords: Search terms (combined with spaces).
            per_page: Results per page (max 80).
            orientation: landscape, portrait, or square.
            min_duration: Minimum clip duration in seconds.
            max_duration: Maximum clip duration in seconds.

        Returns:
            List of StockSearchResult objects.
        """
        if self._rate_limiter:
            await self._rate_limiter.acquire("pexels")

        query = " ".join(keywords)
        logger.info("Pexels search: %s (per_page=%d)", query, per_page)

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{PEXELS_API_BASE}/videos/search",
                headers=self._headers(),
                params={
                    "query": query,
                    "per_page": min(per_page, 80),
                    "orientation": orientation,
                    "size": "large",
                },
                timeout=15.0,
            )
            response.raise_for_status()
            data = response.json()

        results: list[StockSearchResult] = []
        for video in data.get("videos", []):
            duration = video.get("duration", 0)
            if duration < min_duration or duration > max_duration:
                continue

            # Get the best quality HD file
            video_files = video.get("video_files", [])
            best_file = _pick_best_file(video_files)
            if not best_file:
                continue

            results.append(StockSearchResult(
                id=str(video["id"]),
                url=best_file["link"],
                preview_url=video.get("video_pictures", [{}])[0].get("picture", ""),
                duration_seconds=float(duration),
                width=best_file.get("width", 0),
                height=best_file.get("height", 0),
                keywords=keywords,
            ))

        logger.info("Pexels found %d clips for '%s'", len(results), query)
        return results

    async def download_video(
        self,
        video_id: str,
        output_path: Path,
        url: str | None = None,
    ) -> Path:
        """Download a video clip from Pexels.

        Args:
            video_id: Pexels video ID.
            output_path: Where to save the clip.
            url: Direct download URL (if already known from search).

        Returns:
            Path to the downloaded clip.
        """
        if self._rate_limiter:
            await self._rate_limiter.acquire("pexels")

        if url is None:
            # Fetch video details to get download URL
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{PEXELS_API_BASE}/videos/videos/{video_id}",
                    headers=self._headers(),
                    timeout=15.0,
                )
                response.raise_for_status()
                data = response.json()

            video_files = data.get("video_files", [])
            best_file = _pick_best_file(video_files)
            if not best_file:
                raise ValueError(f"No suitable video file found for Pexels video {video_id}")
            url = best_file["link"]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Downloading Pexels clip %s → %s", video_id, output_path)

        async with httpx.AsyncClient() as client:
            async with client.stream("GET", url, timeout=120.0) as response:
                response.raise_for_status()
                with open(output_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)

        file_size = output_path.stat().st_size
        logger.info("Clip downloaded: %s (%d bytes)", output_path, file_size)
        return output_path

    async def search_and_download(
        self,
        keywords: list[str],
        output_dir: Path,
        max_clips: int = 3,
    ) -> list[dict[str, Any]]:
        """Search and download top clips for a set of keywords.

        Returns:
            List of dicts with 'id', 'path', 'duration_seconds', 'keywords'.
        """
        results = await self.search_videos(keywords, per_page=max_clips * 2)
        output_dir.mkdir(parents=True, exist_ok=True)

        downloads: list[dict[str, Any]] = []
        for result in results[:max_clips]:
            output_path = output_dir / f"pexels_{result.id}.mp4"
            try:
                path = await self.download_video(result.id, output_path, url=result.url)
                downloads.append({
                    "id": result.id,
                    "path": str(path),
                    "duration_seconds": result.duration_seconds,
                    "keywords": keywords,
                })
            except Exception as e:
                logger.error("Failed to download Pexels clip %s: %s", result.id, e)

        return downloads


def _pick_best_file(video_files: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the best quality video file, preferring HD (1920x1080)."""
    # Sort by width descending, prefer HD
    candidates = [
        f for f in video_files
        if f.get("width", 0) >= 1280 and f.get("file_type") == "video/mp4"
    ]
    if not candidates:
        candidates = [f for f in video_files if f.get("file_type") == "video/mp4"]
    if not candidates:
        return None

    # Prefer 1920 width, fall back to largest
    for c in candidates:
        if c.get("width") == 1920:
            return c
    return max(candidates, key=lambda f: f.get("width", 0))
