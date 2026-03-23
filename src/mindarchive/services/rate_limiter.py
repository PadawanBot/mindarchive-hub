"""Rate limiter for API services — proactive quota management."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field


@dataclass
class RateLimit:
    """Rate limit configuration for a service."""

    requests_per_minute: int = 0
    requests_per_hour: int = 0
    daily_quota: int = 0
    description: str = ""


# Known rate limits for services used in the pipeline
KNOWN_LIMITS: dict[str, RateLimit] = {
    "anthropic": RateLimit(
        requests_per_minute=60,
        description="Anthropic Claude API",
    ),
    "openai_dalle": RateLimit(
        requests_per_minute=7,
        description="OpenAI DALL-E 3 (Tier 1)",
    ),
    "elevenlabs": RateLimit(
        requests_per_minute=10,
        description="ElevenLabs TTS API",
    ),
    "pexels": RateLimit(
        requests_per_minute=30,
        requests_per_hour=200,
        description="Pexels Video API",
    ),
    "runway": RateLimit(
        requests_per_minute=5,
        description="Runway Gen-3 via Playwright",
    ),
}


@dataclass
class _RequestLog:
    """Internal tracker for request timestamps."""

    timestamps: list[float] = field(default_factory=list)

    def prune(self, window_seconds: float) -> None:
        cutoff = time.monotonic() - window_seconds
        self.timestamps = [t for t in self.timestamps if t > cutoff]

    def count_in_window(self, window_seconds: float) -> int:
        self.prune(window_seconds)
        return len(self.timestamps)

    def record(self) -> None:
        self.timestamps.append(time.monotonic())


class RateLimiter:
    """Manages rate limiting across all API services."""

    def __init__(self) -> None:
        self._logs: dict[str, _RequestLog] = {}
        self._limits: dict[str, RateLimit] = dict(KNOWN_LIMITS)

    def set_limit(self, service: str, limit: RateLimit) -> None:
        self._limits[service] = limit

    def _get_log(self, service: str) -> _RequestLog:
        if service not in self._logs:
            self._logs[service] = _RequestLog()
        return self._logs[service]

    async def acquire(self, service: str) -> None:
        """Wait until a request slot is available for the given service."""
        limit = self._limits.get(service)
        if not limit:
            return

        log = self._get_log(service)

        while True:
            # Check per-minute limit
            if limit.requests_per_minute > 0:
                count_minute = log.count_in_window(60.0)
                if count_minute >= limit.requests_per_minute:
                    await asyncio.sleep(1.0)
                    continue

            # Check per-hour limit
            if limit.requests_per_hour > 0:
                count_hour = log.count_in_window(3600.0)
                if count_hour >= limit.requests_per_hour:
                    await asyncio.sleep(5.0)
                    continue

            break

        log.record()

    def estimate_time(self, service: str, request_count: int) -> float:
        """Estimate seconds needed to process N requests for a service."""
        limit = self._limits.get(service)
        if not limit or limit.requests_per_minute <= 0:
            return 0.0
        # Seconds per request at rate limit
        seconds_per_request = 60.0 / limit.requests_per_minute
        return request_count * seconds_per_request

    def status(self, service: str) -> dict[str, int | float]:
        """Current usage status for a service."""
        limit = self._limits.get(service)
        log = self._get_log(service)
        if not limit:
            return {"requests_last_minute": log.count_in_window(60.0)}
        return {
            "requests_last_minute": log.count_in_window(60.0),
            "limit_per_minute": limit.requests_per_minute,
            "requests_last_hour": log.count_in_window(3600.0),
            "limit_per_hour": limit.requests_per_hour,
        }
