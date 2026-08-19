import type { Effort } from "./effort.js";

/**
 * Zero-latency, in-process opener heuristics (plan E5.1). Deliberately crude:
 * these produce *suggestions* (inert by default) and, at most, one-way
 * escalations (E5.2). No LLM ever sits in the request hot path (§10).
 * Hard beats trivial — under-effort is the expensive failure (DESIGN.md).
 */

export interface SuggestionResult {
  suggested: Effort;
  signals: string[];
}

const TRIVIAL =
  /\b(typo|rename|bump|format(ter|ting)?|lint(er)?|reword|rephrase|whitespace|spacing|comment|readme|changelog|indent|semicolon|import order|unused import)\b/i;

const HARD =
  /\b(debug|deadlock|race(\s+condition)?|memory (leak|usage|growth)|architect(ure)?|design|migrat(e|ion)|refactor|investigat(e|ion)|root[\s-]?cause|optimi[sz]e|why (is|does|do|isn'?t|doesn'?t)|intermittent|flaky|concurren(t|cy)|performance|regression|security|audit)\b/i;

const LONG_OPENER_CHARS = 1500;
const CODE_FENCE = /```/g;

export function suggestEffort(openerText: string): SuggestionResult | undefined {
  const text = openerText.trim();
  if (text === "") return undefined;

  const signals: string[] = [];
  if (HARD.test(text)) signals.push("hard-signal keyword");
  if (text.length > LONG_OPENER_CHARS) signals.push("long opener");
  const fences = text.match(CODE_FENCE)?.length ?? 0;
  if (fences >= 4) signals.push("code-heavy opener");
  if (signals.length > 0) return { suggested: "xhigh", signals };

  if (TRIVIAL.test(text) && text.length <= 200) {
    return { suggested: "low", signals: ["trivial-verb opener"] };
  }
  return undefined;
}
