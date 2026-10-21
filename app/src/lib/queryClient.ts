import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton query client for the SQLite reads behind the history charts.
 *
 * `staleTime: Infinity` on purpose: this app already has a deliberate
 * philosophy of not re-querying on every insert (see the comment on
 * useTremorMonitor - the live BLE stream does not tell HistoryScreen about
 * every reading, because re-querying 3x/second does not scale). A cached
 * query here should behave the same way - good until something explicitly
 * invalidates it (pull-to-refresh, clearing history, loading/clearing demo
 * data), not on a timer. Without this, revisiting a range you already looked
 * at would silently refetch from SQLite instead of returning instantly from
 * cache, which is the exact "tarda" this cache exists to fix.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: false,
    },
  },
});
