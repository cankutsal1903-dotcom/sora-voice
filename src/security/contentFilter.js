const BLOCKED_TERMS = [
  "aptal",
  "salak",
  "gerizekali",
  "gerizekalı",
  "siktir",
  "orospu",
  "pic",
  "piç",
  "amk",
  "yarrak",
  "ibne",
];

export const normalizeModerationText = (value = "") => value
  .toLocaleLowerCase("tr-TR")
  .replace(/[çÇ]/g, "c")
  .replace(/[ğĞ]/g, "g")
  .replace(/[ıİ]/g, "i")
  .replace(/[öÖ]/g, "o")
  .replace(/[şŞ]/g, "s")
  .replace(/[üÜ]/g, "u")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const containsBlockedLanguage = (value) => {
  const normalized = ` ${normalizeModerationText(value)} `;
  return BLOCKED_TERMS.some((term) => normalized.includes(` ${normalizeModerationText(term)} `));
};

export const createMessageGuard = () => {
  let sentAt = [];
  let lastMessage = { text: "", sentAt: 0 };

  return {
    check(value, now = Date.now()) {
      const normalized = normalizeModerationText(value);
      if (!normalized) return { allowed: false, reason: "empty" };
      if (containsBlockedLanguage(value)) return { allowed: false, reason: "blocked_language" };
      sentAt = sentAt.filter((timestamp) => timestamp > now - 5 * 60 * 1000);
      if (lastMessage.text === normalized && lastMessage.sentAt > now - 30 * 1000) {
        return { allowed: false, reason: "duplicate" };
      }
      if (sentAt.filter((timestamp) => timestamp > now - 10 * 1000).length >= 5 || sentAt.length >= 20) {
        return { allowed: false, reason: "rate_limit" };
      }
      return { allowed: true };
    },
    record(value, now = Date.now()) {
      sentAt = [...sentAt.filter((timestamp) => timestamp > now - 5 * 60 * 1000), now];
      lastMessage = { text: normalizeModerationText(value), sentAt: now };
    },
  };
};
