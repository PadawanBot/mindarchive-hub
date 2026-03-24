"""Anthropic Claude LLM provider — the primary AI engine for the pipeline."""

from __future__ import annotations

import logging
from typing import Any

from anthropic import APIStatusError, AsyncAnthropic

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


class AnthropicLLM:
    """Anthropic Claude API client implementing the LLMProvider protocol."""

    def __init__(
        self,
        api_key: str,
        default_model: str = "claude-sonnet-4-6",
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        import httpx

        # Use HTTP/2 to avoid Cloudflare TLS fingerprint blocking
        http_client = httpx.AsyncClient(http2=True)
        self._client = AsyncAnthropic(api_key=api_key, http_client=http_client)
        self._default_model = default_model
        self._rate_limiter = rate_limiter

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
                e.status_code, e.message, e.body, dict(e.response.headers) if e.response else None,
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

    async def estimate_cost(self, input_tokens: int, output_tokens: int, model: str | None = None) -> float:
        """Estimate cost for a given token usage."""
        model = model or self._default_model
        pricing = _PRICING.get(model, (3.00, 15.00))
        return (input_tokens / 1_000_000) * pricing[0] + (output_tokens / 1_000_000) * pricing[1]
