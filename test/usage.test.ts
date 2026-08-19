import { describe, expect, it } from "vitest";
import { createUsageExtractor } from "../src/usage.js";

/**
 * Anthropic SSE shapes captured LIVE through the gateway (2026-08-18,
 * subscription traffic, content scrubbed — token counts are real).
 * Confirms PROVIDERS.md R8: input + cache fields in message_start,
 * cumulative output in message_delta, final delta carries full usage.
 */
const ANTHROPIC_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_x","type":"message","role":"assistant","content":[],"model":"claude-fable-5","usage":{"input_tokens":2,"cache_creation_input_tokens":17234,"cache_read_input_tokens":53643,"output_tokens":1,"service_tier":"standard"}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"[scrubbed]"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":2,"cache_creation_input_tokens":17234,"cache_read_input_tokens":53643,"output_tokens":4,"output_tokens_details":{"thinking_tokens":0}}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join("\n");

function feed(
  provider: string,
  contentType: string,
  payload: string | string[],
) {
  const extractor = createUsageExtractor(provider, contentType);
  const chunks = Array.isArray(payload) ? payload : [payload];
  for (const chunk of chunks) extractor.chunk(Buffer.from(chunk, "utf8"));
  return extractor.final();
}

describe("E4.1 usage extraction", () => {
  it("parses the live-captured anthropic SSE stream", () => {
    const usage = feed("anthropic", "text/event-stream", ANTHROPIC_SSE);
    expect(usage).toEqual({
      inputTokens: 2,
      outputTokens: 4, // cumulative final value, not the message_start seed
      cacheReadTokens: 53643,
      cacheWriteTokens: 17234,
      thoughtsTokens: 0,
    });
  });

  it("survives chunk boundaries mid-line", () => {
    const chunks = [
      ANTHROPIC_SSE.slice(0, 97),
      ANTHROPIC_SSE.slice(97, 411),
      ANTHROPIC_SSE.slice(411),
    ];
    const usage = feed("anthropic", "text/event-stream", chunks);
    expect(usage?.outputTokens).toBe(4);
    expect(usage?.cacheReadTokens).toBe(53643);
  });

  it("parses anthropic non-streaming JSON", () => {
    const usage = feed(
      "anthropic",
      "application/json",
      JSON.stringify({
        id: "msg",
        usage: {
          input_tokens: 100,
          output_tokens: 42,
          cache_read_input_tokens: 9,
          cache_creation_input_tokens: 3,
        },
      }),
    );
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 42,
      cacheReadTokens: 9,
      cacheWriteTokens: 3,
    });
  });

  it("parses the openai chat final usage chunk (include_usage)", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"[scrubbed]"}}],"usage":null}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const usage = feed("openai", "text/event-stream", sse);
    expect(usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  });

  it("parses openai responses shapes (JSON and completed event)", () => {
    expect(
      feed(
        "openai",
        "application/json",
        JSON.stringify({ usage: { input_tokens: 5, output_tokens: 9 } }),
      ),
    ).toEqual({ inputTokens: 5, outputTokens: 9 });

    const sse = [
      'data: {"type":"response.output_text.delta","delta":"[scrubbed]"}',
      "",
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":21,"output_tokens":13}}}',
      "",
    ].join("\n");
    expect(feed("openai", "text/event-stream", sse)).toEqual({
      inputTokens: 21,
      outputTokens: 13,
    });
  });

  it("parses gemini usageMetadata (JSON and streaming, last chunk wins)", () => {
    const meta = {
      promptTokenCount: 8,
      candidatesTokenCount: 6,
      thoughtsTokenCount: 4,
      cachedContentTokenCount: 2,
      totalTokenCount: 18,
    };
    expect(
      feed("gemini", "application/json", JSON.stringify({ usageMetadata: meta })),
    ).toEqual({
      inputTokens: 8,
      outputTokens: 6,
      thoughtsTokens: 4,
      cacheReadTokens: 2,
      totalTokens: 18,
    });

    const sse = [
      'data: {"candidates":[{}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":1}}',
      "",
      `data: ${JSON.stringify({ candidates: [{}], usageMetadata: meta })}`,
      "",
    ].join("\n");
    expect(feed("gemini", "text/event-stream", sse)?.outputTokens).toBe(6);
  });

  it("never throws on corrupt streams — reports what it saw or null", () => {
    const corrupt = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":1}}}',
      "",
      "data: {broken json{{{",
      "",
    ].join("\n");
    const usage = feed("anthropic", "text/event-stream", corrupt);
    expect(usage?.inputTokens).toBe(3);

    expect(feed("anthropic", "application/json", "not json at all")).toBeNull();
  });

  it("gives up cleanly past the accumulation cap", () => {
    const extractor = createUsageExtractor("anthropic", "application/json", {
      maxBytes: 64,
    });
    extractor.chunk(Buffer.from("x".repeat(100)));
    expect(extractor.final()).toBeNull();
  });

  it("returns null when no usage ever appears", () => {
    expect(feed("anthropic", "application/json", "{}")).toBeNull();
    expect(feed("openai", "text/event-stream", "data: [DONE]\n\n")).toBeNull();
  });
});
