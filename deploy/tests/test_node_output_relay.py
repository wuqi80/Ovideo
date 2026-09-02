import asyncio

from services.node_output_relay import (
    NodeOutputRelayRegistry,
    NodeOutputTicketRegistry,
    is_eof,
)


def test_node_output_ticket_is_short_lived_and_single_use():
    async def scenario():
        registry = NodeOutputTicketRegistry(ttl_seconds=30)
        ticket = await registry.create(
            task_id="task-1",
            output_id="output-1",
            user_id="user-1",
        )
        assert await registry.consume(ticket.token) == ticket
        assert await registry.consume(ticket.token) is None

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
