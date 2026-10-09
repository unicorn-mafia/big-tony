/**
 * Validation + normalisation for data that is about to be written into
 * Google Contacts. Everything here is pure and side-effect free so it can be
 * unit tested without touching the People API.
 */

export interface NormalizedContactData {
  displayName: string;
  givenName: string;
  familyName?: string;
  phoneE164: string;
  company?: string;
  role?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  refererName?: string;
}

export type ContactDataResult =
  | { valid: true; data: NormalizedContactData }
  | { valid: false; reason: string };

/** Google caps most text fields well above this; keep contacts tidy regardless. */
const MAX_TEXT_LENGTH = 250;

/** Strip control characters and collapse runs of whitespace. */
export function cleanText(value: string | undefined | null): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Coerce a phone number to E.164 (`+` followed by 8-15 digits).
 *
 * Wassist hands us `%PHONE_NUMBER%` which may arrive as `447488895960`,
 * `+44 7488 895960` or `+44-7488-895960`, so digits are extracted and the
 * leading `+` is re-applied. Returns "" when the value cannot be a valid
 * international number.
 */
export function normalizePhoneE164(phone: string | undefined | null): string {
  if (!phone) {
    return "";
  }

  let trimmed = phone.trim();
  // `00` is the international dialling prefix in most of the world.
  if (trimmed.startsWith("00")) {
    trimmed = `+${trimmed.slice(2)}`;
  }

  const digits = trimmed.replace(/\D/g, "");

  // E.164: max 15 digits, and a country code never starts with 0.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    return "";
  }

  return `+${digits}`;
}

export function isValidPhoneE164(phone: string | undefined | null): boolean {
  return normalizePhoneE164(phone) !== "";
}

/** Compare two phone numbers by their canonical E.164 form. */
export function phonesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = normalizePhoneE164(a);
  const right = normalizePhoneE164(b);
  return left !== "" && left === right;
}

/**
 * Accepts a bare username or a full profile URL and returns a canonical
 * `https://github.com/<user>` URL. Returns "" if it is not a plausible handle.
 */
export function normalizeGithubUrl(github: string | undefined | null): string {
  const value = cleanText(github);
  if (!value) {
    return "";
  }

  const username = value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\/+$/, "")
    .split(/[/?#]/)[0];

  // GitHub handles: alphanumeric with single internal hyphens, 1-39 chars.
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username)) {
    return "";
  }

  return `https://github.com/${username}`;
}

/**
 * Accepts a bare handle or any LinkedIn URL and returns a canonical
 * `https://www.linkedin.com/in/<slug>` URL. Returns "" if it is not a
 * LinkedIn profile we recognise, in which case it is simply left off the
 * contact rather than blocking the sync.
 */
export function normalizeLinkedinUrl(linkedin: string | undefined | null): string {
  const value = cleanText(linkedin);
  if (!value) {
    return "";
  }

  const withoutScheme = value
    .replace(/^https?:\/\//i, "")
    .replace(/^[a-z]{2,3}\.linkedin\./i, "linkedin.")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");

  const match = withoutScheme.match(/^linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
  const bare = /^[^/?#\s.]+$/.test(withoutScheme) ? withoutScheme : "";
  const slug = match ? match[1] : bare;

  if (!slug || !/^[a-zA-Z0-9\-_%À-ɏ]{3,100}$/.test(slug)) {
    return "";
  }

  return `https://www.linkedin.com/in/${slug}`;
}

/** Split a full name into given/family parts for the People API. */
export function splitName(name: string): { givenName: string; familyName?: string } {
  const parts = cleanText(name).split(" ").filter(Boolean);
  const [givenName, ...rest] = parts;
  const familyName = rest.join(" ");
  return { givenName: givenName ?? "", familyName: familyName || undefined };
}

/**
 * Validate and normalise a member into contact-ready data.
 *
 * Hard requirements are a name and a valid E.164 phone number - the phone is
 * the uniqueness key, so writing a contact without one would break
 * deduplication. Malformed social links are dropped rather than rejected.
 */
export function toContactData(input: {
  name: string;
  phone: string;
  company?: string;
  role?: string;
  github?: string;
  linkedin?: string;
  refererName?: string;
}): ContactDataResult {
  const displayName = cleanText(input.name);
  if (!displayName) {
    return { valid: false, reason: "member name is empty" };
  }

  const phoneE164 = normalizePhoneE164(input.phone);
  if (!phoneE164) {
    return {
      valid: false,
      reason: `phone number '${cleanText(input.phone) || "(empty)"}' is not a valid E.164 number`,
    };
  }

  const { givenName, familyName } = splitName(displayName);

  return {
    valid: true,
    data: {
      displayName,
      givenName,
      familyName,
      phoneE164,
      company: cleanText(input.company) || undefined,
      role: cleanText(input.role) || undefined,
      githubUrl: normalizeGithubUrl(input.github) || undefined,
      linkedinUrl: normalizeLinkedinUrl(input.linkedin) || undefined,
      refererName: cleanText(input.refererName) || undefined,
    },
  };
}
