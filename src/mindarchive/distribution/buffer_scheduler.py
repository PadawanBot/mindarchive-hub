"""Buffer social media scheduler — schedules promotional posts across platforms."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BUFFER_API_BASE = "https://api.bufferapp.com/1"


class BufferScheduler:
    """Schedules social media posts via the Buffer API.

    Supports scheduling promotional posts for YouTube videos across
    connected social profiles (Twitter/X, Facebook, LinkedIn, Instagram).
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def _params(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        """Build request params with auth token."""
        params: dict[str, Any] = {"access_token": self._api_key}
        if extra:
            params.update(extra)
        return params

    async def get_profiles(self) -> list[dict[str, Any]]:
        """List all connected social media profiles."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{BUFFER_API_BASE}/profiles.json",
                params=self._params(),
                timeout=15.0,
            )
            response.raise_for_status()

        profiles = response.json()
        return [
            {
                "id": p["id"],
                "service": p.get("service", "unknown"),
                "service_username": p.get("service_username", ""),
                "formatted_service": p.get("formatted_service", ""),
                "default": p.get("default", False),
            }
            for p in profiles
        ]

    async def schedule_post(
        self,
        profile_ids: list[str],
        text: str,
        link: str | None = None,
        media_url: str | None = None,
        scheduled_at: datetime | None = None,
        now: bool = False,
    ) -> dict[str, Any]:
        """Schedule a post to one or more social profiles.

        Args:
            profile_ids: Buffer profile IDs to post to.
            text: Post text content.
            link: Optional URL to include (e.g., YouTube video link).
            media_url: Optional media thumbnail URL.
            scheduled_at: When to publish. If None, added to Buffer queue.
            now: If True, post immediately instead of queueing.

        Returns:
            Dict with post creation result.
        """
        data: dict[str, Any] = {
            "text": text,
            "profile_ids[]": profile_ids,
            "now": now,
        }

        if link:
            data["media[link]"] = link
        if media_url:
            data["media[photo]"] = media_url

        if scheduled_at and not now:
            data["scheduled_at"] = scheduled_at.isoformat()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{BUFFER_API_BASE}/updates/create.json",
                params={"access_token": self._api_key},
                data=data,
                timeout=15.0,
            )
            response.raise_for_status()

        result = response.json()
        logger.info(
            "Buffer post scheduled: %d profiles, text=%s...",
            len(profile_ids),
            text[:50],
        )
        return {
            "success": result.get("success", False),
            "update_id": result.get("updates", [{}])[0].get("id") if result.get("updates") else None,
            "message": result.get("message", ""),
        }

    async def schedule_video_promotion(
        self,
        video_url: str,
        video_title: str,
        description: str,
        profile_ids: list[str] | None = None,
        post_count: int = 3,
        interval_hours: int = 24,
        hashtags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Schedule a series of promotional posts for a YouTube video.

        Creates multiple posts spaced out over time with varied copy.

        Args:
            video_url: YouTube video URL.
            video_title: Video title for post copy.
            description: Brief description for context.
            profile_ids: Specific profiles, or None for all connected.
            post_count: Number of promotional posts to schedule.
            interval_hours: Hours between each post.
            hashtags: Optional hashtags to include.

        Returns:
            List of scheduling results.
        """
        if profile_ids is None:
            profiles = await self.get_profiles()
            profile_ids = [p["id"] for p in profiles]

        if not profile_ids:
            logger.warning("No Buffer profiles connected — cannot schedule posts")
            return []

        tag_str = " ".join(f"#{h}" for h in (hashtags or []))

        # Generate varied post templates
        templates = _generate_promo_templates(video_title, description, video_url, tag_str)

        results: list[dict[str, Any]] = []
        base_time = datetime.utcnow() + timedelta(hours=1)

        for i in range(min(post_count, len(templates))):
            scheduled_at = base_time + timedelta(hours=i * interval_hours)
            post_text = templates[i]

            result = await self.schedule_post(
                profile_ids=profile_ids,
                text=post_text,
                link=video_url,
                scheduled_at=scheduled_at,
            )
            result["scheduled_at"] = scheduled_at.isoformat()
            result["post_text"] = post_text
            results.append(result)

        logger.info("Scheduled %d promotional posts for: %s", len(results), video_title)
        return results

    async def get_pending_updates(self, profile_id: str) -> list[dict[str, Any]]:
        """Get pending (queued) updates for a profile."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{BUFFER_API_BASE}/profiles/{profile_id}/updates/pending.json",
                params=self._params(),
                timeout=15.0,
            )
            response.raise_for_status()

        data = response.json()
        return [
            {
                "id": u["id"],
                "text": u.get("text", ""),
                "scheduled_at": u.get("scheduled_at"),
                "status": u.get("status"),
            }
            for u in data.get("updates", [])
        ]


def _generate_promo_templates(
    title: str,
    description: str,
    url: str,
    hashtags: str,
) -> list[str]:
    """Generate varied promotional post templates."""
    templates = [
        # Launch post
        f"NEW VIDEO: {title}\n\n{description}\n\nWatch now: {url}\n{hashtags}",
        # Engagement hook
        f"Have you ever wondered about {title.lower()}? We break it all down in our latest video.\n\n{url}\n{hashtags}",
        # Value-driven
        f"Here's what you need to know about {title.lower()} — explained in under 15 minutes.\n\n{url}\n{hashtags}",
        # Question hook
        f"What if everything you thought about this topic was wrong?\n\nFind out: {url}\n{hashtags}",
        # Social proof
        f"This video is getting incredible feedback. Don't miss it.\n\n{title}\n{url}\n{hashtags}",
    ]
    return templates
