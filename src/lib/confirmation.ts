const ambiguousPatterns = [
  /\bmaybe\b/i,
  /\bmight\b/i,
  /\bi think\b/i,
  /\bi guess\b/i,
  /\bcould work\b/i,
  /\bshayad\b/i,
  /शायद/u,
  /\bquiz[aá]s\b/i,
  /\btal vez\b/i,
  /\bpodr[ií]a\b/i,
];

const negativePatterns = [
  /\bno\b/i,
  /\bnot yet\b/i,
  /\bdon'?t\b/i,
  /\bnahi+n?\b/i,
  /\bmat\b/i,
  /नहीं/u,
  /मत/u,
  /\bno reserve\b/i,
  /\bno confirme\b/i,
];

const affirmativePatterns = [
  /\byes\b/i,
  /\bconfirm\b/i,
  /\bbook (it|that|the appointment)\b/i,
  /\bgo ahead\b/i,
  /\bplease book\b/i,
  /\bhaan\b/i,
  /\bha+n\b/i,
  /\bbook kar/i,
  /\bconfirm kar/i,
  /हाँ/u,
  /हां/u,
  /बुक/u,
  /पुष्टि/u,
  /\bs[ií]\b/i,
  /\bconfirmo\b/i,
  /\breserva(r)?\b/i,
  /\badelante\b/i,
];

export function isExplicitConfirmation(text: string) {
  const normalized = text.trim();
  if (!normalized) return false;
  if (ambiguousPatterns.some((pattern) => pattern.test(normalized))) return false;
  if (negativePatterns.some((pattern) => pattern.test(normalized))) return false;
  return affirmativePatterns.some((pattern) => pattern.test(normalized));
}
