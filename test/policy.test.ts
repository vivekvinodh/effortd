import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS, effortRank, type Effort } from "../src/effort.js";
import { decide, type DecisionInput } from "../src/policy.js";

function base(overrides: Partial<DecisionInput>): DecisionInput {
  return {
    mode: "enforce",
    inject: false,
    sessionSticky: true,
    escalateOnly: true,
    canInject: true,
    ...overrides,
  };
}

describe("E3.2 decision core — pointed cases", () => {
  it("leaves an in-bounds request untouched", () => {
    const decision = decide(
      base({ requestedEffort: "high", floor: "medium", ceiling: "xhigh" }),
    );
    expect(decision.applied).toBeUndefined();
    expect(decision.action).toBe("untouched");
  });

  it("raises to the floor and caps at the ceiling", () => {
    const up = decide(base({ requestedEffort: "low", floor: "medium" }));
    expect(up.applied).toBe("medium");
    expect(up.action).toBe("clamped");
    expect(up.reason).toContain("floor");

    const down = decide(base({ requestedEffort: "max", ceiling: "xhigh" }));
    expect(down.applied).toBe("xhigh");
    expect(down.action).toBe("clamped");
    expect(down.reason).toContain("ceiling");
  });

  it("injects the default only when configured AND the adapter allows it", () => {
    const injected = decide(
      base({ inject: true, defaultEffort: "high", canInject: true }),
    );
    expect(injected.applied).toBe("high");
    expect(injected.action).toBe("injected");

    const blocked = decide(
      base({ inject: true, defaultEffort: "high", canInject: false }),
    );
    expect(blocked.applied).toBeUndefined();
    expect(blocked.action).toBe("untouched");

    const notConfigured = decide(base({ defaultEffort: "high" }));
    expect(notConfigured.applied).toBeUndefined();
  });

  it("holds a sticky session: lower requests are raised back to the session level", () => {
    const decision = decide(
      base({ requestedEffort: "low", sessionEffort: "medium" }),
    );
    expect(decision.applied).toBe("medium");
    expect(decision.action).toBe("sticky-held");
    expect(decision.sessionEffortNext).toBe("medium");
  });

  it("escalate-only lets a session rise, never fall", () => {
    const rise = decide(
      base({ requestedEffort: "xhigh", sessionEffort: "medium" }),
    );
    expect(rise.applied).toBeUndefined(); // request already says xhigh; nothing to write
    expect(rise.action).toBe("escalated");
    expect(rise.sessionEffortNext).toBe("xhigh");

    const fallBlocked = decide(
      base({
        requestedEffort: "medium",
        sessionEffort: "high",
        escalateOnly: false,
      }),
    );
    // sticky without escalate-only still pins to the session level
    expect(fallBlocked.applied).toBe("high");
    expect(fallBlocked.action).toBe("sticky-held");
  });

  it("non-sticky sessions follow the request", () => {
    const decision = decide(
      base({
        requestedEffort: "low",
        sessionEffort: "high",
        sessionSticky: false,
      }),
    );
    expect(decision.applied).toBeUndefined();
    expect(decision.sessionEffortNext).toBe("low");
  });

  it("observe and suggest never mutate but record what enforce would have done", () => {
    for (const mode of ["observe", "suggest"] as const) {
      const decision = decide(
        base({ mode, requestedEffort: "max", ceiling: "medium" }),
      );
      expect(decision.applied).toBeUndefined();
      expect(decision.wouldHave).toBe("medium");
    }
  });

  it("observe-mode sticky state tracks what actually ran, not the would-have", () => {
    const decision = decide(
      base({ mode: "observe", requestedEffort: "low", floor: "high" }),
    );
    expect(decision.sessionEffortNext).toBe("low");
  });

  it("suggestion escalates only when the ratchet is enabled", () => {
    const inert = decide(
      base({ requestedEffort: "medium", suggestion: "xhigh" }),
    );
    expect(inert.applied).toBeUndefined();

    const ratcheted = decide(
      base({
        requestedEffort: "medium",
        suggestion: "xhigh",
        escalateOnSuggestion: true,
      }),
    );
    expect(ratcheted.applied).toBe("xhigh");
    expect(ratcheted.action).toBe("escalated");

    const neverLowers = decide(
      base({
        requestedEffort: "high",
        suggestion: "low",
        escalateOnSuggestion: true,
      }),
    );
    expect(neverLowers.applied).toBeUndefined();
  });
});

