import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

// Strong random temporary password for the Admin to pass on (PRD US-9).
// Uses the Web Crypto API, available in browsers and in Node. The alphabet
// leaves out look-alike characters (0/O, 1/l/I) so it can be read aloud or
// typed from a note.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "-_.!?";
const ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS;

export const GENERATED_PASSWORD_LENGTH = 16;

function randomIndex(max: number): number {
  // Rejection sampling: no modulo bias.
  const limit = Math.floor(256 / max) * max;
  const byte = new Uint8Array(1);
  do {
    crypto.getRandomValues(byte);
  } while (byte[0] >= limit);
  return byte[0] % max;
}

function pick(set: string): string {
  return set[randomIndex(set.length)];
}

export function generarPasswordTemporal(length = GENERATED_PASSWORD_LENGTH): string {
  const size = Math.max(length, PASSWORD_MIN_LENGTH);
  // One of each class, then the rest from the full alphabet, shuffled.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(ALPHABET));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
