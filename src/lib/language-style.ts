export type ReplyLanguage = "English" | "Hindi" | "Spanish" | "Hinglish";

const shortAcknowledgements = new Set([
  "yes", "yes please", "okay", "ok", "sure", "no", "thanks", "thank you",
  "haan", "han", "ji", "nahi", "theek hai", "sí", "si", "gracias",
]);

const hindiLatinMarkers = new Set([
  "aap", "ab", "accha", "acha", "aur", "baje", "batao", "chahiye", "hai", "haan",
  "kar", "karo", "kijiye", "kya", "lekin", "main", "mein", "mujhe", "nahi", "par",
  "theek", "thik", "wala", "wali", "wo", "yeh",
]);

const englishMarkers = new Set([
  "after", "appointment", "before", "book", "checkup", "confirm", "doctor", "follow", "please",
  "slot", "time", "today", "tomorrow", "visit", "works",
]);

function words(text: string) {
  return text.toLocaleLowerCase().match(/[a-záéíóúüñ]+/g) || [];
}

function detectedCodes(languages: Array<{ code?: string }> = []) {
  return new Set(languages.map((language) => language.code?.toLocaleLowerCase()).filter(Boolean));
}

export function chooseReplyLanguage(
  transcript: string,
  languages: Array<{ code?: string }> = [],
  previous: ReplyLanguage = "English",
): ReplyLanguage {
  const normalized = transcript.trim().toLocaleLowerCase().replace(/[.!?,¿¡]+$/g, "").trim();
  if (!normalized || shortAcknowledgements.has(normalized)) return previous;

  const codes = detectedCodes(languages);
  const hasDevanagari = /[\u0900-\u097f]/u.test(transcript);
  const tokens = words(transcript);
  const hindiMarkerCount = tokens.filter((word) => hindiLatinMarkers.has(word)).length;
  const englishMarkerCount = tokens.filter((word) => englishMarkers.has(word)).length;

  if (hasDevanagari) return "Hindi";
  if ((codes.has("hi") && codes.has("en")) || (hindiMarkerCount > 0 && englishMarkerCount > 0)) return "Hinglish";
  if (codes.has("es")) return "Spanish";
  if (codes.has("hi")) return "Hinglish";
  if (hindiMarkerCount >= 2) return "Hinglish";
  return "English";
}

export function replyLanguageInstruction(language: ReplyLanguage, transcript: string) {
  const style = {
    English: "Respond entirely in natural spoken English.",
    Hindi: "Respond entirely in natural spoken Hindi. Keep names and unavoidable clinic terms natural.",
    Spanish: "Respond entirely in natural spoken Spanish. Keep names and unavoidable clinic terms natural.",
    Hinglish: "Respond in natural conversational Hinglish, mixing Hindi and English the way the caller did.",
  }[language];

  return `LANGUAGE FOR THIS RESPONSE — HIGHEST PRIORITY:\n${style}\nThe caller's latest completed turn was: ${JSON.stringify(transcript)}\nDo not discuss language selection. Continue the scheduling workflow from the conversation context.`;
}
