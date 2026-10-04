/**
 * Calendar-based ranges for the history filters.
 *
 * These are real calendar boundaries in the device's local timezone, not
 * rolling windows: "Día" is midnight-to-midnight of the selected day, not the
 * last 24 h. The rolling version made "Hoy" include part of yesterday, which is
 * wrong for a log a clinician reads day by day.
 */
export type RangeKind = 'day' | 'week' | 'month';

export interface DateRange {
  /** Inclusive, ms since epoch. */
  fromMs: number;
  /** Exclusive, ms since epoch. */
  toMs: number;
  kind: RangeKind;
  /** The day the range was built around. */
  anchor: Date;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday as the first day of the week. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7; // 0 = Monday
  return addDays(d, -weekday);
}

export function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = startOfMonth(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function buildRange(kind: RangeKind, anchor: Date): DateRange {
  if (kind === 'day') {
    const from = startOfDay(anchor);
    return { fromMs: from.getTime(), toMs: addDays(from, 1).getTime(), kind, anchor };
  }
  if (kind === 'week') {
    const from = startOfWeek(anchor);
    return { fromMs: from.getTime(), toMs: addDays(from, 7).getTime(), kind, anchor };
  }
  const from = startOfMonth(anchor);
  return { fromMs: from.getTime(), toMs: addMonths(from, 1).getTime(), kind, anchor };
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Monday-first, to match startOfWeek. */
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function formatDay(date: Date): string {
  return `${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;
}

/** Human label for the range, used on screen and in the PDF header. */
export function describeRange(range: DateRange): string {
  const from = new Date(range.fromMs);
  if (range.kind === 'day') {
    const today = new Date();
    return isSameDay(from, today) ? `Hoy, ${formatDay(from)}` : formatDay(from);
  }
  if (range.kind === 'week') {
    const last = new Date(range.toMs - 1);
    const sameMonth = from.getMonth() === last.getMonth();
    const left = sameMonth
      ? String(from.getDate())
      : `${from.getDate()} de ${MONTH_NAMES[from.getMonth()]}`;
    return `Semana del ${left} al ${last.getDate()} de ${MONTH_NAMES[last.getMonth()]} de ${last.getFullYear()}`;
  }
  return `${MONTH_NAMES[from.getMonth()]} de ${from.getFullYear()}`;
}

/**
 * How the range is split for the charts: hourly for a day, daily otherwise.
 * Returns the bucket size and how many buckets the range holds.
 */
export function bucketPlan(range: DateRange): { bucketMs: number; count: number; hourly: boolean } {
  const hourly = range.kind === 'day';
  const bucketMs = hourly ? 3600_000 : 86_400_000;
  // Computed from the real boundaries rather than assumed, so DST transitions
  // (23- or 25-hour days) and 28-to-31-day months come out right.
  const count = Math.max(1, Math.round((range.toMs - range.fromMs) / bucketMs));
  return { bucketMs, count, hourly };
}

/** Axis label for bucket index i. */
export function bucketLabel(range: DateRange, index: number): string {
  const { hourly } = bucketPlan(range);
  if (hourly) {
    return `${String(index).padStart(2, '0')}h`;
  }
  const day = addDays(new Date(range.fromMs), index);
  return range.kind === 'week'
    ? WEEKDAY_INITIALS[(day.getDay() + 6) % 7]
    : String(day.getDate());
}
