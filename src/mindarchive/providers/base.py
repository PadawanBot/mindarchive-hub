"""Provider protocol definitions — swappable AI service interfaces."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


# ─── Voice Provider ───

class VoiceSettings(BaseModel):
    """Voice generation settings."""

    voice_id: str
    voice_name: str = ""
    model: str = "eleven_v3"
    stability: float = 0.5
    similarity_boost: float = 0.85
    style: float = 0.3
    base_wpm: int = 140
    slow_wpm: int = 100


@runtime_checkable
class VoiceProvider(Protocol):
    """Interface for text-to-speech providers (ElevenLabs, etc.)."""

    async def generate_voiceover(
        self, text: str, settings: VoiceSettings, output_path: Path
    ) -> Path: ...

    async def estimate_cost(self, text: str) -> float: ...

    def provider_name(self) -> str: ...


# ─── Image Provider ───

class ImageSettings(BaseModel):
    """Image generation settings."""

    size: str = "1792x1024"
    quality: str = "hd"
    style: str = "vivid"
    style_suffix: str = "cinematic, photorealistic, 4K documentary style, no text in frame"


@runtime_checkable
class ImageProvider(Protocol):
    """Interface for image generation providers (DALL-E, etc.)."""

    async def generate_image(
        self, prompt: str, settings: ImageSettings, output_path: Path
    ) -> Path: ...

    async def estimate_cost(self, count: int) -> float: ...

    def provider_name(self) -> str: ...


# ─── Video Provider ───

class VideoSettings(BaseModel):
    """Video/motion generation settings."""

    duration_seconds: int = 5
    resolution: str = "1080p"
    style: str = "cinematic"


@runtime_checkable
class VideoProvider(Protocol):
    """Interface for AI video providers (Runway, etc.)."""

    async def generate_video(
        self, prompt: str, settings: VideoSettings, output_path: Path
    ) -> Path: ...

    async def estimate_cost(self, count: int) -> float: ...

    async def check_credits(self) -> float: ...

    def provider_name(self) -> str: ...


# ─── Stock Footage Provider ───

class StockSearchResult(BaseModel):
    """A single stock footage search result."""

    id: str
    url: str
    preview_url: str = ""
    duration_seconds: float = 0.0
    width: int = 0
    height: int = 0
    keywords: list[str] = []


@runtime_checkable
class StockProvider(Protocol):
    """Interface for stock footage providers (Pexels, etc.)."""

    async def search_videos(
        self, keywords: list[str], per_page: int = 10
    ) -> list[StockSearchResult]: ...

    async def download_video(self, video_id: str, output_path: Path) -> Path: ...

    def provider_name(self) -> str: ...


# ─── LLM Provider ───

class LLMResponse(BaseModel):
    """Response from an LLM call."""

    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = ""


@runtime_checkable
class LLMProvider(Protocol):
    """Interface for LLM providers (Anthropic Claude, etc.)."""

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        max_tokens: int = 8000,
        conversation_history: list[dict[str, str]] | None = None,
    ) -> LLMResponse: ...

    async def estimate_cost(self, input_tokens: int, output_tokens: int) -> float: ...

    def provider_name(self) -> str: ...
