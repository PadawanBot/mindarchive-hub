"""Notification provider system — configurable per-profile alerts."""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class NotificationProvider(Protocol):
    """Interface for notification providers."""

    async def send(self, message: str, **kwargs: Any) -> bool: ...

    def provider_name(self) -> str: ...


class LogNotifier:
    """Fallback notifier that logs to stdout/logging."""

    def provider_name(self) -> str:
        return "log"

    async def send(self, message: str, **kwargs: Any) -> bool:
        logger.info("[NOTIFICATION] %s", message)
        return True


class TelegramNotifier:
    """Telegram Bot API notifier."""

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self._bot_token = bot_token
        self._chat_id = chat_id

    def provider_name(self) -> str:
        return "telegram"

    async def send(self, message: str, **kwargs: Any) -> bool:
        import httpx

        url = f"https://api.telegram.org/bot{self._bot_token}/sendMessage"
        payload = {
            "chat_id": self._chat_id,
            "text": message,
            "parse_mode": kwargs.get("parse_mode", "Markdown"),
        }
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, timeout=10.0)
                return resp.status_code == 200
        except Exception as e:
            logger.error("Telegram notification failed: %s", e)
            return False


class DiscordNotifier:
    """Discord webhook notifier."""

    def __init__(self, webhook_url: str) -> None:
        self._webhook_url = webhook_url

    def provider_name(self) -> str:
        return "discord"

    async def send(self, message: str, **kwargs: Any) -> bool:
        import httpx

        payload = {"content": message}
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(self._webhook_url, json=payload, timeout=10.0)
                return resp.status_code in (200, 204)
        except Exception as e:
            logger.error("Discord notification failed: %s", e)
            return False


class NotificationManager:
    """Manages notification dispatch to configured providers."""

    def __init__(self) -> None:
        self._providers: list[NotificationProvider] = [LogNotifier()]

    def add_provider(self, provider: NotificationProvider) -> None:
        self._providers.append(provider)

    async def notify(self, message: str, **kwargs: Any) -> None:
        """Send notification to all configured providers."""
        for provider in self._providers:
            try:
                await provider.send(message, **kwargs)
            except Exception as e:
                logger.error("Notification via %s failed: %s", provider.provider_name(), e)

    async def notify_gate_pause(self, step_number: int, step_name: str, summary: str) -> None:
        """Notify about a confirmation gate pause."""
        msg = f"⏸ *GATE PAUSE* — Step {step_number}: {step_name}\n{summary}\nAwaiting approval."
        await self.notify(msg)

    async def notify_step_complete(self, step_number: int, step_name: str, summary: str) -> None:
        msg = f"✅ Step {step_number}: {step_name} complete\n{summary}"
        await self.notify(msg)

    async def notify_error(self, step_number: int, step_name: str, error: str) -> None:
        msg = f"❌ Step {step_number}: {step_name} FAILED\n{error}"
        await self.notify(msg)

    async def notify_budget_warning(self, total_spent: float, budget_cap: float) -> None:
        pct = (total_spent / budget_cap) * 100 if budget_cap > 0 else 0
        msg = f"⚠️ *BUDGET WARNING* — ${total_spent:.2f} spent ({pct:.0f}% of ${budget_cap:.2f} cap)"
        await self.notify(msg)

    @classmethod
    def from_config(cls, config: dict[str, Any] | None) -> NotificationManager:
        """Build a NotificationManager from a profile's notification_config."""
        manager = cls()
        if not config:
            return manager

        provider_type = config.get("provider", "log")
        if provider_type == "telegram":
            bot_token = config.get("bot_token", "")
            chat_id = config.get("chat_id", "")
            if bot_token and chat_id:
                manager.add_provider(TelegramNotifier(bot_token, chat_id))
        elif provider_type == "discord":
            webhook_url = config.get("webhook_url", "")
            if webhook_url:
                manager.add_provider(DiscordNotifier(webhook_url))

        return manager
