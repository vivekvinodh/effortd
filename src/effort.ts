/**
 * The internal reasoning-effort scale, aligned to Anthropic's five levels.
 * Other providers map into (and out of) this scale in their adapters;
 * sub-`low` provider values (OpenAI `none`/`minimal`, Gemini `minimal`)
 * are deliberately left untouched by policy — see docs/PROVIDERS.md.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORT_LEVELS)[number];

const RANKS = new Map<string, number>(
  EFFORT_LEVELS.map((level, index) => [level, index]),
);

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && RANKS.has(value);
}

export function effortRank(level: Effort): number {
  return RANKS.get(level)!;
}

export function clampEffort(
  level: Effort,
  floor: Effort | undefined,
  ceiling: Effort | undefined,
): Effort {
  let rank = effortRank(level);
  if (floor !== undefined) rank = Math.max(rank, effortRank(floor));
  if (ceiling !== undefined) rank = Math.min(rank, effortRank(ceiling));
  return EFFORT_LEVELS[rank]!;
}

export function maxEffort(a: Effort, b: Effort): Effort {
  return effortRank(a) >= effortRank(b) ? a : b;
}
