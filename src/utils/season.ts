import { ElexonSeason, DayType } from '../types/index';

/**
 * Returns the last Sunday on or before the last day of the given year/month.
 * month is 0-indexed (0 = January).
 */
function lastSundayOfMonth(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const dayOfWeek = lastDay.getUTCDay(); // 0=Sun, 1=Mon, ...
  // dayOfWeek already equals days to step back to reach Sunday
  return new Date(Date.UTC(year, month, lastDay.getUTCDate() - dayOfWeek));
}

/**
 * Determine the Elexon season for a given Date.
 *
 * Seasons (UTC dates):
 *  - high_summer: last Sunday of May → day before last Sunday of July (exclusive)
 *  - summer:      last Sunday of March → day before last Sunday of May, and September
 *  - spring:      last Sunday of March → end of April  (same start as summer boundary)
 *  - autumn:      1 October – 31 October
 *  - winter:      1 November – last day of February
 *
 * Boundary logic matches Elexon UNC calendar:
 *   Spring:     last Sun March  → last Sun May  (exclusive)
 *   Summer:     last Sun May    → last Sun July (exclusive) — split: pre/post high_summer
 *   High Summer:last Sun May    → last Sun July (high intensity Jul window)
 *   Autumn:     October
 *   Winter:     November – February
 *
 * Per spec high_summer = last Sunday of May through last Sunday of July.
 */
export function getSeason(date: Date): ElexonSeason {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const dayOfMonth = date.getUTCDate();

  // Transition Sundays (midnight UTC)
  const lastSunMar = lastSundayOfMonth(year, 2);  // March
  const lastSunMay = lastSundayOfMonth(year, 4);  // May
  const lastSunJul = lastSundayOfMonth(year, 6);  // July
  const lastSunOct = lastSundayOfMonth(year, 9);  // October

  const d = new Date(Date.UTC(year, month, dayOfMonth));

  // high_summer: last Sunday of May (inclusive) up to last Sunday of July (exclusive)
  if (d >= lastSunMay && d < lastSunJul) {
    return ElexonSeason.HighSummer;
  }

  // summer: last Sunday of July (inclusive) through September
  if ((d >= lastSunJul && month <= 8) || month === 8) {
    return ElexonSeason.Summer;
  }

  // spring: last Sunday of March (inclusive) up to last Sunday of May (exclusive)
  if (d >= lastSunMar && d < lastSunMay) {
    return ElexonSeason.Spring;
  }

  // autumn: last Sunday of October (inclusive) through end of October,
  //         or all of October before that transition
  if (d >= lastSunOct || (month === 9 && d < lastSunOct)) {
    if (month === 9) return ElexonSeason.Autumn;
  }
  if (month === 9) {
    return ElexonSeason.Autumn;
  }

  // winter: November, December, January, February, and pre-spring March
  return ElexonSeason.Winter;
}

/**
 * A minimal list of UK bank holidays (England & Wales) for the near future.
 * In production this should be fetched from https://www.gov.uk/bank-holidays.json
 * This list covers 2024-2027 for testing purposes.
 */
const UK_BANK_HOLIDAYS_ISO: string[] = [
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-06', '2024-05-27',
  '2024-08-26', '2024-12-25', '2024-12-26',
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26',
  '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
  '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
  '2027-08-30', '2027-12-27', '2027-12-28',
];

const bankHolidaySet = new Set<string>(UK_BANK_HOLIDAYS_ISO);

function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isBankHoliday(date: Date): boolean {
  return bankHolidaySet.has(toIsoDateString(date));
}

/**
 * Determine the DayType for a given Date.
 * Bank holidays are treated as Sunday.
 */
export function getDayType(date: Date): DayType {
  if (isBankHoliday(date)) {
    return DayType.Sunday;
  }

  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0) return DayType.Sunday;
  if (dow === 6) return DayType.Saturday;
  return DayType.Weekday;
}

/**
 * Get the half-hour period index (0-47) for a given UTC Date.
 * Period 0 = 00:00–00:30, period 47 = 23:30–00:00
 */
export function getHalfHourPeriod(date: Date): number {
  return date.getUTCHours() * 2 + (date.getUTCMinutes() >= 30 ? 1 : 0);
}

/**
 * Format period index as HH:MM string.
 */
export function periodIndexToHhmm(periodIndex: number): string {
  const totalMinutes = periodIndex * 30;
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
