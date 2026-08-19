import { describe, expect, it } from "vitest";
import { anthropic } from "../src/providers/anthropic.js";
import { openai } from "../src/providers/openai.js";

describe("E2.2 openai adapter", () => {
  it("matches chat completions and responses inference paths", () => {
    expect(openai.isInferencePath("/v1/chat/completions")).toBe(true);
    expect(openai.isInferencePath("/v1/responses")).toBe(true);
    expect(openai.isInferencePath("/v1/responses?stream=true")).toBe(true);
    expect(openai.isInferencePath("/v1/models")).toBe(false);
    expect(openai.isInferencePath("/v1/embeddings")).toBe(false);
    expect(openai.isInferencePath("/v1/chat/completions/extra")).toBe(false);
  });

  it("reads effort from both wire shapes, ignoring sub-low values", () => {
    expect(openai.readEffort({ reasoning: { effort: "high" } })).toBe("high");
    expect(openai.readEffort({ reasoning: { effort: "xhigh" } })).toBe("xhigh");
    expect(openai.readEffort({ reasoning_effort: "medium" })).toBe("medium");
    // `none`/`minimal` are below the internal scale — never touched (PROVIDERS.md policy)
    expect(openai.readEffort({ reasoning: { effort: "minimal" } })).toBeUndefined();
    expect(openai.readEffort({ reasoning_effort: "none" })).toBeUndefined();
    expect(openai.readEffort({})).toBeUndefined();
  });

  const capabilities: Array<[string, string]> = [
    ["gpt-5.5", "core"],
    ["gpt-5.6", "core"],
    ["gpt-5-mini", "core"],
    ["o3-mini", "core"],
    ["o4-mini", "core"],
    ["gpt-4o-mini", "none"],
    ["gpt-4.1", "none"],
    ["unknown", "none"],
  ];
  it.each(capabilities)("capability(%s) = %s", (model, expected) => {
    expect(openai.effortCapability(model)).toBe(expected);
  });

  it("is clamp-only: canInject is false even for reasoning models", () => {
    expect(openai.canInject("gpt-5.5")).toBe(false);
    expect(openai.canInject("o3-mini")).toBe(false);
    // contrast: the anthropic adapter injects on allowlisted models only
    expect(anthropic.canInject("claude-opus-5")).toBe(true);
    expect(anthropic.canInject("claude-haiku-4-5")).toBe(false);
  });

  it("plans writes restricted to the conservative core", () => {
    expect(openai.planEffort("gpt-5.5", "max")).toBe("high");
    expect(openai.planEffort("gpt-5.5", "xhigh")).toBe("high");
    expect(openai.planEffort("gpt-5.5", "medium")).toBe("medium");
    expect(openai.planEffort("gpt-4o-mini", "high")).toBeUndefined();
  });

  it("applies effort to the responses wire shape immutably", () => {
    const body = {
      model: "gpt-5.5",
      reasoning: { effort: "xhigh", summary: "auto" },
      input: "hi",
    };
    const result = openai.applyEffort(body, "medium", "/v1/responses") as Record<
      string,
      unknown
    >;
    const reasoning = result["reasoning"] as Record<string, unknown>;

    expect(reasoning["effort"]).toBe("medium");
    expect(reasoning["summary"]).toBe("auto");
    expect(result["input"]).toBe("hi");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  it("applies effort to the chat completions wire shape", () => {
    const body = { model: "o3-mini", reasoning_effort: "high", messages: [] };
    const result = openai.applyEffort(
      body,
      "low",
      "/v1/chat/completions",
    ) as Record<string, unknown>;

    expect(result["reasoning_effort"]).toBe("low");
    expect(body.reasoning_effort).toBe("high");
  });

  it("refuses to touch non-reasoning models", () => {
    expect(
      openai.applyEffort({ model: "gpt-4o-mini" }, "high", "/v1/chat/completions"),
    ).toBeUndefined();
  });
});
