"""Anthropic Claude LLM provider — the primary AI engine for the pipeline.

Uses subprocess curl.exe on Windows to bypass Cloudflare TLS fingerprint
blocking of Python's OpenSSL. Falls back to the Anthropic SDK on Linux/macOS.
"""

from __future__ import annotations

import json
import logging
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from mindarchive.providers.base import LLMResponse
from mindarchive.services.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Pricing per 1M tokens (as of 2026)
_PRICING: dict[str, tuple[float, float]] = {
    # (input_per_1m, output_per_1m)
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-6": (15.00, 75.00),
    "claude-haiku-4-5-20251001": (0.80, 4.00),
}

_API_URL = "https://api.anthropic.com/v1/messages"
_API_VERSION = "2023-06-01"


def _needs_curl_backend() -> bool:
    """Check if we need to use curl.exe instead of httpx (Windows OpenSSL issue)."""
    if platform.system() != "Windows":
        return False
    return shutil.which("curl.exe") is not None


def _curl_request(
    api_key: str,
    payload: dict[str, Any],
    timeout: int = 120,
) -> dict[str, Any]:
    """Make an API request via curl.exe --ssl-no-revoke.

    This bypasses Python's OpenSSL which gets blocked by Cloudflare's
    TLS fingerprint detection on some Windows configurations.
    """
    body_json = json.dumps(payload)

    # Write body to temp file to avoid shell escaping issues
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as f:
        f.write(body_json)
        body_path = f.name

    try:
        result = subprocess.run(
            [
                "curl.exe",
                "--ssl-no-revoke",
                "-s",
                _API_URL,
                "-H", f"x-api-key: {api_key}",
                "-H", f"anthropic-version: {_API_VERSION}",
                "-H", "content-type: application/json",
                "-d", f"@{body_path}",
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    finally:
        Path(body_path).unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(f"curl.exe failed (exit {result.returncode}): {result.stderr}")

    if not result.stdout.strip():
        raise RuntimeError(f"curl.exe returned empty response. stderr: {result.stderr}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid JSON from API: {result.stdout[:500]}") from e

    if data.get("type") == "error":
        err = data.get("error", {})
        raise RuntimeError(
            f"Anthropic API error: {err.get('type', 'unknown')}: {err.get('message', '')}"
        )

    return data


class AnthropicLLM:
    """Anthropic Claude API client implementing the LLMProvider protocol.

    On Windows, uses curl.exe to bypass Cloudflare TLS fingerprint blocking.
    On other platforms, uses the standard Anthropic SDK.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "claude-sonnet-4-6",
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        self._api_key = api_key
        self._default_model = default_model
        self._rate_limiter = rate_limiter
        self._use_curl = _needs_curl_backend()

        if self._use_curl:
            logger.info("Using curl.exe backend (Windows TLS workaround)")
            self._client = None
        else:
            from anthropic import AsyncAnthropic

            self._client = AsyncAnthropic(api_key=api_key)

    def provider_name(self) -> str:
        return "anthropic"

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        max_tokens: int = 8000,
        conversation_history: list[dict[str, str]] | None = None,
    ) -> LLMResponse:
        """Generate a completion from Claude."""
        model = model or self._default_model

        if self._rate_limiter:
            await self._rate_limiter.acquire("anthropic")

        # Build messages
        messages: list[dict[str, Any]] = []
        if conversation_history:
            for msg in conversation_history:
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_prompt})

        logger.info(
            "Claude API call: model=%s, messages=%d, system_len=%d, user_len=%d",
            model, len(messages), len(system_prompt), len(user_prompt),
        )

        if self._use_curl:
            return await self._generate_via_curl(
                system_prompt, messages, model, max_tokens
            )

        return await self._generate_via_sdk(
            system_prompt, messages, model, max_tokens
        )

    async def _generate_via_curl(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        """Generate using curl.exe subprocess."""
        import asyncio

        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system_prompt:
            payload["system"] = system_prompt

        # Run curl in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(
            None, _curl_request, self._api_key, payload
        )

        # Parse response
        text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")

        usage = data.get("usage", {})
        return LLMResponse(
            text=text,
            model=data.get("model", model),
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            stop_reason=data.get("stop_reason", ""),
        )

    async def _generate_via_sdk(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        """Generate using the standard Anthropic SDK."""
        from anthropic import APIStatusError

        try:
            response = await self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=messages,
            )
        except APIStatusError as e:
            logger.error(
                "Anthropic API error: status=%d, message=%s, body=%s, headers=%s",
                e.status_code, e.message, e.body,
                dict(e.response.headers) if e.response else None,
            )
            raise

        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text += block.text

        return LLMResponse(
            text=text,
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            stop_reason=response.stop_reason or "",
        )

    async def generate_with_edit_loop(
        self,
        system_prompt: str,
        user_prompt: str,
        review_prompt: str,
        model: str | None = None,
        max_tokens: int = 8000,
        max_iterations: int = 3,
    ) -> tuple[LLMResponse, list[LLMResponse]]:
        """Generate content then run review/edit iterations.

        Returns the final response and all intermediate responses.
        """
        history: list[LLMResponse] = []

        # Initial generation
        response = await self.generate(system_prompt, user_prompt, model, max_tokens)
        history.append(response)

        # Edit loop
        conversation: list[dict[str, str]] = [
            {"role": "user", "content": user_prompt},
            {"role": "assistant", "content": response.text},
        ]

        for i in range(max_iterations):
            review_response = await self.generate(
                system_prompt,
                review_prompt + f"\n\nHere is the current draft:\n\n{response.text}",
                model,
                max_tokens,
                conversation,
            )
            history.append(review_response)

            # Check if the review says it's good
            review_text = review_response.text.lower()
            if any(phrase in review_text for phrase in [
                "no changes needed",
                "looks good",
                "approved",
                "no further edits",
                "ready for production",
            ]):
                logger.info("Edit loop converged after %d iterations", i + 1)
                break

            # Use the review as the new response
            response = review_response
            conversation.extend([
                {"role": "user", "content": review_prompt},
                {"role": "assistant", "content": review_response.text},
            ])

        return history[-1], history

    async def estimate_cost(
        self, input_tokens: int, output_tokens: int, model: str | None = None
    ) -> float:
        """Estimate cost for a given token usage."""
        model = model or self._default_model
        pricing = _PRICING.get(model, (3.00, 15.00))
        return (input_tokens / 1_000_000) * pricing[0] + (
            output_tokens / 1_000_000
        ) * pricing[1]
