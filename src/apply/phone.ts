import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface NormalisedPhone {
  /** E.164 when parse succeeded. */
  e164: string | null;
  /** Value written to person.phone — E.164, or the raw typed string. */
  stored: string;
  needsReview: boolean;
}

/**
 * Normalise a phone number for the person.phone dedupe key.
 * Default region is India. Numbers that cannot be parsed are stored as typed
 * and flagged — the application is never rejected on that account.
 */
export function normalisePhone(raw: string): NormalisedPhone {
  const typed = raw.trim();
  if (!typed) return { e164: null, stored: typed, needsReview: true };

  const first = tryParse(typed);
  if (first) return first;

  const digits = typed.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const prefixed = tryParse(`+${digits}`);
    if (prefixed) return prefixed;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    const stripped = tryParse(digits.slice(1));
    if (stripped) return stripped;
  }
  if (digits.length === 10) {
    const local = tryParse(digits);
    if (local) return local;
  }

  return { e164: null, stored: typed, needsReview: true };
}

function tryParse(input: string): NormalisedPhone | null {
  const parsed = parsePhoneNumberFromString(input, 'IN');
  if (parsed && parsed.isValid()) {
    return { e164: parsed.number, stored: parsed.number, needsReview: false };
  }
  return null;
}
