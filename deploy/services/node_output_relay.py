"""In-memory back-pressured relay for node-local output downloads.

Large image-upscale outputs remain on the GPU node. The authenticated browser
opens a download on the main application, the assigned outbound Agent streams
the file into this relay, and the application forwards chunks without writing
the image to its own disk.
"""
from __future__ import annotations

import asyncio
import secrets
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional


_EOF = object()


@dataclass
class NodeOutputRelay:
    relay_id: str
    task_id: str
    output_id: str
    agent_id: str
    user_id: str
    filename: str
    mime_type: str
    size: int
    created_at: float = field(default_factory=time.monotonic)
    claimed: bool = False
    started: asyncio.Event = field(default_factory=asyncio.Event)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=8))
    error: Optional[str] = None
    closed: bool = False


class NodeOutputRelayRegistry:
    def __init__(self, ttl_seconds: int = 1800):
        self.ttl_seconds = max(60, int(ttl_seconds))
        self._items: Dict[str, NodeOutputRelay] = {}
        self._lock = asyncio.Lock()

    async def create(self, **kwargs) -> NodeOutputRelay:
        await self.cleanup()
        relay = NodeOutputRelay(relay_id=uuid.uuid4().hex, **kwargs)
        async with self._lock:
            self._items[relay.relay_id] = relay
        return relay

    async def cleanup(self) -> None:
        cutoff = time.monotonic() - self.ttl_seconds
        async with self._lock:
            stale = [key for key, relay in self._items.items() if relay.created_at < cutoff or relay.closed]
            for key in stale:
                self._items.pop(key, None)

    async def claim(self, agent_id: str) -> Optional[NodeOutputRelay]:
        await self.cleanup()
        async with self._lock:
            for relay in self._items.values():
                if relay.agent_id == agent_id and not relay.claimed and not relay.closed:
                    relay.claimed = True
                    return relay
        return None

    async def get(self, relay_id: str) -> Optional[NodeOutputRelay]:
        async with self._lock:
            return self._items.get(relay_id)

    async def start(self, relay_id: str, agent_id: str) -> NodeOutputRelay:
        relay = await self.get(relay_id)
        if relay is None or relay.closed or relay.agent_id != agent_id:
            raise KeyError(relay_id)
        relay.started.set()
        return relay

    async def put(self, relay: NodeOutputRelay, chunk: bytes) -> None:
        while not relay.closed:
            try:
                await asyncio.wait_for(relay.queue.put(chunk), timeout=1)
                return
            except asyncio.TimeoutError:
                continue
        raise RuntimeError("download relay is closed")

    async def finish(self, relay: NodeOutputRelay, error: Optional[str] = None) -> None:
        relay.error = error
        relay.started.set()
        while not relay.closed:
            try:
                await asyncio.wait_for(relay.queue.put(_EOF), timeout=1)
                return
            except asyncio.TimeoutError:
                continue

    async def close(self, relay_id: str) -> None:
        relay = await self.get(relay_id)
        if relay is not None:
            relay.closed = True


@dataclass
class NodeOutputTicket:
    token: str
    task_id: str
    output_id: str
    user_id: str
    expires_at: float


class NodeOutputTicketRegistry:
    """Short-lived, single-use browser tickets that never expose the JWT."""

    def __init__(self, ttl_seconds: int = 90):
        self.ttl_seconds = max(30, int(ttl_seconds))
        self._items: Dict[str, NodeOutputTicket] = {}
        self._lock = asyncio.Lock()

    async def create(self, *, task_id: str, output_id: str, user_id: str) -> NodeOutputTicket:
        await self.cleanup()
        ticket = NodeOutputTicket(
            token=secrets.token_urlsafe(32),
            task_id=task_id,
            output_id=output_id,
            user_id=user_id,
            expires_at=time.monotonic() + self.ttl_seconds,
        )
        async with self._lock:
            self._items[ticket.token] = ticket
        return ticket

    async def consume(self, token: str) -> Optional[NodeOutputTicket]:
        await self.cleanup()
        async with self._lock:
            ticket = self._items.pop(str(token or ""), None)
        if ticket is None or ticket.expires_at < time.monotonic():
            return None
        return ticket

    async def cleanup(self) -> None:
        now = time.monotonic()
        async with self._lock:
            stale = [key for key, item in self._items.items() if item.expires_at < now]
            for key in stale:
                self._items.pop(key, None)


registry = NodeOutputRelayRegistry()
tickets = NodeOutputTicketRegistry()


def is_eof(value: object) -> bool:
    return value is _EOF
