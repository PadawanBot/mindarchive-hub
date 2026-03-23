"""SSE event streaming for real-time pipeline updates in the web dashboard."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

from mindarchive.pipeline.orchestrator import PipelineEvent

logger = logging.getLogger(__name__)

# Global event queue for SSE subscribers
_subscribers: list[asyncio.Queue[PipelineEvent | None]] = []


def broadcast_event(event: PipelineEvent) -> None:
    """Broadcast a pipeline event to all SSE subscribers."""
    for queue in _subscribers:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("SSE subscriber queue full, dropping event")


async def subscribe() -> AsyncGenerator[str, None]:
    """Subscribe to pipeline events as SSE stream.

    Yields SSE-formatted strings: "data: {...}\n\n"
    """
    queue: asyncio.Queue[PipelineEvent | None] = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    try:
        while True:
            event = await queue.get()
            if event is None:
                break

            data = {
                "event_type": event.event_type,
                "step_number": event.step_number,
                "step_name": event.step_name,
                "message": event.message,
                "data": event.data,
            }
            yield f"data: {json.dumps(data)}\n\n"
    finally:
        _subscribers.remove(queue)


def unsubscribe_all() -> None:
    """Send shutdown signal to all subscribers."""
    for queue in _subscribers:
        queue.put_nowait(None)
