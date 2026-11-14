// Languages Pal can speak on a call. This list follows Gemini Live API's published
// language codes; confirm your demo language in AI Studio before the demo.
// Gemini native-audio models also switch languages mid-conversation on their own.
export const LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: "en-US", label: "English (US)", native: "English" },
  { code: "es-US", label: "Spanish (US)", native: "Español" },
  { code: "es-ES", label: "Spanish (Spain)", native: "Español" },
  { code: "bn-IN", label: "Bengali", native: "বাংলা" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी" },
  { code: "cmn-CN", label: "Mandarin Chinese", native: "中文" },
  { code: "ar-XA", label: "Arabic", native: "العربية" },
  { code: "vi-VN", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "ko-KR", label: "Korean", native: "한국어" },
  { code: "ja-JP", label: "Japanese", native: "日本語" },
  { code: "fr-FR", label: "French", native: "Français" },
  { code: "fr-CA", label: "French (Canada)", native: "Français" },
  { code: "de-DE", label: "German", native: "Deutsch" },
  { code: "it-IT", label: "Italian", native: "Italiano" },
  { code: "pt-BR", label: "Portuguese (Brazil)", native: "Português" },
  { code: "ru-RU", label: "Russian", native: "Русский" },
  { code: "pl-PL", label: "Polish", native: "Polski" },
  { code: "nl-NL", label: "Dutch", native: "Nederlands" },
  { code: "tr-TR", label: "Turkish", native: "Türkçe" },
  { code: "th-TH", label: "Thai", native: "ไทย" },
  { code: "id-ID", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు" },
  { code: "mr-IN", label: "Marathi", native: "मराठी" },
  { code: "gu-IN", label: "Gujarati", native: "ગુજરાતી" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം" },
  { code: "en-IN", label: "English (India)", native: "English" },
  { code: "en-GB", label: "English (UK)", native: "English" },
];

export function languageName(code?: string | null): string {
  if (!code) return "English";
  const hit = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES.find((l) => l.code.startsWith(code.split("-")[0]));
  return hit ? hit.label.replace(/ \(.*\)$/, "") : code;
}

export function languageNative(code?: string | null): string {
  const hit = LANGUAGES.find((l) => l.code === code);
  return hit?.native ?? "";
}
