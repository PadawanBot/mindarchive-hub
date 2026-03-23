"""SSE event streaming for real-time pipeline updates in the web dashboard."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

from mindarchive.pipeline.orchestrator import PipelineEvent

logger = logging.getLogger(__name__)

# Global event queue for SSE subscribers
_subscribers: list[asyncio.Queue[dict[str, Any] | None]] = []


def broadcast_event(event: PipelineEvent) -> None:
    """Broadcast a pipeline event to all SSE subscribers."""
    data = {
        "event_type": event.event_type,
        "step_number": event.step_number,
        "step_name": event.step_name,
        "message": event.message,
        "data": event.data,
    }
    for queue in _subscribers:
        try:
            queue.put_nowait(data)
        except asyncio.QueueFull:
            logger.warning("SSE subscriber queue full, dropping event")


def broadcast_production_event(step_id: str, status: str, data: dict[str, Any]) -> None:
    """Broadcast a production/distribution event to all SSE subscribers."""
    event_data = {
        "event_type": f"production_{status}",
        "step_number": None,
        "step_name": step_id,
        "message": data.get("message", ""),
        "data": data,
    }
    for queue in _subscribers:
        try:
            queue.put_nowait(event_data)
        except asyncio.QueueFull:
            logger.warning("SSE subscriber queue full, dropping event")


async def subscribe() -> AsyncGenerator[str, None]:
    """Subscribe to pipeline events as SSE stream.

    Yields SSE-formatted strings compatible with HTMX sse-ext.
    """
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    try:
        # Send initial connection event
        yield f"event: connected\ndata: {json.dumps({'status': 'connected'})}\n\n"

        while True:
            event = await queue.get()
            if event is None:
                break

            # Send as generic "message" event for HTMX sse-swap
            yield f"data: {json.dumps(event)}\n\n"
    finally:
        if queue in _subscribers:
            _subscribers.remove(queue)


def unsubscribe_all() -> None:
    """Send shutdown signal to all subscribers."""
    for queue in _subscribers:
        queue.put_nowait(None)


def subscriber_count() -> int:
    """Return the number of active SSE subscribers."""
    return len(_subscribers)
