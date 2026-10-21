/**
 * Ranges for the history filters, in the device's local timezone.
 *
 * "Día" is midnight-to-midnight of the selected day, not a rolling 24 h
 * window: a rolling day made "Hoy" include part of yesterday, which is wrong
 * for a log a clinician reads day by day.
 *
 * "Semana" and "Mes", by contrast, are rolling: the 7 or 30 days ending on
 * the selected day (today, by default), not the calendar week (Mon-Sun) or
 * calendar month (1st-to-1st) it falls in. A clinician asking "how has the
 * last month looked" means the 30 days up to today, not however much of the
 * current calendar month has elapsed - on the 2nd of the month that used to
 * be two days.
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

/** Days in the rolling "Semana"/"Mes" windows, anchor day included. */
const ROLLING_DAYS: Record<'week' | 'month', number> = { week: 7, month: 30 };

export function buildRange(kind: RangeKind, anchor: Date): DateRange {
  const to = addDays(startOfDay(anchor), 1); // exclusive, end of the anchor day

  if (kind === 'day') {
    return { fromMs: addDays(to, -1).getTime(), toMs: to.getTime(), kind, anchor };
  }

  const from = addDays(to, -ROLLING_DAYS[kind]);
  return { fromMs: from.getTime(), toMs: to.getTime(), kind, anchor };
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

  // Semana/Mes are rolling windows ending on the anchor day (today, by
  // default), not the calendar week/month - so the label spells out the
  // actual span instead of naming a week or month that may only be partly
  // covered.
  const last = new Date(range.toMs - 1);
  const sameMonth = from.getMonth() === last.getMonth() && from.getFullYear() === last.getFullYear();
  const left = sameMonth
    ? String(from.getDate())
    : `${from.getDate()} de ${MONTH_NAMES[from.getMonth()]}`;
  const right = `${last.getDate()} de ${MONTH_NAMES[last.getMonth()]} de ${last.getFullYear()}`;
  const label = range.kind === 'week' ? 'Últimos 7 días' : 'Últimos 30 días';
  return `${label}: ${left} al ${right}`;
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
