import type { Effort } from "../effort.js";

/**
 * Per-provider capability classes for the effort field:
 * - "full": all five internal levels supported natively
 * - "no-xhigh": xhigh unsupported (maps down to high)
 * - "core": only low|medium|high supported (xhigh|max map to high)
 * - "none": the model must never be touched (writing would 400 — PROVIDERS.md V3)
 */
export type EffortCapability = "full" | "no-xhigh" | "core" | "none";

export interface ProviderAdapter {
  name: string;
  /** Upstream origin this adapter's mount forwards to by default. */
  upstream: string;
  /** True for request paths (path + query, mount stripped) that carry inference bodies. */
  isInferencePath(path: string): boolean;
  /** Model id from body and/or path; undefined when absent/unparseable. */
  getModel(body: unknown, path?: string): string | undefined;
  /** The request's current effort, normalized to the internal scale; undefined when absent or sub-low. */
  readEffort(body: unknown): Effort | undefined;
  effortCapability(model: string): EffortCapability;
  /**
   * Whether policy may INJECT an effort field this request didn't carry.
   * Clamp-only providers return false for every model (see docs/PROVIDERS.md
   * mapper policy); clamping a value that is already present only needs
   * planEffort/applyEffort.
   */
  canInject(model: string): boolean;
  /**
   * The value that would actually be written for `desired` on `model`
   * (capability-mapped), or undefined when the model must not be touched.
   */
  planEffort(model: string, desired: Effort): Effort | undefined;
  /**
   * Immutably apply `desired` (capability-mapped) to the body; undefined when
   * the model must not be touched. Never mutates the input.
   */
  applyEffort(body: unknown, desired: Effort, path?: string): unknown | undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
