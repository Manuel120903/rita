import type { SeverityLevel } from '../ble/constants';

/**
 * Nominal time between readings, in ms: the firmware's own hop.
 *
 * It evaluates a 256-sample window every HOP_SIZE = 32 samples at 100 Hz, so each
 * notification summarizes 0.32 s of signal. This is only the FALLBACK, used when
 * there are too few readings to measure anything — see measureCadence. Durations
 * must not assume it: how often notifications actually arrive depends on the BLE
 * connection interval and on what the phone drops, and assuming 0.32 s while the
 * real spacing was, say, 1 s reported a third of the real tremor time.
 */
export const NOMINAL_CADENCE_MS = 320;

/** Kept for readability where the firmware's hop is what is meant. */
export const HOP_MS = NOMINAL_CADENCE_MS;

/**
 * Median time between consecutive readings, which is how long each one stands
 * for. The median, not the mean, so that outages and reconnections do not drag
 * the estimate: half the gaps would have to be inflated to move it.
 *
 * `timestamps` must be sorted ascending. Returns the nominal cadence when there
 * is not enough data to measure.
 */
export function measureCadence(timestamps: number[]): number {
  if (timestamps.length < 2) {
    return NOMINAL_CADENCE_MS;
  }

  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  if (gaps.length === 0) {
    return NOMINAL_CADENCE_MS;
  }

  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];

  // A median below the firmware's hop would mean notifications arriving faster
  // than they are produced, which cannot happen; treat it as the hop.
  return Math.max(NOMINAL_CADENCE_MS, median);
}

/**
 * How far apart two readings can be and still count as continuous, given the
 * measured cadence. Three intervals of tolerance absorbs jitter and the odd
 * dropped notification without bridging a real outage.
 *
 * Derived from the cadence rather than fixed, because a fixed 0.96 s threshold
 * against a real 1 s spacing split every single reading into its own run.
 */
export function maxGapMs(cadenceMs: number): number {
  return 3 * cadenceMs;
}

/** Legacy fixed threshold, kept only for the nominal cadence. */
export const MAX_GAP_MS = maxGapMs(NOMINAL_CADENCE_MS);

/**
 * How long tremor has to be absent before an episode is considered over.
 *
 * Separate from MAX_GAP_MS on purpose: that one is about data continuity (a lost
 * notification), this one is about clinical continuity. Tremor that stops for a
 * second and resumes is one episode, not two, and the firmware's own debounce is
 * already 2 windows (0.64 s), so a shorter Leve stretch is noise rather than a
 * real remission.
 *
 * It is also what makes the two ways of building episodes agree. Episodes are
 * formed only from the non-Leve runs, separated purely by the time between them,
 * so it makes no difference whether the Leve runs were filtered out in SQL (what
 * the app does, to avoid pulling millions of rows on the month view) or are
 * present and skipped here.
 */
export const EPISODE_GAP_MS = 2000;

/** A run of consecutive readings that share one severity level. */
export interface MotorPeriod {
  severity: SeverityLevel;
  startedAt: number;
  endedAt: number;
  sampleCount: number;
  /** Signal time covered, in ms. See HOP_MS. */
  durationMs: number;
}

/**
 * A stretch of tremor activity: one or more adjacent non-zero periods, merged.
 *
 * Severity 0 (Leve) is the "ON" / no-significant-tremor class, 1-2 are "OFF"
 * fluctuation. A single clinical episode can drift between Moderado and Severo,
 * so adjacent non-zero periods belong to the same episode; splitting per
 * severity value (as this used to) reported one episode as two or three and cut
 * its duration into pieces.
 */
export interface TremorEpisode {
  startedAt: number;
  endedAt: number;
  /** Worst severity reached during the episode. */
  maxSeverity: SeverityLevel;
  sampleCount: number;
  durationMs: number;
  /** The per-level periods that make up this episode, chronological. */
  periods: MotorPeriod[];
}

export interface SeverityRow {
  receivedAt: number;
  severity: SeverityLevel;
}

/**
 * Groups readings into periods, breaking on a severity change OR on a time gap.
 * Rows must be ordered by receivedAt ascending.
 *
 * The database does this in SQL for real queries (see getMotorPeriods); this
 * version exists for the cases where the rows are already in memory, and as the
 * reference implementation the tests check.
 */
export function buildPeriods(
  rows: SeverityRow[],
  cadenceMs: number = NOMINAL_CADENCE_MS,
): MotorPeriod[] {
  const periods: MotorPeriod[] = [];
  const gapLimit = maxGapMs(cadenceMs);

  for (const row of rows) {
    const last = periods[periods.length - 1];
    const continues =
      last !== undefined &&
      last.severity === row.severity &&
      row.receivedAt - last.endedAt <= gapLimit;

    if (continues) {
      last.endedAt = row.receivedAt;
      last.sampleCount += 1;
      last.durationMs = last.sampleCount * cadenceMs;
    } else {
      periods.push({
        severity: row.severity,
        startedAt: row.receivedAt,
        endedAt: row.receivedAt,
        sampleCount: 1,
        durationMs: cadenceMs,
      });
    }
  }

  return periods;
}

/**
 * Merges the non-Leve periods into episodes, separated by how much time passes
 * between them: more than EPISODE_GAP_MS without tremor ends the episode.
 *
 * Leve periods are skipped rather than treated as separators, so the result is
 * the same whether or not they are present in the input — see EPISODE_GAP_MS.
 * A long Leve stretch still ends the episode, because it shows up as a long gap
 * between the tremor periods on either side of it.
 */
export function buildEpisodes(periods: MotorPeriod[]): TremorEpisode[] {
  const episodes: TremorEpisode[] = [];
  let current: TremorEpisode | null = null;

  for (const period of periods) {
    if (period.severity === 0) {
      continue;
    }

    const contiguous =
      current !== null && period.startedAt - current.endedAt <= EPISODE_GAP_MS;

    if (current && contiguous) {
      current.endedAt = period.endedAt;
      current.sampleCount += period.sampleCount;
      current.durationMs += period.durationMs;
      current.periods.push(period);
      if (period.severity > current.maxSeverity) {
        current.maxSeverity = period.severity;
      }
    } else {
      current = {
        startedAt: period.startedAt,
        endedAt: period.endedAt,
        maxSeverity: period.severity,
        sampleCount: period.sampleCount,
        durationMs: period.durationMs,
        periods: [period],
      };
      episodes.push(current);
    }
  }

  return episodes;
}

/** Formats a duration for display: "2 h 15 min", "7 min", "12 s". */
export function formatDuration(ms: number): string {
  if (ms > 0 && ms < 1000) {
    // One reading is 0.32 s; "0 s" would read as nothing at all.
    return '<1 s';
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Compact form for stat tiles, which show the unit separately. */
export function formatDurationValue(ms: number): string {
  const totalMinutes = ms / 60000;
  if (totalMinutes < 1) {
    return String(Math.round(ms / 1000));
  }
  if (totalMinutes < 60) {
    return String(Math.round(totalMinutes));
  }
  return (totalMinutes / 60).toFixed(1);
}

export function durationUnit(ms: number): string {
  const totalMinutes = ms / 60000;
  if (totalMinutes < 1) {
    return 'segundos';
  }
  return totalMinutes < 60 ? 'minutos' : 'horas';
}
