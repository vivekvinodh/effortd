import { isEffort, type Effort } from "../effort.js";
import { asRecord, type EffortCapability, type ProviderAdapter } from "./types.js";

/**
 * Capability matrix per docs/PROVIDERS.md V2 (verified 2026-08-18).
 * Patterns search anywhere in the id so provider-prefixed forms match
 * ("anthropic.claude-opus-5", "us.anthropic.claude-sonnet-4-6-v1:0").
 */
const CAPABILITY_PATTERNS: Array<[RegExp, EffortCapability]> = [
  [/claude-fable-5|claude-mythos|claude-opus-5|claude-opus-4-[78]|claude-sonnet-5/, "full"],
  [/claude-opus-4-6|claude-sonnet-4-6/, "no-xhigh"],
  [/claude-opus-4-5/, "core"],
];

const INFERENCE_PATH = /^\/v1\/messages(\?.*)?$/;

function capability(model: string): EffortCapability {
  for (const [pattern, cap] of CAPABILITY_PATTERNS) {
    if (pattern.test(model)) return cap;
  }
  return "none";
}

function mapForCapability(cap: EffortCapability, desired: Effort): Effort | undefined {
  switch (cap) {
    case "full":
      return desired;
    case "no-xhigh":
      return desired === "xhigh" ? "high" : desired;
    case "core":
      return desired === "xhigh" || desired === "max" ? "high" : desired;
    case "none":
      return undefined;
  }
}

export const anthropic: ProviderAdapter = {
  name: "anthropic",
  upstream: "https://api.anthropic.com",

  isInferencePath(path) {
    return INFERENCE_PATH.test(path);
  },

  getModel(body) {
    const record = asRecord(body);
    const model = record?.["model"];
    return typeof model === "string" ? model : undefined;
  },

  readEffort(body) {
    const outputConfig = asRecord(asRecord(body)?.["output_config"]);
    const effort = outputConfig?.["effort"];
    return isEffort(effort) ? effort : undefined;
  },

  effortCapability: capability,

  planEffort(model, desired) {
    return mapForCapability(capability(model), desired);
  },

  applyEffort(body, desired) {
    const record = asRecord(body);
    if (!record) return undefined;
    const model = this.getModel(record);
    if (model === undefined) return undefined;
    const mapped = mapForCapability(capability(model), desired);
    if (mapped === undefined) return undefined;
    return {
      ...record,
      output_config: {
        ...asRecord(record["output_config"]),
        effort: mapped,
      },
    };
  },
};
