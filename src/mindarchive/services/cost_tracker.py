"""Cost tracking service — estimates and logs API costs per operation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# ─── Cost rates (USD) ───

@dataclass
class ServiceRates:
    """Approximate cost rates per service. Updated as pricing changes."""

    # Anthropic Claude (per 1M tokens)
    claude_sonnet_input_per_1m: float = 3.00
    claude_sonnet_output_per_1m: float = 15.00
    claude_opus_input_per_1m: float = 15.00
    claude_opus_output_per_1m: float = 75.00

    # ElevenLabs (per 1K characters)
    elevenlabs_per_1k_chars: float = 0.30

    # DALL-E 3 (per image)
    dalle3_hd_1792x1024: float = 0.080
    dalle3_hd_1024x1024: float = 0.080
    dalle3_standard: float = 0.040

    # Runway (per credit, ~1 credit per 5s of video)
    runway_per_credit: float = 0.10

    # Pexels
    pexels_per_request: float = 0.0  # Free API


RATES = ServiceRates()


class CostTracker:
    """Tracks estimated and actual costs for a pipeline run."""

    def __init__(self, budget_cap_usd: float | None = None) -> None:
        self._budget_cap = budget_cap_usd
        self._entries: list[CostEntry] = []

    @property
    def total_estimated(self) -> float:
        return sum(e.estimated_usd for e in self._entries if e.estimated_usd)

    @property
    def total_actual(self) -> float:
        return sum(e.actual_usd for e in self._entries if e.actual_usd)

    @property
    def budget_remaining(self) -> float | None:
        if self._budget_cap is None:
            return None
        return self._budget_cap - self.total_actual

    @property
    def budget_warning(self) -> bool:
        """True if actual costs exceed 80% of budget cap."""
        if self._budget_cap is None:
            return False
        return self.total_actual >= (self._budget_cap * 0.80)

    @property
    def budget_exceeded(self) -> bool:
        if self._budget_cap is None:
            return False
        return self.total_actual >= self._budget_cap

    def log(
        self,
        service: str,
        operation: str,
        estimated_usd: float = 0.0,
        actual_usd: float = 0.0,
        units: float = 0.0,
        unit_type: str = "",
        step_number: int | None = None,
        detail: str = "",
    ) -> CostEntry:
        """Log a cost entry."""
        entry = CostEntry(
            service=service,
            operation=operation,
            estimated_usd=estimated_usd,
            actual_usd=actual_usd,
            units=units,
            unit_type=unit_type,
            step_number=step_number,
            detail=detail,
        )
        self._entries.append(entry)
        return entry

    def estimate_preproduction(self, word_count: int, num_steps: int = 11) -> float:
        """Estimate cost for pre-production steps (Claude API calls)."""
        avg_input_tokens = 2000
        avg_output_tokens = 4000
        cost_per_step = (
            (avg_input_tokens / 1_000_000) * RATES.claude_sonnet_input_per_1m
            + (avg_output_tokens / 1_000_000) * RATES.claude_sonnet_output_per_1m
        )
        return cost_per_step * num_steps

    def estimate_production(
        self,
        word_count: int,
        dalle_count: int,
        stock_count: int,
        runway_count: int,
    ) -> dict[str, float]:
        """Estimate production costs by service."""
        char_count = word_count * 5  # rough chars from words
        return {
            "elevenlabs": (char_count / 1000) * RATES.elevenlabs_per_1k_chars,
            "dalle": dalle_count * RATES.dalle3_hd_1792x1024,
            "runway": runway_count * 21 * RATES.runway_per_credit,  # ~21 credits per scene
            "pexels": 0.0,
            "total": (
                (char_count / 1000) * RATES.elevenlabs_per_1k_chars
                + dalle_count * RATES.dalle3_hd_1792x1024
                + runway_count * 21 * RATES.runway_per_credit
            ),
        }

    def summary(self) -> dict[str, float]:
        """Get cost summary grouped by service."""
        by_service: dict[str, float] = {}
        for entry in self._entries:
            cost = entry.actual_usd or entry.estimated_usd or 0.0
            by_service[entry.service] = by_service.get(entry.service, 0.0) + cost
        by_service["total"] = sum(by_service.values())
        return by_service

    @property
    def entries(self) -> list[CostEntry]:
        return list(self._entries)


@dataclass
class CostEntry:
    """A single cost tracking entry."""

    service: str
    operation: str
    estimated_usd: float = 0.0
    actual_usd: float = 0.0
    units: float = 0.0
    unit_type: str = ""
    step_number: int | None = None
    detail: str = ""
