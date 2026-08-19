import { describe, expect, it } from "vitest";
import {
  EFFORT_LEVELS,
  clampEffort,
  effortRank,
  isEffort,
} from "../src/effort.js";
import { anthropic } from "../src/providers/anthropic.js";

describe("E2.1 effort scale", () => {
  it("orders the five levels", () => {
    const ranks = EFFORT_LEVELS.map(effortRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });

  it("validates level strings strictly", () => {
    for (const level of EFFORT_LEVELS) expect(isEffort(level)).toBe(true);
    for (const bad of ["ultra", "HIGH", "", 3, null, undefined]) {
      expect(isEffort(bad)).toBe(false);
    }
  });

  it("clamps to floor and ceiling", () => {
    expect(clampEffort("low", "medium", "xhigh")).toBe("medium");
    expect(clampEffort("max", "medium", "xhigh")).toBe("xhigh");
    expect(clampEffort("high", "medium", "xhigh")).toBe("high");
    expect(clampEffort("high", undefined, undefined)).toBe("high");
  });
});

describe("E2.1 anthropic adapter", () => {
  it("matches exactly the /v1/messages inference path", () => {
    expect(anthropic.isInferencePath("/v1/messages")).toBe(true);
    expect(anthropic.isInferencePath("/v1/messages?beta=true")).toBe(true);
    expect(anthropic.isInferencePath("/v1/messages/batches")).toBe(false);
    expect(anthropic.isInferencePath("/v1/messages/count_tokens")).toBe(false);
    expect(anthropic.isInferencePath("/v1/models")).toBe(false);
    expect(anthropic.isInferencePath("/api/hello")).toBe(false);
  });

  // Mirrors PROVIDERS.md V2 row-for-row, including provider-prefixed model ids.
  const capabilityMatrix: Array<[string, string]> = [
    ["claude-fable-5", "full"],
    ["claude-mythos-5", "full"],
    ["claude-opus-5", "full"],
    ["claude-opus-4-8", "full"],
    ["claude-opus-4-7", "full"],
    ["claude-sonnet-5", "full"],
    ["claude-opus-4-6", "no-xhigh"],
    ["claude-sonnet-4-6", "no-xhigh"],
    ["claude-opus-4-5", "core"],
    ["claude-sonnet-4-5", "none"],
    ["claude-haiku-4-5", "none"],
    ["claude-3-5-haiku-20241022", "none"],
    ["anthropic.claude-opus-5", "full"],
    ["us.anthropic.claude-sonnet-4-6-v1:0", "no-xhigh"],
    ["unknown-model-id", "none"],
  ];
  it.each(capabilityMatrix)("capability(%s) = %s", (model, expected) => {
    expect(anthropic.effortCapability(model)).toBe(expected);
  });

  it("plans capability-safe effort values per model", () => {
    expect(anthropic.planEffort("claude-opus-5", "xhigh")).toBe("xhigh");
    expect(anthropic.planEffort("claude-sonnet-4-6", "xhigh")).toBe("high");
    expect(anthropic.planEffort("claude-sonnet-4-6", "max")).toBe("max");
    expect(anthropic.planEffort("claude-opus-4-5", "xhigh")).toBe("high");
    expect(anthropic.planEffort("claude-opus-4-5", "max")).toBe("high");
    expect(anthropic.planEffort("claude-haiku-4-5", "high")).toBeUndefined();
    expect(anthropic.planEffort("claude-3-5-haiku-20241022", "low")).toBeUndefined();
  });

  it("reads model and effort from a request body", () => {
    const body = {
      model: "claude-opus-5",
      output_config: { effort: "xhigh" },
    };
    expect(anthropic.getModel(body)).toBe("claude-opus-5");
    expect(anthropic.readEffort(body)).toBe("xhigh");
    expect(anthropic.readEffort({ model: "claude-opus-5" })).toBeUndefined();
    expect(
      anthropic.readEffort({ output_config: { effort: "bogus" } }),
    ).toBeUndefined();
  });

  it("applies effort without disturbing the rest of the body", () => {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      output_config: { effort: "xhigh", other: "kept" },
      messages: [{ role: "user", content: "hi" }],
    };
    const result = anthropic.applyEffort(body, "xhigh") as Record<string, unknown>;

    expect((result["output_config"] as Record<string, unknown>)["effort"]).toBe(
      "high", // capability-mapped for the 4.6 pair
    );
    expect((result["output_config"] as Record<string, unknown>)["other"]).toBe(
      "kept",
    );
    expect(result["max_tokens"]).toBe(64);
    expect(result["messages"]).toEqual(body.messages);
    expect(body.output_config.effort).toBe("xhigh"); // original untouched
  });

  it("refuses to apply effort to unsupported models", () => {
    const body = { model: "claude-haiku-4-5", max_tokens: 8 };
    expect(anthropic.applyEffort(body, "high")).toBeUndefined();
    expect("output_config" in body).toBe(false);
  });
});
