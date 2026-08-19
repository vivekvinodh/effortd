import { describe, expect, it } from "vitest";
import { gemini } from "../src/providers/gemini.js";

describe("E2.3 gemini adapter", () => {
  it("matches generateContent and streamGenerateContent paths on v1beta and v1", () => {
    expect(
      gemini.isInferencePath("/v1beta/models/gemini-3.7-flash:generateContent"),
    ).toBe(true);
    expect(
      gemini.isInferencePath(
        "/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
      ),
    ).toBe(true);
    expect(
      gemini.isInferencePath("/v1/models/gemini-2.5-flash:generateContent"),
    ).toBe(true);
    expect(gemini.isInferencePath("/v1beta/models")).toBe(false);
    expect(
      gemini.isInferencePath("/v1beta/models/gemini-2.5-pro:countTokens"),
    ).toBe(false);
  });

  it("parses the model id from the path", () => {
    expect(
      gemini.getModel({}, "/v1beta/models/gemini-3.7-flash:generateContent"),
    ).toBe("gemini-3.7-flash");
    expect(
      gemini.getModel(
        {},
        "/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
      ),
    ).toBe("gemini-2.5-pro");
    expect(gemini.getModel({}, "/v1beta/models")).toBeUndefined();
  });

  it("reads thinkingLevel, ignoring sub-low values and budget-style requests", () => {
    const level = (value: unknown) => ({
      generationConfig: { thinkingConfig: { thinkingLevel: value } },
    });
    expect(gemini.readEffort(level("high"))).toBe("high");
    expect(gemini.readEffort(level("low"))).toBe("low");
    expect(gemini.readEffort(level("minimal"))).toBeUndefined();
    expect(
      gemini.readEffort({
        generationConfig: { thinkingConfig: { thinkingBudget: 8192 } },
      }),
    ).toBeUndefined();
    expect(gemini.readEffort({})).toBeUndefined();
  });

  const capabilities: Array<[string, string]> = [
    ["gemini-3.7-flash", "core"],
    ["gemini-3.6-flash", "core"],
    ["gemini-3.5-flash-lite", "core"],
    ["gemini-2.5-pro", "core"],
    ["gemini-2.5-flash", "core"],
    ["gemini-2.5-flash-lite", "core"],
    ["gemini-2.0-flash", "none"],
    ["unknown-model", "none"],
  ];
  it.each(capabilities)("capability(%s) = %s", (model, expected) => {
    expect(gemini.effortCapability(model)).toBe(expected);
  });

  it("plans core-restricted writes and injects only on guide-matrix models", () => {
    expect(gemini.planEffort("gemini-2.5-pro", "max")).toBe("high");
    expect(gemini.planEffort("gemini-3.7-flash", "xhigh")).toBe("high");
    expect(gemini.planEffort("gemini-3.7-flash", "low")).toBe("low");
    expect(gemini.planEffort("gemini-2.0-flash", "high")).toBeUndefined();
    expect(gemini.canInject("gemini-2.5-pro")).toBe(true);
    expect(gemini.canInject("gemini-2.0-flash")).toBe(false);
  });

  it("applies thinkingLevel immutably, preserving sibling config", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: {
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
      },
    };
    const result = gemini.applyEffort(
      body,
      "max",
      "/v1beta/models/gemini-2.5-pro:generateContent",
    ) as Record<string, unknown>;
    const config = result["generationConfig"] as Record<string, unknown>;
    const thinking = config["thinkingConfig"] as Record<string, unknown>;

    expect(thinking["thinkingLevel"]).toBe("high"); // max maps into core
    expect(thinking["includeThoughts"]).toBe(true);
    expect(config["temperature"]).toBe(0.2);
    expect(
      (body.generationConfig.thinkingConfig as { thinkingLevel: string })
        .thinkingLevel,
    ).toBe("high");
  });

  it("refuses budget-style requests and non-matrix models", () => {
    const budgetBody = {
      generationConfig: { thinkingConfig: { thinkingBudget: 4096 } },
    };
    expect(
      gemini.applyEffort(
        budgetBody,
        "high",
        "/v1beta/models/gemini-2.5-pro:generateContent",
      ),
    ).toBeUndefined();
    expect(
      gemini.applyEffort(
        {},
        "high",
        "/v1beta/models/gemini-2.0-flash:generateContent",
      ),
    ).toBeUndefined();
  });
});
