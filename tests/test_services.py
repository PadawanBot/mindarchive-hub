"""Tests for services: cost tracker, quality checker, rate limiter."""

from __future__ import annotations

import pytest


class TestCostTracker:
    def test_init_default(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker()
        assert ct.total_estimated == 0
        assert ct.total_actual == 0

    def test_log_entry(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker()
        entry = ct.log(
            service="anthropic",
            operation="generate_script",
            estimated_usd=0.05,
            actual_usd=0.045,
            units=5000,
            unit_type="tokens",
        )
        assert entry.service == "anthropic"
        assert ct.total_estimated == pytest.approx(0.05)
        assert ct.total_actual == pytest.approx(0.045)

    def test_budget_cap(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker(budget_cap_usd=1.0)
        ct.log(service="test", operation="op", actual_usd=0.9)
        assert ct.budget_warning is True
        assert ct.budget_exceeded is False

        ct.log(service="test", operation="op2", actual_usd=0.2)
        assert ct.budget_exceeded is True

    def test_summary(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker()
        ct.log(service="a", operation="op1", estimated_usd=0.1, actual_usd=0.08)
        ct.log(service="b", operation="op2", estimated_usd=0.2, actual_usd=0.15)
        summary = ct.summary()
        assert "total" in summary
        assert summary["total"] == pytest.approx(0.23)

    def test_estimate_preproduction(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker()
        cost = ct.estimate_preproduction(word_count=1200, num_steps=11)
        assert cost > 0

    def test_estimate_production(self):
        from mindarchive.services.cost_tracker import CostTracker

        ct = CostTracker()
        costs = ct.estimate_production(
            word_count=1200,
            dalle_count=6,
            stock_count=3,
            runway_count=2,
        )
        assert "elevenlabs" in costs
        assert "dalle" in costs
        assert "runway" in costs
        assert all(v >= 0 for v in costs.values())


class TestQualityChecker:
    def test_script_quality_good(self):
        from mindarchive.services.quality_checker import check_script_quality

        # Generate a script with ~1260 words
        words = " ".join(["word"] * 1260)
        script = f"[DALLE: scene one] {words} [STOCK: b-roll] More text here."
        report = check_script_quality(script, target_words=1260)
        assert report.score >= 0.0
        assert isinstance(report.passed, bool)
        assert len(report.checks) > 0

    def test_script_quality_too_short(self):
        from mindarchive.services.quality_checker import check_script_quality

        report = check_script_quality("This is way too short.", target_words=1260)
        assert report.score < 1.0

    def test_hooks_quality(self):
        from mindarchive.services.quality_checker import check_hooks_quality

        hooks = """HOOK 1: "What if everything you knew about personality was wrong?"
HOOK 2: "The dark truth about narcissism that nobody talks about."
HOOK 3: "Scientists just discovered something terrifying about the human mind."
"""
        report = check_hooks_quality(hooks)
        assert report.score >= 0.0
        assert len(report.checks) > 0


class TestRateLimiter:
    async def test_acquire_no_limit(self):
        from mindarchive.services.rate_limiter import RateLimiter

        rl = RateLimiter()
        # Should not block for unknown service
        await rl.acquire("unknown_service")

    async def test_acquire_known_service(self):
        from mindarchive.services.rate_limiter import RateLimiter

        rl = RateLimiter()
        # Should not block on first call
        await rl.acquire("anthropic")

    def test_status(self):
        from mindarchive.services.rate_limiter import RateLimiter

        rl = RateLimiter()
        status = rl.status("anthropic")
        assert isinstance(status, dict)

    def test_estimate_time(self):
        from mindarchive.services.rate_limiter import RateLimiter

        rl = RateLimiter()
        t = rl.estimate_time("openai_dalle", request_count=10)
        assert t >= 0
