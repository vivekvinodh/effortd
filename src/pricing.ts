import type { ModelPricing } from "./config.js";
import type { Usage } from "./usage.js";

export type { ModelPricing } from "./config.js";

/**
 * Dated LIST-PRICE estimates (USD per MTok), Anthropic 2026-08 — the only
 * provider whose current prices were verified this cycle. Everything else is
 * deliberately absent: unknown models report `cost: null` + `unpriced`, never
 * a fabricated $0 (plan §1 pricing honesty). Override any model via config
 * `pricing:`.
 */
export const DEFAULT_PRICES: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Anthropic cache economics: reads ~0.1× input rate, writes ~1.25×. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(
  model: string,
  overrides: Record<string, ModelPricing>,
): ModelPricing | undefined {
  const table = { ...DEFAULT_PRICES, ...overrides };
  if (table[model]) return table[model];
  // Provider-prefixed ids ("us.anthropic.claude-opus-5-v1:0") contain the bare id.
  for (const [key, price] of Object.entries(table)) {
    if (model.includes(key)) return price;
  }
  return undefined;
}

export function estimateCostUsd(usage: Usage, pricing: ModelPricing): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return (
    (input * pricing.input +
      output * pricing.output +
      cacheRead * CACHE_READ_MULTIPLIER * pricing.input +
      cacheWrite * CACHE_WRITE_MULTIPLIER * pricing.input) /
    1e6
  );
}
