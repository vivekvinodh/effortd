import { isEffort, type Effort } from "../effort.js";
import { asRecord, type EffortCapability, type ProviderAdapter } from "./types.js";

/**
 * Gemini adapter — thinkingLevel-first per docs/PROVIDERS.md R3 (E0.3
 * correction): writes only `thinkingConfig.thinkingLevel` in the conservative
 * core (low|medium|high), only on guide-matrix models. Budget-style requests
 * (`thinkingBudget`) are observe-only in v1 — numeric ranges are model-
 * dependent and unverified, so effortd never rewrites them. Sub-low
 * (`minimal`) is never touched.
 */

const INFERENCE_PATH =
  /^\/(v1beta|v1)\/models\/[^:/]+:(generateContent|streamGenerateContent)(\?.*)?$/;

const MODEL_FROM_PATH = /^\/(?:v1beta|v1)\/models\/([^:/]+):/;

/** Guide matrix models (ai.google.dev thinking guide, 2026-08-18). */
const MATRIX_MODELS = /^gemini-(3\.\d+-flash(-lite)?|2\.5-(pro|flash(-lite)?))/;

function capability(model: string): EffortCapability {
  return MATRIX_MODELS.test(model) ? "core" : "none";
}

function mapToCore(desired: Effort): Effort {
  return desired === "xhigh" || desired === "max" ? "high" : desired;
}

function thinkingConfigOf(body: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(asRecord(body)?.["generationConfig"])?.["thinkingConfig"]);
}

export const gemini: ProviderAdapter = {
  name: "gemini",
  upstream: "https://generativelanguage.googleapis.com",

  isInferencePath(path) {
    return INFERENCE_PATH.test(path);
  },

  getModel(_body, path) {
    if (path === undefined) return undefined;
    const match = MODEL_FROM_PATH.exec(path);
    return match?.[1];
  },

  readEffort(body) {
    const thinking = thinkingConfigOf(body);
    if (!thinking) return undefined;
    if (typeof thinking["thinkingBudget"] === "number") return undefined;
    const level = thinking["thinkingLevel"];
    // "minimal" is sub-low: report absent, never touch.
    return isEffort(level) ? level : undefined;
  },

  effortCapability: capability,

  canInject(model) {
    return capability(model) !== "none";
  },

  planEffort(model, desired) {
    return capability(model) === "none" ? undefined : mapToCore(desired);
  },

  applyEffort(body, desired, path) {
    const record = asRecord(body);
    if (!record || path === undefined) return undefined;
    const model = this.getModel(record, path);
    if (model === undefined || capability(model) === "none") return undefined;
    const thinking = thinkingConfigOf(record);
    if (thinking && typeof thinking["thinkingBudget"] === "number") {
      return undefined; // budget-style requests are observe-only
    }
    const generationConfig = asRecord(record["generationConfig"]);
    return {
      ...record,
      generationConfig: {
        ...generationConfig,
        thinkingConfig: { ...thinking, thinkingLevel: mapToCore(desired) },
      },
    };
  },
};
