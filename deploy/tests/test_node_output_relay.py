import asyncio

from services.node_output_relay import (
    NodeOutputDeleteRegistry,
    NodeOutputRelayRegistry,
    NodeOutputTicketRegistry,
    is_eof,
)


def test_node_output_ticket_can_be_retried_during_download_ttl():
    async def scenario():
        registry = NodeOutputTicketRegistry(ttl_seconds=30)
        ticket = await registry.create(
            task_id="task-1",
            output_id="output-1",
            user_id="user-1",
        )
        assert await registry.resolve(ticket.token) == ticket
        assert await registry.resolve(ticket.token) == ticket

    asyncio.run(scenario())


def test_node_output_relay_claims_only_for_assigned_agent_and_streams_eof():
    async def scenario():
        registry = NodeOutputRelayRegistry(ttl_seconds=60)
        relay = await registry.create(
            task_id="task-1",
            output_id="output-1",
            agent_id="agent-a",
            user_id="user-1",
            filename="result.png",
            mime_type="image/png",
            size=3,
        )
        assert await registry.claim("agent-b") is None
        assert await registry.claim("agent-a") is relay
        assert await registry.claim("agent-a") is None
        await registry.start(relay.relay_id, "agent-a")
        await registry.put(relay, b"abc")
        await registry.finish(relay)
        assert await relay.queue.get() == b"abc"
        assert is_eof(await relay.queue.get())

    asyncio.run(scenario())


def test_node_output_delete_request_is_agent_scoped_and_acknowledged():
    async def scenario():
        registry = NodeOutputDeleteRegistry(ttl_seconds=60)
        request = await registry.create(output_id="output-1", agent_id="agent-a")
        assert await registry.claim("agent-b") is None
        assert await registry.claim("agent-a") is request
        assert await registry.claim("agent-a") is None

        completed = await registry.finish(
            request.request_id,
            "agent-a",
            success=True,
            freed_bytes=456,
        )
        assert completed.completed.is_set()
        assert completed.success is True
        assert completed.freed_bytes == 456

    asyncio.run(scenario())
