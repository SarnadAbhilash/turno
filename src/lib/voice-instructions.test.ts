import { describe, expect, it } from "vitest";
import { phoneVoiceInstructions, voiceInstructions } from "./voice-instructions";

describe("multilingual voice instructions", () => {
  it("matches each complete caller turn instead of locking to the first language", () => {
    expect(voiceInstructions).toContain("latest clear, complete turn on every response");
    expect(voiceInstructions).toContain("Hinglish");
    expect(voiceInstructions).toContain("Switch immediately");
    expect(voiceInstructions).not.toContain("Keep that language for the whole call");
  });

  it("keeps the same policy on the phone channel", () => {
    expect(phoneVoiceInstructions).toContain("latest clear, complete turn on every response");
    expect(phoneVoiceInstructions).toContain("You are answering a telephone call");
  });
});
