import { open, type DB } from '@op-engineering/op-sqlite';
import type { TremorReading } from '../types/tremor';
import type { SeverityLevel } from '../ble/constants';
import {
  NOMINAL_CADENCE_MS,
  maxGapMs,
  measureCadence,
  type MotorPeriod,
} from '../lib/periods';

const DATABASE_NAME = 'tremor_monitor.db';

let dbInstance: DB | null = null;

export function getDatabase(): DB {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = open({ name: DATABASE_NAME });

  dbInstance.executeSync(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_timestamp_ms INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      rms REAL NOT NULL,
      psd_max REAL NOT NULL,
      severity INTEGER NOT NULL,
      device_id INTEGER NOT NULL
    );
  `);

  dbInstance.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_readings_received_at ON readings (received_at);',
  );

  // Covering index for the severity-filtered record list and its counter: with
  // it they are answered from the index alone. Measured on a month of continuous
  // recording (8.1M readings), the filtered count went from 564 ms to 3 ms.
  // Created once; on an existing large table the first run costs a one-off build.
  dbInstance.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_readings_severity_received ON readings (severity, received_at);',
  );

  return dbInstance;
}

export async function insertReading(reading: TremorReading): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `INSERT INTO readings
      (device_timestamp_ms, received_at, rms, psd_max, severity, device_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      reading.deviceTimestampMs,
      reading.receivedAt,
      reading.rms,
      reading.psdMax,
      reading.severity,
      reading.deviceId,
    ],
  );
}

export interface ReadingRow extends TremorReading {
  id: number;
}

/**
 * One page of readings, newest first, optionally restricted to one severity.
 * Paged in SQL: a day holds ~270k readings, so the list must never try to hold
 * them all — and it must never mount them all either (see HistoryScreen).
 */
export async function getReadingsPage(
  fromMs: number,
  toMs: number,
  severity: SeverityLevel | null,
  limit: number,
  offset: number,
): Promise<ReadingRow[]> {
  const db = getDatabase();
  const filtered = severity !== null;
  const sql =
    `SELECT id, device_timestamp_ms, received_at, rms, psd_max, severity, device_id
       FROM readings
      WHERE received_at >= ? AND received_at < ?` +
    (filtered ? ' AND severity = ?' : '') +
    ` ORDER BY received_at DESC
      LIMIT ? OFFSET ?`;

  const params = filtered
    ? [fromMs, toMs, severity, limit, offset]
    : [fromMs, toMs, limit, offset];

  const { rows } = await db.execute(sql, params);

  return rows.map(row => ({
    id: row.id as number,
    deviceTimestampMs: row.device_timestamp_ms as number,
    receivedAt: row.received_at as number,
    rms: row.rms as number,
    psdMax: row.psd_max as number,
    severity: row.severity as SeverityLevel,
    deviceId: row.device_id as number,
  }));
}

/** Readings sampled to measure the cadence. Enough for a stable median, cheap. */
const CADENCE_SAMPLE = 300;

/**
 * How far apart the readings in this range actually are, in ms.
 *
 * Measured instead of assumed. The firmware produces a window every 0.32 s, but
 * how often a notification reaches the phone depends on the BLE connection
 * interval and on what gets dropped, and every duration on this screen is
 * "number of readings times how long each one stands for". Assuming 0.32 s while
 * the real spacing was longer reported proportionally less tremor time than
 * actually happened.
 */
export async function getCadenceMs(fromMs: number, toMs: number): Promise<number> {
  const db = getDatabase();
  const { rows } = await db.execute(
    `SELECT received_at
       FROM readings
      WHERE received_at >= ? AND received_at < ?
      ORDER BY received_at ASC
      LIMIT ?`,
    [fromMs, toMs, CADENCE_SAMPLE],
  );

  return measureCadence(rows.map(row => row.received_at as number));
}

/**
 * Collapses consecutive readings into runs of equal severity.
 *
 * Done in SQL with window functions rather than by reading every row into JS:
 * at one reading per 0.32 s a single day holds ~270k rows, and a month's worth
 * would be millions. SQLite returns one row per run instead, which is a handful.
 *
 * A run breaks on a severity change OR on a gap longer than MAX_GAP_MS, so a
 * disconnection no longer merges the readings on either side of it into one
 * period whose duration swallows the whole outage.
 */
