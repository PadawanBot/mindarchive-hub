"""ElevenLabs TTS provider — generates voiceover MP3 from script text."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from mindarchive.providers.base import VoiceSettings
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Average characters per word (for cost estimation)
CHARS_PER_WORD = 5.0

# ElevenLabs pricing per 1K characters
COST_PER_1K_CHARS = 0.30


class ElevenLabsVoice:
    """ElevenLabs TTS provider implementing the VoiceProvider protocol."""

    def __init__(
        self,
        api_key: str,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        self._api_key = api_key
        self._rate_limiter = rate_limiter
        self._client: Any = None

    def provider_name(self) -> str:
        return "elevenlabs"

    def _get_client(self) -> Any:
        if self._client is None:
            from elevenlabs import AsyncElevenLabs

            self._client = AsyncElevenLabs(api_key=self._api_key)
        return self._client

    async def generate_voiceover(
        self,
        text: str,
        settings: VoiceSettings,
        output_path: Path,
    ) -> Path:
        """Generate a voiceover MP3 from text using ElevenLabs.

        Args:
            text: The narration text to synthesize.
            settings: Voice configuration (voice_id, model, stability, etc.).
            output_path: Where to save the MP3 file.

        Returns:
            Path to the generated MP3 file.
        """
        if self._rate_limiter:
            await self._rate_limiter.acquire("elevenlabs")

        client = self._get_client()

        logger.info(
            "Generating voiceover: voice=%s, model=%s, chars=%d",
            settings.voice_id,
            settings.model,
            len(text),
        )

        audio = await client.text_to_speech.convert(
            voice_id=settings.voice_id,
            text=text,
            model_id=settings.model,
            voice_settings={
                "stability": settings.stability,
                "similarity_boost": settings.similarity_boost,
                "style": settings.style,
                "use_speaker_boost": True,
            },
            output_format="mp3_44100_128",
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)

        # audio is an async iterator of bytes
        with open(output_path, "wb") as f:
            async for chunk in audio:
                f.write(chunk)

        file_size = output_path.stat().st_size
        logger.info("Voiceover saved: %s (%d bytes)", output_path, file_size)
        return output_path

    async def generate_voiceover_segments(
        self,
        segments: list[dict[str, str]],
        settings: VoiceSettings,
        output_dir: Path,
    ) -> list[Path]:
        """Generate voiceover for multiple segments (for per-scene TTS).

        Args:
            segments: List of dicts with 'id' and 'text' keys.
            settings: Voice configuration.
            output_dir: Directory to save segment MP3s.

        Returns:
            List of paths to generated MP3 files.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        paths: list[Path] = []

        for segment in segments:
            seg_id = segment.get("id", f"seg_{len(paths):03d}")
            text = segment["text"]
            output_path = output_dir / f"{seg_id}.mp3"
            await self.generate_voiceover(text, settings, output_path)
            paths.append(output_path)

        return paths

    async def estimate_cost(self, text: str) -> float:
        """Estimate cost for generating voiceover from text."""
        char_count = len(text)
        return (char_count / 1000) * COST_PER_1K_CHARS

    async def estimate_cost_words(self, word_count: int) -> float:
        """Estimate cost from word count."""
        char_count = int(word_count * CHARS_PER_WORD)
        return (char_count / 1000) * COST_PER_1K_CHARS

    async def list_voices(self) -> list[dict[str, Any]]:
        """List available voices from ElevenLabs account."""
        client = self._get_client()
        response = await client.voices.get_all()
        return [
            {
                "voice_id": v.voice_id,
                "name": v.name,
                "category": v.category,
                "labels": v.labels,
            }
            for v in response.voices
        ]
