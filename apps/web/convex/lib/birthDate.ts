/**
 * NEO-676 — `players.birthDate`: an ISO calendar date, `YYYY-MM-DD`.
 *
 * Complements `birthYear` (NEO-254), it does not replace it. A real calendar
 * date (no 2021-02-30) whose year sits within `MIN_BIRTH_YEAR..maxBirthYear()`,
 * the same bounds `birthYear` is held to.
 */
import { ConvexError } from "convex/values";
import {
  MIN_BIRTH_YEAR,
  maxBirthYear,
} from "../../lib/players/career-years";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBirthDate(value: unknown, now: Date = new Date()): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_BIRTH_YEAR || year > maxBirthYear(now)) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function assertBirthDate(birthDate: string): void {
  if (!isBirthDate(birthDate)) {
    throw new ConvexError(
      `A birth date must be a real date written YYYY-MM-DD, in a year between ${MIN_BIRTH_YEAR} and ${maxBirthYear()}.`,
    );
  }
}
