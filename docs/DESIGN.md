# effortd — Design Record

This file preserves the founding analysis (2026-08-18) so the "why" survives outside any one planning session. The V1 plan (`docs/V1-READINESS-PLAN.md`) cites these conclusions as binding constraints; changing a derived default requires new evidence (see E7 receipts), not re-litigation from vibes.

## Origin

The project descends from studying Claude Code's **auto-mode classifier** — the second model that reviews each tool call against user intent so permission prompts can be automated safely. The natural question was whether an equivalent exists for *reasoning effort* (it does not, verified against Claude Code v2.1.235: no auto/dynamic effort selection in bundle, changelog, or docs), and whether one should (mostly no — see below). effortd inherits the automode classifier's *design language* — machine-readable reasons on every decision, allow/deny-style policy lists, surfaced denials — while rejecting its pre-flight-classification shape for effort.

## The four binding conclusions

1. **Adaptive thinking absorbs most naive savings.** Current models decide per message how much to actually reason, inside the configured effort ceiling. An external router's realizable delta is the thin gap between "a high-effort model deciding this is easy" and "a low-effort model" — not the naive "max vs low" comparison.
2. **Difficulty is illegible pre-execution.** Agentic workload is discovered during execution, not read off the prompt. Pre-flight workload prediction is structurally weak; delegation-time decisions (a parent model that has *seen* the task, setting effort for sub-work) are informed and sound — which is why launcher/delegation modes remain on the backlog as legitimate shapes.
3. **Misclassification costs are asymmetric.** Over-effort → bounded wasted tokens. Under-effort → silently degraded output the user cannot attribute ("was that the model's ceiling or the router's fault?"). Systems that silently spend less on your behalf are trust hazards. Therefore: automating *escalation* is safe; automating *downgrades* is not.
4. **Cache economics punish mid-session flips.** Changing effort mid-conversation can invalidate the cached prompt prefix; in long agentic sessions one full-price re-ingest of a 100K-token prefix outweighs many messages of saved thinking tokens. (Grounding: Claude Code itself warns about cache misses on mid-session effort changes — changelog 2.1.129.)

## Derived defaults (non-negotiable without receipts)

- `mode: observe` is the default. Value delivery starts with *seeing* spend, not changing it.
- `suggest` is loud but inert — advice before authority.
- `enforce` is session-sticky and escalate-only by default. Downgrade automation exists only behind explicit config whose docs state the tradeoffs, and any default stronger than escalate-only must cite `docs/RECEIPTS.md` (E7's measured cost-vs-success curves).
- Heuristics run in-process at zero latency. **No LLM call ever sits in the request hot path** — a classification call on every message pays latency to maybe save tokens, the wrong trade for an interactive tool.

## Prime invariant

**Never break the agent.** Fail-open on every internal error; byte-transparency in observe mode; unbuffered streaming; verbatim upstream errors; no credential handling. A policy feature that cannot fail open does not ship. The gateway must be boring at the transport layer to be trusted at the policy layer.

## Where the value concentrates (positioning)

- **Normalization**: Anthropic `output_config.effort` / OpenAI `reasoning_effort`–`reasoning.effort` / Gemini thinking budgets treated as one dimension — a layer nobody ships today.
- **Agent-aware policy**: session stickiness, escalation ratchets, cache-respecting semantics — the specific things generic gateways (LiteLLM) and chat-era routers (RouteLLM) get wrong for agentic workloads.
- **Honest telemetry**: per-session effort/token/cost with coverage stated, cache tokens included.
- **Receipts**: published cost-vs-quality curves justify defaults; the eval harness is a first-class deliverable, not marketing.

Named risk: an incumbent gateway adds an effort-policy feature. Mitigation: stay the best focused layer, and ship the policy core as embeddable middleware (backlog) so incumbents become distribution, not competition.

## Audience (corrected by E0.3 verification)

The founding assumption — that subscription OAuth traffic can't route through a custom base URL — was **wrong**: Claude Code's gateway docs state that base-URL-only routing keeps a saved claude.ai login as the active credential, with gateways simply forwarding the OAuth capability in `anthropic-beta` (effortd forwards all headers verbatim, so this works by construction). Cost-exposed users (API keys, enterprise gateways, Bedrock/Vertex/Foundry) remain the primary audience — they feel effort in dollars — but subscription users get observe/suggest-mode visibility into their usage-limit burn too. This correction is itself evidence for the verify-before-code rule the plan enforces.
