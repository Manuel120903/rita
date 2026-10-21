import { getDatabase } from '../db/database';
import type { SeverityLevel } from '../ble/constants';
import { addDays, startOfDay } from './ranges';

/**
 * Reserved device id for seeded demo data, never produced by a real wearable
 * (those come from the ESP32 firmware's own id). Tagging every demo row with
 * it is what makes seeding and clearing safe: both act only on these rows,
 * so a real BLE history already in the table is never touched.
 */
export const DEMO_DEVICE_ID = 9001;

interface DemoSeed {
  /** Measured ms between readings in this file. Coarser than the firmware's
   * own 0.32 s hop - see the loaders below - but still real, measured data. */
  cadenceMs: number;
  deviceTimestampMs: number[];
  rms: number[];
  psdMax: number[];
  severity: SeverityLevel[];
}

/**
 * The 16 real recording days available for patient 11 (tAteNDLe) across
 * ALAMEDA's two one-week intensive monitoring periods (Feb and Oct 2023 -
 * the protocol records one week every three months, so that's what the
 * dataset actually has; nothing here is synthesized to fill the gap between
 * them). Listed oldest first, so index 0 maps to the earliest of the trailing
 * calendar window below and the last entry always lands on "yesterday".
 *
 * Metro requires string literals for require() - it statically scans these to
 * decide what to bundle - so this cannot be built from a manifest file or a
 * loop over a directory listing. Each loader is a thunk so the ~2 MB parse
 * cost for a given day is paid only if seedDemoData() actually reaches it.
 */
const DAY_LOADERS: Array<() => DemoSeed> = [
  () => require('../assets/demo/patient11/2023-02-02.json'),
  () => require('../assets/demo/patient11/2023-02-03.json'),
  () => require('../assets/demo/patient11/2023-02-04.json'),
  () => require('../assets/demo/patient11/2023-02-05.json'),
  () => require('../assets/demo/patient11/2023-02-06.json'),
  () => require('../assets/demo/patient11/2023-02-07.json'),
  () => require('../assets/demo/patient11/2023-02-08.json'),
  () => require('../assets/demo/patient11/2023-02-09.json'),
  () => require('../assets/demo/patient11/2023-10-03.json'),
  () => require('../assets/demo/patient11/2023-10-04.json'),
  () => require('../assets/demo/patient11/2023-10-05.json'),
  () => require('../assets/demo/patient11/2023-10-06.json'),
  () => require('../assets/demo/patient11/2023-10-07.json'),
  () => require('../assets/demo/patient11/2023-10-08.json'),
  () => require('../assets/demo/patient11/2023-10-09.json'),
  () => require('../assets/demo/patient11/2023-10-10.json'),
];

/** Rows per executeBatch call. Keeps each native call small enough to not block the JS thread for long. */
const BATCH_SIZE = 2000;

async function insertDay(data: DemoSeed, dayStart: number): Promise<number> {
  const db = getDatabase();
  const n = data.deviceTimestampMs.length;
  if (n === 0) {
    return 0;
  }

  const firstDeviceMs = data.deviceTimestampMs[0];
  const insertSql = `INSERT INTO readings
      (device_timestamp_ms, received_at, rms, psd_max, severity, device_id)
    VALUES (?, ?, ?, ?, ?, ?)`;

  for (let offset = 0; offset < n; offset += BATCH_SIZE) {
    const end = Math.min(offset + BATCH_SIZE, n);
    const paramSets: (number | SeverityLevel)[][] = [];
    for (let i = offset; i < end; i++) {
      const receivedAt = dayStart + (data.deviceTimestampMs[i] - firstDeviceMs);
      paramSets.push([
        data.deviceTimestampMs[i],
        receivedAt,
        data.rms[i],
        data.psdMax[i],
        data.severity[i],
        DEMO_DEVICE_ID,
      ]);
    }
    await db.executeBatch([[insertSql, paramSets]]);
  }

  return n;
}

/**
 * Inserts all 16 real recording days through the same `readings` table real
 * BLE history lives in, so Calendar/HistoryScreen show it without any change
 * to how they read. The real-data pipeline (BleService, useTremorMonitor,
 * insertReading) is never imported or modified by this module.
 *
 * Each day is anchored to its own calendar-day boundary - not to a rolling
 * "now" - so it falls entirely inside one calendar date instead of splitting
 * across two (see insertDay / the note that used to be here on a single day).
 * The 16 days are mapped onto the 16 most recent calendar days ending
 * yesterday, oldest recording first, so the month view fills in as one
 * contiguous stretch instead of the real 8-month gap between the two
 * recording weeks.
 */
export async function seedDemoData(): Promise<number> {
  const today = startOfDay(new Date());
  let total = 0;
  for (let i = 0; i < DAY_LOADERS.length; i++) {
    const dayStart = addDays(today, i - DAY_LOADERS.length).getTime();
    const data = DAY_LOADERS[i]();
    total += await insertDay(data, dayStart);
  }
  return total;
}

export async function clearDemoData(): Promise<void> {
  const db = getDatabase();
  await db.execute('DELETE FROM readings WHERE device_id = ?', [DEMO_DEVICE_ID]);
}

export async function hasDemoData(): Promise<boolean> {
  const db = getDatabase();
  const { rows } = await db.execute(
    'SELECT 1 FROM readings WHERE device_id = ? LIMIT 1',
    [DEMO_DEVICE_ID],
  );
  return rows.length > 0;
}
