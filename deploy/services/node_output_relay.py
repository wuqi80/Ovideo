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
    """Short-lived browser tickets that never expose the JWT.

    Download managers commonly probe a URL before opening the real transfer.
    Keep a ticket reusable during its small TTL so that a disconnected probe
    does not turn the user's immediate retry into a 401 response.
    """

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

    async def resolve(self, token: str) -> Optional[NodeOutputTicket]:
        await self.cleanup()
        async with self._lock:
            ticket = self._items.get(str(token or ""))
        if ticket is None or ticket.expires_at < time.monotonic():
            return None
        return ticket

    async def cleanup(self) -> None:
        now = time.monotonic()
        async with self._lock:
            stale = [key for key, item in self._items.items() if item.expires_at < now]
            for key in stale:
                self._items.pop(key, None)


@dataclass
class NodeOutputDeleteRequest:
    request_id: str
    output_id: str
    agent_id: str
    created_at: float = field(default_factory=time.monotonic)
    claimed: bool = False
    completed: asyncio.Event = field(default_factory=asyncio.Event)
    success: bool = False
    freed_bytes: int = 0
    error: Optional[str] = None


class NodeOutputDeleteRegistry:
    """Outbound delete requests for files retained behind a GPU Agent."""

    def __init__(self, ttl_seconds: int = 180):
        self.ttl_seconds = max(60, int(ttl_seconds))
        self._items: Dict[str, NodeOutputDeleteRequest] = {}
        self._lock = asyncio.Lock()

    async def create(self, *, output_id: str, agent_id: str) -> NodeOutputDeleteRequest:
        await self.cleanup()
        request = NodeOutputDeleteRequest(
            request_id=uuid.uuid4().hex,
            output_id=output_id,
            agent_id=agent_id,
        )
        async with self._lock:
            self._items[request.request_id] = request
        return request

    async def claim(self, agent_id: str) -> Optional[NodeOutputDeleteRequest]:
        await self.cleanup()
        async with self._lock:
            for request in self._items.values():
                if request.agent_id == agent_id and not request.claimed and not request.completed.is_set():
                    request.claimed = True
                    return request
        return None

    async def finish(
        self,
        request_id: str,
        agent_id: str,
        *,
        success: bool,
        freed_bytes: int = 0,
        error: Optional[str] = None,
    ) -> NodeOutputDeleteRequest:
        async with self._lock:
            request = self._items.get(request_id)
            if request is None or request.agent_id != agent_id:
                raise KeyError(request_id)
            request.success = bool(success)
            request.freed_bytes = max(0, int(freed_bytes or 0))
            request.error = str(error or "").strip() or None
            request.completed.set()
            return request

    async def close(self, request_id: str) -> None:
        async with self._lock:
            self._items.pop(request_id, None)

    async def cleanup(self) -> None:
        cutoff = time.monotonic() - self.ttl_seconds
        async with self._lock:
            stale = [
                key
                for key, request in self._items.items()
                if request.created_at < cutoff or request.completed.is_set()
            ]
            for key in stale:
                self._items.pop(key, None)


registry = NodeOutputRelayRegistry()
tickets = NodeOutputTicketRegistry()
deletions = NodeOutputDeleteRegistry()


def is_eof(value: object) -> bool:
    return value is _EOF
