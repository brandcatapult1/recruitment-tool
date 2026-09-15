import { WEEKDAY_TIMEZONE } from '../constants';

/**
 * Elapsed weekday clock-hours between two instants.
 * Saturday and Sunday in WEEKDAY_TIMEZONE contribute nothing. Each weekday
 * counts a full 24 hours (not an 8-hour office day).
 */
export function weekdayHoursBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let ms = 0;
  const startParts = istParts(from);
  let cursor = istMidnightUtc(startParts.year, startParts.month, startParts.day);
  const end = to.getTime();
  const start = from.getTime();
  while (cursor < end) {
    const next = cursor + 24 * 60 * 60 * 1000;
    if (!isIstWeekend(new Date(cursor + 12 * 60 * 60 * 1000))) {
      const a = Math.max(start, cursor);
      const b = Math.min(end, next);
      if (b > a) ms += b - a;
    }
    cursor = next;
  }
  return ms / (60 * 60 * 1000);
}

function istParts(date: Date): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WEEKDAY_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: get('weekday'),
  };
}

function isIstWeekend(date: Date): boolean {
  const wd = istParts(date).weekday;
  return wd === 'Sat' || wd === 'Sun';
}

/** IST has no DST: wall-clock midnight is UTC minus 5h30. */
function istMidnightUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000;
}