describe("E5.2 one-way ratchet property", () => {
  it("per-request effective effort never drops below the established session level", () => {
    const efforts: Array<Effort | undefined> = [
      undefined,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ];
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 50; trial += 1) {
      let session: Effort | undefined;
      for (let turn = 0; turn < 20; turn += 1) {
        const input = base({ escalateOnSuggestion: true });
        const requested = efforts[Math.floor(rnd() * efforts.length)];
        const suggestion = efforts[Math.floor(rnd() * efforts.length)];
        if (requested) input.requestedEffort = requested;
        if (suggestion) input.suggestion = suggestion;
        if (session) input.sessionEffort = session;

        const decision = decide(input);
        const effective = decision.applied ?? input.requestedEffort;
        if (session !== undefined && effective !== undefined) {
          expect(effortRank(effective)).toBeGreaterThanOrEqual(
            effortRank(session),
          );
        }
        if (session !== undefined && decision.sessionEffortNext !== undefined) {
          expect(
            effortRank(decision.sessionEffortNext),
          ).toBeGreaterThanOrEqual(effortRank(session));
        }
        session = decision.sessionEffortNext ?? session;
      }
    }
  });
});

describe("E3.2 decision core — invariant sweep over the full grid", () => {
  const efforts: Array<Effort | undefined> = [undefined, "low", "high", "max"];
  const bools = [true, false];
  const modes = ["observe", "suggest", "enforce"] as const;
  const inputs: DecisionInput[] = [];
  for (const mode of modes)
    for (const sessionSticky of bools)
      for (const escalateOnly of bools)
        for (const inject of bools)
          for (const canInject of bools)
            for (const requestedEffort of efforts)
              for (const sessionEffort of efforts)
                for (const suggestion of [undefined, "xhigh"] as const)
                  for (const escalateOnSuggestion of bools) {
                    const input: DecisionInput = {
                      mode,
                      sessionSticky,
                      escalateOnly,
                      inject,
                      canInject,
                      floor: "medium",
                      ceiling: "xhigh",
                      defaultEffort: "high",
                      escalateOnSuggestion,
                    };
                    if (requestedEffort) input.requestedEffort = requestedEffort;
                    if (sessionEffort) input.sessionEffort = sessionEffort;
                    if (suggestion) input.suggestion = suggestion;
                    inputs.push(input);
                  }

  it(`holds the safety invariants across ${inputs.length} combinations`, () => {
    for (const input of inputs) {
      const decision = decide(input);

      // I1: only enforce may mutate.
      if (input.mode !== "enforce") expect(decision.applied).toBeUndefined();

      // I2: a write never restates the request verbatim.
      if (decision.applied !== undefined) {
        expect(decision.applied).not.toBe(input.requestedEffort);
      }

      // I3: nothing is ever written without a source: a requested value,
      // or injection both configured and adapter-allowed.
      if (decision.applied !== undefined && input.requestedEffort === undefined) {
        expect(input.inject && input.canInject).toBe(true);
      }

      // I4: writes respect floor and ceiling.
      for (const value of [decision.applied, decision.wouldHave]) {
        if (value !== undefined) {
          expect(effortRank(value)).toBeGreaterThanOrEqual(effortRank("medium"));
          expect(effortRank(value)).toBeLessThanOrEqual(effortRank("xhigh"));
        }
      }

      // I5: sticky sessions never end below their established level under
      // escalate-only (ratchet property), in enforce mode.
      if (
        input.mode === "enforce" &&
        input.sessionSticky &&
        input.escalateOnly &&
        input.sessionEffort !== undefined &&
        decision.sessionEffortNext !== undefined
      ) {
        expect(
          effortRank(decision.sessionEffortNext),
        ).toBeGreaterThanOrEqual(effortRank(input.sessionEffort));
      }

      // I6: every decision explains itself.
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(EFFORT_LEVELS.length).toBe(5); // guard against scale drift breaking the sweep silently
    }
  });
});
