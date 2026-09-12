import { describe, expect, it } from "vitest";
import { chooseReplyLanguage, replyLanguageInstruction } from "./language-style";

describe("turn-level reply language", () => {
  it("selects Hindi for Devanagari even when a doctor name is in Latin text", () => {
    expect(chooseReplyLanguage("ये एनुअल चेकअप होगा, Elena Ruiz डॉक्टर के साथ।", [{ code: "hi" }])).toBe("Hindi");
  });

  it("selects English for an English scheduling turn", () => {
    expect(chooseReplyLanguage("Actually, I need something before three.", [{ code: "en" }], "Hindi")).toBe("English");
  });

  it("selects Hinglish for a mixed turn", () => {
    expect(chooseReplyLanguage("Haan, 2:15 wala slot works for me.", [{ code: "hi" }, { code: "en" }])).toBe("Hinglish");
  });

  it("selects Spanish from transcription language detection", () => {
    expect(chooseReplyLanguage("Quiero una cita el martes.", [{ code: "es" }])).toBe("Spanish");
  });

  it("does not switch on a short acknowledgement", () => {
    expect(chooseReplyLanguage("Yes.", [{ code: "en" }], "Hindi")).toBe("Hindi");
    expect(chooseReplyLanguage("Haan.", [{ code: "hi" }], "English")).toBe("English");
  });

  it("creates an explicit per-response instruction", () => {
    expect(replyLanguageInstruction("Hindi", "मुझे दो बजे का समय चाहिए।")).toContain("entirely in natural spoken Hindi");
  });
});
