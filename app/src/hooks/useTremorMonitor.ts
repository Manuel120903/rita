import { useCallback, useEffect, useRef, useState } from 'react';
import { tremorBle, type BleConnectionStatus } from '../ble/BleService';
import { insertReading } from '../db/database';
import type { TremorReading } from '../types/tremor';

/** Readings kept in memory for the live chart (~19 s at one per 0.32 s). */
const HISTORY_WINDOW = 60;

export function useTremorMonitor() {
  const [status, setStatus] = useState<BleConnectionStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [latest, setLatest] = useState<TremorReading | null>(null);
  const [readingsHistory, setReadingsHistory] = useState<TremorReading[]>([]);
  const readingsWindow = useRef<TremorReading[]>([]);

  useEffect(() => {
    const unsubscribeStatus = tremorBle.onStatusChange((newStatus, message) => {
      setStatus(newStatus);
      setErrorMessage(message);
    });

    const unsubscribeReading = tremorBle.onReading(reading => {
      setLatest(reading);

      readingsWindow.current = [...readingsWindow.current, reading].slice(-HISTORY_WINDOW);
      setReadingsHistory(readingsWindow.current);

      // Persisted for the history screen, which reads it on its own schedule.
      // It deliberately does NOT get told about every insert: re-querying and
      // re-grouping the whole selected range three times a second does not
      // scale, and the history screen reloads on filter change and pull to
      // refresh instead.
      insertReading(reading).catch(err =>
        console.warn('No se pudo guardar la lectura en SQLite', err),
      );
    });

    return () => {
      unsubscribeStatus();
      unsubscribeReading();
    };
  }, []);

  const connect = useCallback(() => {
    tremorBle.connect();
  }, []);

  const disconnect = useCallback(() => {
    tremorBle.disconnect();
  }, []);

  return { status, errorMessage, latest, readingsHistory, connect, disconnect };
}
