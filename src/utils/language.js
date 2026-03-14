export function resolveLanguage(value) {
  if (!value) {
    return "es";
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized.startsWith("en")) {
    return "en";
  }
  return "es";
}

export function t(language, esText, enText) {
  return language === "en" ? enText : esText;
}
