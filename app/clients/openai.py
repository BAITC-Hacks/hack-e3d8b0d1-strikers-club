"""Stateless Responses API transport. No Files API or provider conversation storage."""

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings
from app.core.exceptions import IntegrationNotConfigured, UpstreamUnavailable


@dataclass(frozen=True, slots=True)
class ToolCall:
    name: str
    arguments: str
    call_id: str


@dataclass(frozen=True, slots=True)
class ResponseTurn:
    output: list[dict[str, Any]]
    text: str
    calls: list[ToolCall]


class OpenAIResponsesClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self.http = http
        self.settings = settings

    async def respond(
        self,
        input_items: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        instructions: str = "",
        text_format: dict[str, Any] | None = None,
    ) -> ResponseTurn:
        key = self.settings.openai_api_key
        if key is None or not key.get_secret_value():
            raise IntegrationNotConfigured("OPENAI_API_KEY is not configured.")
        payload: dict[str, Any] = {
            "model": self.settings.openai_model,
            "input": input_items,
            "instructions": instructions,
            "store": False,
            "reasoning": {"effort": self.settings.openai_reasoning_effort},
            "max_output_tokens": self.settings.openai_max_output_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["parallel_tool_calls"] = False
            payload["include"] = ["reasoning.encrypted_content"]
            if any(tool.get("type") == "web_search" for tool in tools):
                payload["include"].append("web_search_call.action.sources")
        if text_format:
            payload["text"] = {"format": text_format}
        try:
            encoded_payload = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(
                "utf-8"
            )
            if len(encoded_payload) > self.settings.openai_max_request_bytes:
                raise UpstreamUnavailable("The conversation exceeds the provider request limit.")
            async with self.http.stream(
                "POST",
                f"{self.settings.openai_api_base_url}/responses",
                headers={
                    "Authorization": f"Bearer {key.get_secret_value()}",
                    "Content-Type": "application/json",
                },
                content=encoded_payload,
                timeout=self.settings.openai_timeout_seconds,
                follow_redirects=False,
            ) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self.settings.upstream_max_response_bytes:
                        raise UpstreamUnavailable()
            data = json.loads(body)
            if not isinstance(data, dict) or data.get("status") != "completed":
                raise UpstreamUnavailable()
            output = data.get("output")
            if not isinstance(output, list) or not all(isinstance(item, dict) for item in output):
                raise UpstreamUnavailable()
            calls: list[ToolCall] = []
            text: list[str] = []
            for item in output:
                if item.get("type") == "function_call":
                    if not all(
                        isinstance(item.get(k), str) and item[k].strip()
                        for k in ("name", "arguments", "call_id")
                    ):
                        raise UpstreamUnavailable()
                    calls.append(ToolCall(item["name"], item["arguments"], item["call_id"]))
                if item.get("type") == "message":
                    for content in item.get("content", []):
                        if content.get("type") == "output_text":
                            if not isinstance(content.get("text"), str):
                                raise UpstreamUnavailable()
                            text.append(content["text"])
                        elif content.get("type") == "refusal":
                            text.append("Не могу обработать этот запрос. Уточните вопрос о товаре.")
            if len(calls) > self.settings.chat_max_tool_calls or (
                not calls and not any(part.strip() for part in text)
            ):
                raise UpstreamUnavailable()
            if len({call.call_id for call in calls}) != len(calls):
                raise UpstreamUnavailable()
            return ResponseTurn(output=output, text="\n".join(text), calls=calls)
        except (
            httpx.HTTPError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            RecursionError,
        ) as error:
            raise UpstreamUnavailable() from error
