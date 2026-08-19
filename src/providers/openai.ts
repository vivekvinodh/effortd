import { isEffort, type Effort } from "../effort.js";
import { asRecord, type EffortCapability, type ProviderAdapter } from "./types.js";

/**
 * OpenAI adapter — clamp-only by policy (docs/PROVIDERS.md R1):
 * effort values are model-dependent with no published per-model matrix, so
 * effortd never injects here and only writes the conservative core
 * (low|medium|high). Sub-low values (`none`, `minimal`) are never touched.
 */

const INFERENCE_PATH = /^\/v1\/(chat\/completions|responses)(\?.*)?$/;
const CHAT_PATH = /^\/v1\/chat\/completions(\?.*)?$/;

/** Reasoning-capable families per R1: "gpt-5 and o-series models only". */
const REASONING_MODELS = /^(gpt-5|o\d)/;

function capability(model: string): EffortCapability {
  return REASONING_MODELS.test(model) ? "core" : "none";
}

function mapToCore(desired: Effort): Effort {
  return desired === "xhigh" || desired === "max" ? "high" : desired;
}

export const openai: ProviderAdapter = {
  name: "openai",
  upstream: "https://api.openai.com",

  isInferencePath(path) {
    return INFERENCE_PATH.test(path);
  },

  getModel(body) {
    const model = asRecord(body)?.["model"];
    return typeof model === "string" ? model : undefined;
  },

  readEffort(body) {
    const record = asRecord(body);
    if (!record) return undefined;
    const raw =
      asRecord(record["reasoning"])?.["effort"] ?? record["reasoning_effort"];
    // `none`/`minimal` sit below the internal scale: report absent, never touch.
    return isEffort(raw) ? raw : undefined;
  },

  effortCapability: capability,

  canInject() {
    return false;
  },

  planEffort(model, desired) {
    return capability(model) === "none" ? undefined : mapToCore(desired);
  },

  applyEffort(body, desired, path) {
    const record = asRecord(body);
    if (!record) return undefined;
    const model = this.getModel(record);
    if (model === undefined || capability(model) === "none") return undefined;
    const mapped = mapToCore(desired);
    if (path !== undefined && CHAT_PATH.test(path)) {
      return { ...record, reasoning_effort: mapped };
    }
    return {
      ...record,
      reasoning: { ...asRecord(record["reasoning"]), effort: mapped },
    };
  },
};
