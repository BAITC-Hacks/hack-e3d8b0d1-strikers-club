import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.clients.openai import OpenAIResponsesClient
from app.core.config import Settings
from app.core.exceptions import IntegrationNotConfigured, UpstreamUnavailable


def settings(**overrides: object) -> Settings:
    data: dict[str, object] = {
        "api_key": SecretStr("test-api-key-with-at-least-32-characters"),
        "openai_api_key": SecretStr("test-openai-key"),
    }
    data.update(overrides)
    return Settings.model_validate(data)


async def test_stateless_responses_preserve_reasoning_tool_calls_and_exact_model() -> None:
    inputs = [{"role": "user", "content": "Найди кабель"}]
    output = [
        {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque", "summary": []},
        {
            "type": "function_call",
            "name": "find_products",
            "arguments": '{"query":"кабель"}',
            "call_id": "call_1",
        },
    ]
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        assert request.headers["authorization"] == "Bearer test-openai-key"
        assert request.headers["content-type"] == "application/json"
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"status": "completed", "output": output})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = OpenAIResponsesClient(http, settings())
        result = await client.respond(inputs, tools=[{"type": "function", "name": "find_products"}])
    assert result.output == output
    assert result.calls[0].call_id == "call_1"
    assert result.calls[0].arguments == '{"query":"кабель"}'
    assert seen[0]["store"] is False
    assert seen[0]["model"] == "gpt-5.6-luna"
    assert seen[0]["input"] == inputs
    assert "previous_response_id" not in seen[0]
    assert "reasoning.encrypted_content" in seen[0]["include"]
    assert seen[0]["parallel_tool_calls"] is False


async def test_structured_output_and_web_search_sources_are_requested() -> None:
    sent: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "{}"}]}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await OpenAIResponsesClient(http, settings()).respond(
            [],
            tools=[{"type": "web_search"}],
            text_format={"type": "json_schema", "name": "result", "strict": True, "schema": {}},
        )
    assert result.text == "{}"
    assert sent["text"]["format"]["name"] == "result"
    assert "web_search_call.action.sources" in sent["include"]


@pytest.mark.parametrize(
    "output",
    [
        [],
        None,
        ["malformed"],
        [{"type": "message", "content": None}],
        [{"type": "message", "content": ["bad"]}],
        [{"type": "message", "content": [{"type": "output_text", "text": 23}]}],
        [{"type": "message", "content": [{"type": "output_text", "text": "   "}]}],
        [{"type": "function_call", "name": "find", "arguments": "{}"}],
        [{"type": "function_call", "name": "", "arguments": "{}", "call_id": "a"}],
        [{"type": "function_call", "name": "find", "arguments": "{}", "call_id": "same"}] * 2,
    ],
)
async def test_malformed_provider_outputs_raise_sanitized_error(output: object) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"status": "completed", "output": output})
        )
    ) as http:
        with pytest.raises(UpstreamUnavailable):
            await OpenAIResponsesClient(http, settings()).respond([])


@pytest.mark.parametrize("status", [301, 401, 429, 500])
async def test_provider_failures_never_retry_or_follow_redirects(status: int) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, headers={"Location": "https://evil.example/"}, text="secret")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(UpstreamUnavailable) as raised:
            await OpenAIResponsesClient(http, settings()).respond([])
    assert calls == 1
    assert "secret" not in str(raised.value)


async def test_unconfigured_provider_and_oversized_input_do_not_send_http() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("No request expected")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(IntegrationNotConfigured):
            await OpenAIResponsesClient(http, settings(openai_api_key=None)).respond([])
        with pytest.raises(UpstreamUnavailable):
            await OpenAIResponsesClient(http, settings(openai_max_request_bytes=1024)).respond(
                [{"role": "user", "content": "x" * 2048}]
            )


class TrackingStream(httpx.AsyncByteStream):
    closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"x" * 2048

    async def aclose(self) -> None:
        self.closed = True


async def test_oversized_provider_output_closes_stream() -> None:
    stream = TrackingStream()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
    ) as http:
        with pytest.raises(UpstreamUnavailable):
            await OpenAIResponsesClient(http, settings(upstream_max_response_bytes=1024)).respond(
                []
            )
    assert stream.closed


async def test_incomplete_provider_response_is_never_published() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "status": "incomplete",
                    "output": [
                        {
                            "type": "message",
                            "content": [{"type": "output_text", "text": "Partial facts"}],
                        }
                    ],
                },
            )
        )
    ) as http:
        with pytest.raises(UpstreamUnavailable):
            await OpenAIResponsesClient(http, settings()).respond([])