export async function getMotorPeriods(
  fromMs: number,
  toMs: number,
  onlyTremor = false,
  cadenceMs: number = NOMINAL_CADENCE_MS,
): Promise<MotorPeriod[]> {
  const db = getDatabase();
  // With onlyTremor the Leve readings never leave SQLite. That matters for the
  // month view: a month of continuous recording is ~8M readings, and asking for
  // every run would hand JS millions of rows. Tremor runs are a small fraction.
  // Dropping the Leve rows does not lose the episode boundaries, because a Leve
  // stretch then shows up as a time gap between two tremor runs, which is what
  // splits them anyway. A one-or-two-reading Leve blip falls inside the gap
  // tolerance and no longer splits an episode in two, which is the behaviour we
  // want and matches the debounce already applied in the firmware.
  const tremorOnlyClause = onlyTremor ? ' AND severity > 0' : '';
  const { rows } = await db.execute(
    `WITH ordered AS (
       SELECT received_at, severity,
              LAG(received_at) OVER (ORDER BY received_at) AS prev_at,
              LAG(severity)    OVER (ORDER BY received_at) AS prev_severity
         FROM readings
        WHERE received_at >= ? AND received_at < ?${tremorOnlyClause}
     ),
     marked AS (
       SELECT received_at, severity,
              CASE
                WHEN prev_at IS NULL
                  OR severity <> prev_severity
                  OR received_at - prev_at > ?
                THEN 1 ELSE 0
              END AS is_start
         FROM ordered
     ),
     grouped AS (
       SELECT received_at, severity,
              SUM(is_start) OVER (ORDER BY received_at ROWS UNBOUNDED PRECEDING) AS run_id
         FROM marked
     )
     SELECT run_id,
            severity,
            MIN(received_at) AS started_at,
            MAX(received_at) AS ended_at,
            COUNT(*)         AS sample_count
       FROM grouped
      GROUP BY run_id
      ORDER BY started_at ASC`,
    [fromMs, toMs, maxGapMs(cadenceMs)],
  );

  return rows.map(row => {
    const sampleCount = row.sample_count as number;
    return {
      severity: row.severity as SeverityLevel,
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      sampleCount,
      durationMs: sampleCount * cadenceMs,
    };
  });
}

export interface SeveritySummary {
  /** Reading counts per severity level, index = level. */
  counts: [number, number, number];
  /** Signal time per severity level, ms. */
  durationsMs: [number, number, number];
  totalReadings: number;
  /** Time with any tremor (severity 1-2), ms. */
  tremorDurationMs: number;
  avgRms: number | null;
  maxRms: number | null;
  firstAt: number | null;
  lastAt: number | null;
}

export interface SeverityBucket {
  index: number;
  counts: [number, number, number];
  avgRms: number | null;
  maxRms: number | null;
  /** Sum of rms in the bucket, so range totals can be derived by adding buckets. */
  sumRms: number;
  firstAt: number | null;
  lastAt: number | null;
}

/**
 * Derives the range summary by adding up the buckets, instead of asking SQLite
 * for it separately.
 *
 * The buckets tile the range exactly — no gaps, no overlap — so the sums are the
 * same numbers a GROUP BY over the range would produce, and the pagination count
 * comes out of them too. That removed two full scans of the range: measured on a
 * month of continuous recording (8.1M readings) the summary and the count cost
 * 3.3 s and 0.6 s on their own, while the buckets had already read every one of
 * those rows.
 */
export function summaryFromBuckets(
  buckets: SeverityBucket[],
  cadenceMs: number = NOMINAL_CADENCE_MS,
): SeveritySummary {
  const counts: [number, number, number] = [0, 0, 0];
  let sumRms = 0;
  let maxRms: number | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const bucket of buckets) {
    counts[0] += bucket.counts[0];
    counts[1] += bucket.counts[1];
    counts[2] += bucket.counts[2];
    sumRms += bucket.sumRms;

    if (bucket.maxRms !== null && (maxRms === null || bucket.maxRms > maxRms)) {
      maxRms = bucket.maxRms;
    }
    if (bucket.firstAt !== null && (firstAt === null || bucket.firstAt < firstAt)) {
      firstAt = bucket.firstAt;
    }
    if (bucket.lastAt !== null && (lastAt === null || bucket.lastAt > lastAt)) {
      lastAt = bucket.lastAt;
    }
  }

  const totalReadings = counts[0] + counts[1] + counts[2];

  return {
    counts,
    durationsMs: [counts[0] * cadenceMs, counts[1] * cadenceMs, counts[2] * cadenceMs],
    totalReadings,
    tremorDurationMs: (counts[1] + counts[2]) * cadenceMs,
    avgRms: totalReadings > 0 ? sumRms / totalReadings : null,
    maxRms,
    firstAt,
    lastAt,
  };
}

/**
 * Aggregates the range into `count` fixed-width buckets for the charts, in SQL.
 * Empty buckets are filled in here so the chart can assume a dense series.
 */
