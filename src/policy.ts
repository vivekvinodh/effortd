import {
  clampEffort,
  effortRank,
  maxEffort,
  type Effort,
} from "./effort.js";
import type { Mode } from "./config.js";

/**
 * The pure decision core — the project's money logic (plan E3.2).
 * No I/O, no provider knowledge: capability mapping happens in adapters,
 * wiring in the pipeline. Every decision explains itself (`reason`), echoing
 * the automode classifier's surfaced-reasons design language.
 */

export type DecisionAction =
  | "untouched"
  | "clamped"
  | "injected"
  | "sticky-held"
  | "escalated";

export interface DecisionInput {
  mode: Mode;
  floor?: Effort;
  ceiling?: Effort;
  /** Injected when the request has no effort, `inject` is on, and the adapter allows it. */
  defaultEffort?: Effort;
  inject: boolean;
  sessionSticky: boolean;
  escalateOnly: boolean;
  /** Adapter verdict for this model (clamp-only providers report false). */
  canInject: boolean;
  requestedEffort?: Effort;
  sessionEffort?: Effort;
  suggestion?: Effort;
  escalateOnSuggestion?: boolean;
}

export interface Decision {
  /** Value to write (enforce mode only); undefined = leave the request alone. */
  applied?: Effort;
  /** In observe/suggest: what enforce would have written. */
  wouldHave?: Effort;
  action: DecisionAction;
  reason: string;
  /** Sticky state to persist for the session (tracks actuals in observe/suggest). */
  sessionEffortNext?: Effort;
}

export function decide(input: DecisionInput): Decision {
  const requested = input.requestedEffort;
  const injectionAllowed = input.inject && input.canInject;
  const base = requested ?? (injectionAllowed ? input.defaultEffort : undefined);

  if (base === undefined) {
    const why =
      requested === undefined
        ? input.inject
          ? input.canInject
            ? "no effort field and no default configured"
            : "no effort field; injection not permitted for this model"
          : "no effort field; injection disabled"
        : "no effort field";
    const decision: Decision = { action: "untouched", reason: why };
    if (input.sessionEffort !== undefined) {
      decision.sessionEffortNext = input.sessionEffort;
    }
    return decision;
  }

  const notes: string[] = [];
  let action: DecisionAction = "untouched";
  let candidate = base;

  if (
    input.escalateOnSuggestion === true &&
    input.suggestion !== undefined &&
    effortRank(input.suggestion) > effortRank(candidate)
  ) {
    notes.push(`suggestion raised ${candidate}→${input.suggestion}`);
    candidate = input.suggestion;
    action = "escalated";
  }

  const clamped = clampEffort(candidate, input.floor, input.ceiling);
  if (clamped !== candidate) {
    notes.push(
      effortRank(clamped) > effortRank(candidate)
        ? `raised to floor ${input.floor}`
        : `capped at ceiling ${input.ceiling}`,
    );
    candidate = clamped;
    if (action === "untouched") action = "clamped";
  }

  let final = candidate;
  const session = input.sessionEffort;
  if (input.sessionSticky && session !== undefined) {
    const pinned = clampEffort(session, input.floor, input.ceiling);
    if (input.escalateOnly) {
      if (effortRank(final) > effortRank(session)) {
        notes.push(`session escalated ${session}→${final}`);
        action = "escalated";
      } else if (effortRank(final) < effortRank(pinned)) {
        notes.push(`held at session level ${pinned}`);
        final = pinned;
        action = "sticky-held";
      }
    } else if (final !== pinned) {
      notes.push(`held at session level ${pinned}`);
      final = pinned;
      action = "sticky-held";
    }
  }

  const needsWrite = requested === undefined || final !== requested;
  if (requested === undefined && (action === "untouched" || action === "clamped")) {
    action = "injected";
    notes.unshift(`injected default ${input.defaultEffort}`);
  }
  if (!needsWrite && action === "untouched") {
    notes.push(`requested ${requested} within policy; unchanged`);
  }

  const sessionEffortNext =
    input.mode === "enforce"
      ? input.sessionSticky && input.escalateOnly && session !== undefined
        ? maxEffort(session, final)
        : final
      : requested ?? session;

  const decision: Decision = {
    action,
    reason: notes.join("; ") || `requested ${requested ?? "nothing"}; unchanged`,
  };
  if (sessionEffortNext !== undefined) {
    decision.sessionEffortNext = sessionEffortNext;
  }
  if (needsWrite) {
    if (input.mode === "enforce") decision.applied = final;
    else decision.wouldHave = final;
  }
  return decision;
}
