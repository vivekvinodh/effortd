import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { effortRank, isEffort, type Effort } from "./effort.js";

export type Mode = "observe" | "suggest" | "enforce";

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export interface EffortdConfig {
  mode: Mode;
  defaultEffort?: Effort;
  floor?: Effort;
  ceiling?: Effort;
  sessionSticky: boolean;
  escalateOnly: boolean;
  inject: boolean;
  suggest: { enabled: boolean; escalateOnSuggestion: boolean };
  pricing: Record<string, ModelPricing>;
  port: number;
}

export const DEFAULT_CONFIG: EffortdConfig = {
  mode: "observe",
  sessionSticky: true,
  escalateOnly: true,
  inject: false,
  suggest: { enabled: true, escalateOnSuggestion: false },
  pricing: {},
  port: 4141,
};

export class ConfigError extends Error {}

const MODES = new Set<string>(["observe", "suggest", "enforce"]);
const TOP_KEYS = new Set([
  "mode",
  "default",
  "floor",
  "ceiling",
  "session_sticky",
  "escalate_only",
  "inject",
  "suggest",
  "pricing",
  "port",
]);
const SUGGEST_KEYS = new Set(["enabled", "escalate_on_suggestion"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function effortField(
  record: Record<string, unknown>,
  key: string,
): Effort | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (!isEffort(value)) {
    throw new ConfigError(
      `${key}: ${JSON.stringify(value)} is not an effort level (low|medium|high|xhigh|max)`,
    );
  }
  return value;
}

function boolField(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new ConfigError(`${key}: expected true or false`);
  }
  return value;
}

export function parseConfig(text: string): {
  config: EffortdConfig;
  warnings: string[];
} {
  const parsed: unknown = text.trim() === "" ? {} : parseYaml(text);
  const root = asRecord(parsed) ?? {};
  const warnings: string[] = [];

  for (const key of Object.keys(root)) {
    if (!TOP_KEYS.has(key)) {
      warnings.push(`unknown config key "${key}" — ignored (typo?)`);
    }
  }

  const mode = root["mode"] ?? DEFAULT_CONFIG.mode;
  if (typeof mode !== "string" || !MODES.has(mode)) {
    throw new ConfigError(
      `mode: ${JSON.stringify(mode)} is not one of observe|suggest|enforce`,
    );
  }

  const floor = effortField(root, "floor");
  const ceiling = effortField(root, "ceiling");
  if (floor && ceiling && effortRank(floor) > effortRank(ceiling)) {
    throw new ConfigError(
      `floor (${floor}) is above ceiling (${ceiling}) — swap them`,
    );
  }

  const portRaw = root["port"] ?? DEFAULT_CONFIG.port;
  const port = typeof portRaw === "number" ? portRaw : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`port: ${JSON.stringify(portRaw)} is not a valid TCP port`);
  }

  const suggestRecord = asRecord(root["suggest"]) ?? {};
  for (const key of Object.keys(suggestRecord)) {
    if (!SUGGEST_KEYS.has(key)) {
      warnings.push(`unknown config key "suggest.${key}" — ignored (typo?)`);
    }
  }

  const pricing: Record<string, ModelPricing> = {};
  const pricingRecord = asRecord(root["pricing"]) ?? {};
  for (const [model, entry] of Object.entries(pricingRecord)) {
    const record = asRecord(entry);
    const input = record?.["input"];
    const output = record?.["output"];
    if (
      typeof input !== "number" ||
      typeof output !== "number" ||
      input < 0 ||
      output < 0
    ) {
      throw new ConfigError(
        `pricing.${model}: expected { input: <usd per MTok>, output: <usd per MTok> }`,
      );
    }
    pricing[model] = { input, output };
  }

  const config: EffortdConfig = {
    mode: mode as Mode,
    sessionSticky: boolField(root, "session_sticky", DEFAULT_CONFIG.sessionSticky),
    escalateOnly: boolField(root, "escalate_only", DEFAULT_CONFIG.escalateOnly),
    inject: boolField(root, "inject", DEFAULT_CONFIG.inject),
    suggest: {
      enabled: boolField(suggestRecord, "enabled", DEFAULT_CONFIG.suggest.enabled),
      escalateOnSuggestion: boolField(
        suggestRecord,
        "escalate_on_suggestion",
        DEFAULT_CONFIG.suggest.escalateOnSuggestion,
      ),
    },
    pricing,
    port,
  };
  const defaultEffort = effortField(root, "default");
  if (defaultEffort !== undefined) config.defaultEffort = defaultEffort;
  if (floor !== undefined) config.floor = floor;
  if (ceiling !== undefined) config.ceiling = ceiling;
  return { config, warnings };
}

export function configSearchPaths(cwd: string): string[] {
  return [join(cwd, "effortd.yaml"), join(homedir(), ".effortd", "config.yaml")];
}

export function loadConfig(cwd: string = process.cwd()): {
  config: EffortdConfig;
  warnings: string[];
  source: string;
} {
  for (const path of configSearchPaths(cwd)) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { config, warnings } = parseConfig(text);
    return { config, warnings, source: path };
  }
  return { config: DEFAULT_CONFIG, warnings: [], source: "defaults" };
}

/** The commented reference config `effortd init` writes. Must parse warning-free to DEFAULT_CONFIG. */
export function exampleConfig(): string {
  return `# effortd configuration — https://github.com/vivekvinodh/effortd
# Every key is optional; the values below are the defaults.

# The mode ladder (docs/DESIGN.md):
#   observe — byte-identical forwarding; telemetry only. The default.
#   suggest — observe, plus logged suggestions and what-if accounting. Never mutates.
#   enforce — applies the policy below. Sticky + escalate-only by default.
mode: observe

# Clamp bounds for enforce mode (internal scale: low|medium|high|xhigh|max).
# floor raises requests below it; ceiling caps requests above it.
# floor: low
# ceiling: max

# Injected when a request carries no effort field, ONLY if inject is true and
# the model is on the verified allowlist (docs/PROVIDERS.md). Providers marked
# clamp-only (OpenAI) are never injected regardless.
# default: high
inject: false

# A session's effort never silently changes mid-conversation (cache churn +
# trust — docs/DESIGN.md conclusion 4). Escalate-only additionally means it can
# rise but never fall while the session lives.
session_sticky: true
escalate_only: true

suggest:
  # Log heuristic suggestions and count them in reports (inert).
  enabled: true
  # In enforce mode, allow a hard-signal suggestion to RAISE the session's
  # effort toward the ceiling (one-way ratchet; lands in E5.2). Never lowers.
  escalate_on_suggestion: false

# Cost estimates use bundled dated defaults; override per model id here.
# Prices are USD per million tokens and are ESTIMATES, not billing truth.
# pricing:
#   claude-opus-5: { input: 5, output: 25 }

port: 4141
`;
}
