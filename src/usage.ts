/**
 * Token-usage extraction off the response tee (plan E4.1).
 * Must NEVER throw into the stream path: parse failures degrade to null.
 * Shapes per docs/PROVIDERS.md R2/R4/R8 + the live fixture captured 2026-08-18.
 */

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
}

export interface UsageExtractor {
  chunk(data: Buffer): void;
  final(): Usage | null;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function merge(into: Usage, patch: Partial<Usage>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (into as Record<string, unknown>)[key] = value;
  }
}

function fromAnthropicUsage(raw: unknown): Partial<Usage> {
  const usage = record(raw);
  if (!usage) return {};
  const details = record(usage["output_tokens_details"]);
  const patch: Partial<Usage> = {};
  const input = num(usage["input_tokens"]);
  const output = num(usage["output_tokens"]);
  const read = num(usage["cache_read_input_tokens"]);
  const write = num(usage["cache_creation_input_tokens"]);
  const thoughts = num(details?.["thinking_tokens"]);
  if (input !== undefined) patch.inputTokens = input;
  if (output !== undefined) patch.outputTokens = output;
  if (read !== undefined) patch.cacheReadTokens = read;
  if (write !== undefined) patch.cacheWriteTokens = write;
  if (thoughts !== undefined) patch.thoughtsTokens = thoughts;
  return patch;
}

function fromOpenAiUsage(raw: unknown): Partial<Usage> {
  const usage = record(raw);
  if (!usage) return {};
  const patch: Partial<Usage> = {};
  const promptTokens = num(usage["prompt_tokens"]) ?? num(usage["input_tokens"]);
  const completionTokens =
    num(usage["completion_tokens"]) ?? num(usage["output_tokens"]);
  const total = num(usage["total_tokens"]);
  if (promptTokens !== undefined) patch.inputTokens = promptTokens;
  if (completionTokens !== undefined) patch.outputTokens = completionTokens;
  if (total !== undefined) patch.totalTokens = total;
  return patch;
}

function fromGeminiUsage(raw: unknown): Partial<Usage> {
  const usage = record(raw);
  if (!usage) return {};
  const patch: Partial<Usage> = {};
  const prompt = num(usage["promptTokenCount"]);
  const candidates = num(usage["candidatesTokenCount"]);
  const thoughts = num(usage["thoughtsTokenCount"]);
  const cached = num(usage["cachedContentTokenCount"]);
  const total = num(usage["totalTokenCount"]);
  if (prompt !== undefined) patch.inputTokens = prompt;
  if (candidates !== undefined) patch.outputTokens = candidates;
  if (thoughts !== undefined) patch.thoughtsTokens = thoughts;
  if (cached !== undefined) patch.cacheReadTokens = cached;
  if (total !== undefined) patch.totalTokens = total;
  return patch;
}

function patchFromEvent(provider: string, event: unknown): Partial<Usage> {
  const data = record(event);
  if (!data) return {};
  if (provider === "anthropic") {
    if (data["type"] === "message_start") {
      return fromAnthropicUsage(record(data["message"])?.["usage"]);
    }
    if (data["type"] === "message_delta") {
      return fromAnthropicUsage(data["usage"]);
    }
    return fromAnthropicUsage(data["usage"]);
  }
  if (provider === "openai") {
    const direct = fromOpenAiUsage(data["usage"]);
    if (Object.keys(direct).length > 0) return direct;
    return fromOpenAiUsage(record(data["response"])?.["usage"]);
  }
  if (provider === "gemini") {
    return fromGeminiUsage(data["usageMetadata"]);
  }
  return {};
}

function patchFromJson(provider: string, body: unknown): Partial<Usage> {
  const data = record(body);
  if (!data) return {};
  if (provider === "anthropic") return fromAnthropicUsage(data["usage"]);
  if (provider === "openai") {
    const direct = fromOpenAiUsage(data["usage"]);
    if (Object.keys(direct).length > 0) return direct;
    return fromOpenAiUsage(record(data["response"])?.["usage"]);
  }
  if (provider === "gemini") return fromGeminiUsage(data["usageMetadata"]);
  return {};
}

export function createUsageExtractor(
  provider: string,
  contentType: string | null,
  options: { maxBytes?: number } = {},
): UsageExtractor {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const isSse = (contentType ?? "").startsWith("text/event-stream");
  const usage: Usage = {};
  let sawUsage = false;
  let overflowed = false;
  let jsonBuffer = "";
  let sseCarry = "";

  function absorb(patch: Partial<Usage>): void {
    if (Object.keys(patch).length === 0) return;
    sawUsage = true;
    merge(usage, patch);
  }

  function absorbSseText(text: string): void {
    const lines = text.split("\n");
    // Keep the final partial line for the next chunk.
    sseCarry = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        absorb(patchFromEvent(provider, JSON.parse(payload)));
      } catch {
        // corrupt event: skip it, keep the stream's earlier findings
      }
    }
  }

  return {
    chunk(data) {
      if (overflowed) return;
      try {
        if (isSse) {
          const text = sseCarry + data.toString("utf8");
          if (text.length > maxBytes) {
            // An SSE line longer than the cap: give up on parsing, keep prior finds.
            sseCarry = "";
            return;
          }
          absorbSseText(text);
        } else {
          jsonBuffer += data.toString("utf8");
          if (jsonBuffer.length > maxBytes) {
            overflowed = true;
            jsonBuffer = "";
          }
        }
      } catch {
        // never disturb the stream path
      }
    },
    final() {
      try {
        if (isSse && sseCarry.length > 0) absorbSseText(`${sseCarry}\n`);
        if (!isSse && !overflowed && jsonBuffer.length > 0) {
          absorb(patchFromJson(provider, JSON.parse(jsonBuffer)));
        }
      } catch {
        // fall through to whatever was collected
      }
      if (overflowed && !sawUsage) return null;
      return sawUsage ? usage : null;
    },
  };
}
