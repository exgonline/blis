import { ElexonSeason, DayType } from '../types/index';

/**
 * Returns the last Monday on or before the given day of the month in the given year/month.
 */
function lastMondayOfMonth(year: number, month: number): Date {
  // month is 0-indexed
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const dayOfWeek = lastDay.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return new Date(Date.UTC(year, month, lastDay.getUTCDate() - daysBack));
}

/**
 * Determine the Elexon season for a given Date.
 *
 * Seasons (approximate, using UTC dates):
 *  - high_summer: last Monday of July to last Monday of August (inclusive)
 *  - summer:      1 May – last Sunday before high_summer, and September
 *  - spring:      1 March – 30 April
 *  - autumn:      1 October – 31 October
 *  - winter:      1 November – last day of February
 */
export function getSeason(date: Date): ElexonSeason {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const dayOfMonth = date.getUTCDate();

  const lastMonJuly = lastMondayOfMonth(year, 6); // July = month 6
  const lastMonAugust = lastMondayOfMonth(year, 7); // August = month 7

  // Normalise to midnight UTC for comparison
  const d = new Date(Date.UTC(year, month, dayOfMonth));

  if (d >= lastMonJuly && d <= lastMonAugust) {
    return ElexonSeason.HighSummer;
  }

  if (month === 4 /* May */ || month === 5 /* Jun */) {
    return ElexonSeason.Summer;
  }

  if (month === 6 /* Jul */ && d < lastMonJuly) {
    return ElexonSeason.Summer;
  }

  if (month === 8 /* Sep */) {
    return ElexonSeason.Summer;
  }

  if (month === 2 /* Mar */ || month === 3 /* Apr */) {
    return ElexonSeason.Spring;
  }

  if (month === 9 /* Oct */) {
    return ElexonSeason.Autumn;
  }

  // November, December, January, February
  if (month === 10 || month === 11 || month === 0 || month === 1) {
    return ElexonSeason.Winter;
  }

  // Fallback (should not reach here)
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
