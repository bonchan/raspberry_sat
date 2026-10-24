"""Pushes to the browser: one WebSocket per tab (/api/ws). The tab subscribes to topics; for each it gets
the topic's current state right away (its snapshot) and then every change that producers publish.
Producers that cost something (reading SatDump fast, the spectrum) ask `watching` and only work while a
tab is subscribed. Messages are {"topic": ..., "data": ...}; the tab sends {"subscribe": [...]} and
{"unsubscribe": [...]}, and subscribing again to a topic it has sends the snapshot again.
"""

import asyncio
import inspect
import json
import logging
import math
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)

QUEUE = 100         # messages waiting for a slow tab; beyond that the oldest are dropped

Snapshot = Callable[[], Any]       # the topic's current state; may be async


def _finite(value: Any) -> Any:
    """NaN and infinities (SatDump's stats can have them) as null, so the browser can parse the JSON."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


def encode(topic: str, data: Any) -> str:
    try:
        return json.dumps({"topic": topic, "data": data}, allow_nan=False, separators=(",", ":"))
    except ValueError:
        return json.dumps({"topic": topic, "data": _finite(data)}, separators=(",", ":"))


class Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.topics: set[str] = set()
        self.queue: asyncio.Queue[str] = asyncio.Queue(QUEUE)

    def send(self, message: str) -> None:
        if self.queue.full():           # a tab that doesn't keep up loses the oldest, not the newest
            self.queue.get_nowait()
        self.queue.put_nowait(message)


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()
        self.snapshots: dict[str, Snapshot | None] = {}
        self._nudged: set[str] = set()
        self._loop: asyncio.AbstractEventLoop | None = None     # the app's, where the tabs' queues live

    def topic(self, name: str, snapshot: Snapshot | None = None) -> None:
        """A topic tabs may subscribe to; without a snapshot they wait for the next publish."""
        self.snapshots[name] = snapshot

    def watching(self, topic: str) -> bool:
        return any(topic in c.topics for c in self.clients)

    def nudge(self, topic: str) -> None:
        """Something changed: the topic's producer (streams.keep) looks right away, not at its next round.
        Safe to call from request threads."""
        self._nudged.add(topic)

    def nudged(self, topic: str) -> bool:
        """Whether the topic was nudged since the last time this was asked."""
        if topic in self._nudged:
            self._nudged.discard(topic)
            return True
        return False

    def publish(self, topic: str, data: Any) -> None:
        """Send to every tab subscribed to the topic. From another thread (a request handler, a log line
        written there) it is handed to the app's event loop, where the tabs' queues live."""
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if self._loop is not None and running is not self._loop:
            try:
                self._loop.call_soon_threadsafe(self._publish, topic, data)
            except RuntimeError:
                pass                    # the app is shutting down
        else:
            self._publish(topic, data)

    def _publish(self, topic: str, data: Any) -> None:
        subscribers = [c for c in self.clients if topic in c.topics]
        if not subscribers:
            return
        message = encode(topic, data)       # once, whatever the number of tabs
        for client in subscribers:
            client.send(message)

    async def _snapshot(self, client: Client, topic: str) -> None:
        make = self.snapshots.get(topic)
        if make is None:
            return
        try:
            data = make()
            if inspect.isawaitable(data):
                data = await data
        except Exception:
            log.exception("snapshot of %s failed", topic)
            return
        client.send(encode(topic, data))

    async def serve(self, ws: WebSocket) -> None:
        self._loop = asyncio.get_running_loop()
        await ws.accept()
        client = Client(ws)
        self.clients.add(client)
        sender = asyncio.create_task(self._send(client))
        try:
            while True:
                message = await ws.receive_json()
                if not isinstance(message, dict):
                    continue
                for topic in message.get("unsubscribe") or []:
                    client.topics.discard(topic)
                for topic in message.get("subscribe") or []:
                    if topic in self.snapshots:
                        client.topics.add(topic)
                        await self._snapshot(client, topic)
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass                        # the tab went away, or sent something that isn't JSON
        finally:
            self.clients.discard(client)
            sender.cancel()

    async def _send(self, client: Client) -> None:
        try:
            while True:
                await client.ws.send_text(await client.queue.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception:
            log.exception("sending to a tab failed")


hub = Hub()
