import { describe, expect, it } from "vitest";
import { isExplicitConfirmation } from "@/lib/confirmation";

describe("explicit multilingual confirmation", () => {
  it.each([
    "Yes, please book it",
    "Haan, book kar dijiye",
    "हाँ, बुक कर दीजिए",
    "Sí, confirmo la cita",
  ])("accepts a clear confirmation: %s", (text) => {
    expect(isExplicitConfirmation(text)).toBe(true);
  });

  it.each([
    "That might work",
    "Maybe",
    "I think so",
    "Shayad",
    "Tal vez",
    "No, do not book it",
  ])("rejects ambiguity or refusal: %s", (text) => {
    expect(isExplicitConfirmation(text)).toBe(false);
  });
});
