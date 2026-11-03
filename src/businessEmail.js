const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  "yahoo.com", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "proton.me", "protonmail.com", "pm.me",
  "zoho.com", "zohomail.com",
  "gmx.com", "gmx.net", "gmx.de", "web.de",
  "mail.com", "email.com", "inbox.com",
  "yandex.com", "yandex.ru", "mail.ru", "rambler.ru",
  "tutanota.com", "tuta.io", "hey.com", "fastmail.com",
  "rediffmail.com", "qq.com", "163.com", "126.com", "sina.com", "naver.com", "daum.net",
  "libero.it", "orange.fr", "free.fr", "laposte.net", "t-online.de",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "btinternet.com",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
]);

const PERSONAL_PREFIXES = ["yahoo.", "hotmail.", "outlook.", "live.", "gmail.", "msn."];

export const BUSINESS_EMAIL_MESSAGE = "Please sign up with an email on your business domain.";

export function isPersonalEmail(email) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  if (!domain) return false;
  return PERSONAL_DOMAINS.has(domain) || PERSONAL_PREFIXES.some((prefix) => domain.startsWith(prefix));
}