export async function getSeverityBuckets(
  fromMs: number,
  toMs: number,
  bucketMs: number,
  count: number,
): Promise<SeverityBucket[]> {
  const db = getDatabase();
  const { rows } = await db.execute(
    `SELECT CAST((received_at - ?) / ? AS INTEGER) AS bucket,
            SUM(CASE WHEN severity = 0 THEN 1 ELSE 0 END) AS s0,
            SUM(CASE WHEN severity = 1 THEN 1 ELSE 0 END) AS s1,
            SUM(CASE WHEN severity = 2 THEN 1 ELSE 0 END) AS s2,
            AVG(rms) AS avg_rms,
            MAX(rms) AS max_rms,
            SUM(rms) AS sum_rms,
            MIN(received_at) AS first_at,
            MAX(received_at) AS last_at
       FROM readings
      WHERE received_at >= ? AND received_at < ?
      GROUP BY bucket
      ORDER BY bucket ASC`,
    [fromMs, bucketMs, fromMs, toMs],
  );

  const buckets: SeverityBucket[] = [];
  for (let i = 0; i < count; i++) {
    buckets.push({
      index: i,
      counts: [0, 0, 0],
      avgRms: null,
      maxRms: null,
      sumRms: 0,
      firstAt: null,
      lastAt: null,
    });
  }

  for (const row of rows) {
    const index = Math.floor(row.bucket as number);
    if (index < 0 || index >= count) {
      continue;
    }
    buckets[index] = {
      index,
      counts: [row.s0 as number, row.s1 as number, row.s2 as number],
      avgRms: row.avg_rms as number | null,
      maxRms: row.max_rms as number | null,
      sumRms: (row.sum_rms as number | null) ?? 0,
      firstAt: row.first_at as number | null,
      lastAt: row.last_at as number | null,
    };
  }

  return buckets;
}

/**
 * Local-midnight timestamps of the days holding at least one reading, so the
 * calendar can mark them. Grouping by a UTC-derived day string would put
 * readings on the wrong day for any non-UTC timezone, so the day key is
 * computed from the local offset instead.
 */
export async function getDaysWithData(fromMs: number, toMs: number): Promise<number[]> {
  const db = getDatabase();
  const offsetMs = -new Date().getTimezoneOffset() * 60_000;
  const { rows } = await db.execute(
    `SELECT DISTINCT CAST((received_at + ?) / 86400000 AS INTEGER) AS day_index
       FROM readings
      WHERE received_at >= ? AND received_at < ?`,
    [offsetMs, fromMs, toMs],
  );

  return rows.map(row => Math.floor(row.day_index as number) * 86_400_000 - offsetMs);
}

/** Minutes with tremor (severity 1-2) per weekday, index 0 = Sunday ... 6 = Saturday. */
export async function getTremorMinutesByWeekday(
  fromMs: number,
  toMs: number,
  cadenceMs: number = NOMINAL_CADENCE_MS,
): Promise<number[]> {
  const db = getDatabase();
  const offsetMs = -new Date().getTimezoneOffset() * 60_000;
  const { rows } = await db.execute(
    `SELECT CAST(strftime('%w', (received_at + ?) / 1000, 'unixepoch') AS INTEGER) AS wd,
            SUM(CASE WHEN severity > 0 THEN 1 ELSE 0 END) AS tremor_count
       FROM readings
      WHERE received_at >= ? AND received_at < ?
      GROUP BY wd`,
    [offsetMs, fromMs, toMs],
  );

  const minutes = new Array(7).fill(0);
  for (const row of rows) {
    const wd = row.wd as number;
    if (wd >= 0 && wd < 7) {
      minutes[wd] = ((row.tremor_count as number) * cadenceMs) / 60_000;
    }
  }
  return minutes;
}

/** Minutes with tremor (severity 1-2) per hour of day, index 0-23, local time. */
export async function getTremorMinutesByHour(
  fromMs: number,
  toMs: number,
  cadenceMs: number = NOMINAL_CADENCE_MS,
): Promise<number[]> {
  const db = getDatabase();
  const offsetMs = -new Date().getTimezoneOffset() * 60_000;
  const { rows } = await db.execute(
    `SELECT CAST(strftime('%H', (received_at + ?) / 1000, 'unixepoch') AS INTEGER) AS hr,
            SUM(CASE WHEN severity > 0 THEN 1 ELSE 0 END) AS tremor_count
       FROM readings
      WHERE received_at >= ? AND received_at < ?
      GROUP BY hr`,
    [offsetMs, fromMs, toMs],
  );

  const minutes = new Array(24).fill(0);
  for (const row of rows) {
    const hr = row.hr as number;
    if (hr >= 0 && hr < 24) {
      minutes[hr] = ((row.tremor_count as number) * cadenceMs) / 60_000;
    }
  }
  return minutes;
}

export async function clearHistory(): Promise<void> {
  const db = getDatabase();
  await db.execute('DELETE FROM readings;');
}
