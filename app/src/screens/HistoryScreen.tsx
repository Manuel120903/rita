import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SEVERITY_LABELS, type SeverityLevel } from '../ble/constants';
import { BarMetricChart } from '../components/BarMetricChart';
import { Calendar } from '../components/Calendar';
import { DayBreakdown } from '../components/DayBreakdown';
import { EventCard } from '../components/EventCard';
import { HistoryChart } from '../components/HistoryChart';
import { PeriodSelector } from '../components/PeriodSelector';
import { SeverityFilter, type SeverityFilterValue } from '../components/SeverityFilter';
import { StatTile } from '../components/StatTile';
import { AnalyticsIcon, CalendarIcon, DocumentIcon, PulseIcon } from '../components/icons';
import {
  clearHistory,
  getDaysWithData,
  getMotorPeriods,
  getCadenceMs,
  getReadingsPage,
  getSeverityBuckets,
  getTremorMinutesByHour,
  getTremorMinutesByWeekday,
  summaryFromBuckets,
  type ReadingRow,
  type SeverityBucket,
  type SeveritySummary,
} from '../db/database';
import { clearDemoData, hasDemoData, seedDemoData } from '../lib/demoSeed';
import { sharePdf } from '../lib/exportPdf';
import {
  NOMINAL_CADENCE_MS,
  buildEpisodes,
  durationUnit,
  formatDurationValue,
  type TremorEpisode,
} from '../lib/periods';
import {
  addMonths,
  buildRange,
  bucketPlan,
  describeRange,
  startOfDay,
  startOfMonth,
  type RangeKind,
} from '../lib/ranges';
import { buildReportPdf, reportFileName, reportSubject } from '../lib/report';

/**
 * How many rows get mounted at a time.
 *
 * These caps are not cosmetic: nothing on this screen is virtualized, so a page
 * size is the only thing keeping the view count bounded. Records are paged in SQL
 * too, since a single day of recording holds ~270k of them.
 */
const EPISODES_PAGE = 15;
const READINGS_PAGE = 50;

/**
 * Ceiling on how many record rows can be on screen at once.
 *
 * The list is a plain ScrollView now (see the note on the return), so every row
 * paged in stays mounted. 500 simple rows is comfortable; beyond that the range
 * filter or the calendar is the right tool, not more scrolling.
 */
const READINGS_MAX = 500;

const SEVERITY_DOT: Record<SeverityLevel, string> = {
  0: 'bg-mild',
  1: 'bg-moderate',
  2: 'bg-severe',
};

/**
 * Shared empty values, so clearing an already-empty list is not a state change.
 * A fresh `[]` is a new identity and would count as one, which is how an effect
 * that clears state ends up re-triggering itself.
 */
const EMPTY_BUCKETS: SeverityBucket[] = [];
const EMPTY_EPISODES: TremorEpisode[] = [];
const EMPTY_WEEKDAY: number[] = [0, 0, 0, 0, 0, 0, 0];
const EMPTY_HOUR: number[] = new Array(24).fill(0);

/** Sunday-first, matching how strftime('%w', ...) numbers weekdays in SQLite. */
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

const EMPTY_SUMMARY: SeveritySummary = {
  counts: [0, 0, 0],
  durationsMs: [0, 0, 0],
  totalReadings: 0,
  tremorDurationMs: 0,
  avgRms: null,
  maxRms: null,
  firstAt: null,
  lastAt: null,
};

function ReadingRowItem({ reading }: { reading: ReadingRow }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-2.5 bg-surface border-b border-surface-container">
      <View className="flex-row items-center gap-2">
        <View className={`w-2 h-2 rounded-full ${SEVERITY_DOT[reading.severity]}`} />
        <Text className="text-secondary text-xs">
          {new Date(reading.receivedAt).toLocaleTimeString()}
        </Text>
      </View>
      <Text className="text-on-surface text-xs">RMS {reading.rms.toFixed(3)}</Text>
      <Text className="text-on-surface text-xs">PSD {reading.psdMax.toFixed(3)}</Text>
      <Text className="text-secondary text-xs">{SEVERITY_LABELS[reading.severity]}</Text>
    </View>
  );
}

/**
 * Wrapped in React.memo, and it matters: the BLE subscription lives in App, so
 * App re-renders on every incoming reading (about three per second). Without
 * memo that propagated here and re-rendered this whole screen three times a
 * second while an INSERT ran alongside it. Taking no props means memo skips
 * those re-renders entirely; this screen only re-renders for its own state.
 */
export const HistoryScreen = React.memo(function HistoryScreenView() {
  const [kind, setKind] = useState<RangeKind>('day');

  // Dates are held as plain timestamps, not Date objects.
  //
  // A Date in state is a new object every time it is set, and it feeds `range`,
  // which feeds the dependency arrays of the effects below. One stray identity
  // change there and an effect that writes state re-runs on every render, which
  // is an infinite render loop: the JS thread never gets free again and the whole
  // app stops responding to touches. Numbers compare by value, so the effects can
  // only fire when the range genuinely changed.
  const [anchorMs, setAnchorMs] = useState<number>(() => startOfDay(new Date()).getTime());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonthMs, setVisibleMonthMs] = useState<number>(() =>
    startOfMonth(new Date()).getTime(),
  );
  const [severity, setSeverity] = useState<SeverityFilterValue>(null);

  const [episodes, setEpisodes] = useState<TremorEpisode[]>(EMPTY_EPISODES);
  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const [cadence, setCadence] = useState(NOMINAL_CADENCE_MS);
  const [daysWithData, setDaysWithData] = useState<number[]>([]);

  const [episodeLimit, setEpisodeLimit] = useState(EPISODES_PAGE);
  const [readingLimit, setReadingLimit] = useState(READINGS_PAGE);

  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Demo data (patient 11 of the ALAMEDA dataset, replayed through the same
  // DSP/classifier the firmware uses) is tagged with its own device id and
  // never touches the real BLE insert path - see lib/demoSeed.
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const anchor = useMemo(() => new Date(anchorMs), [anchorMs]);
  const visibleMonth = useMemo(() => new Date(visibleMonthMs), [visibleMonthMs]);
  const range = useMemo(() => buildRange(kind, anchor), [kind, anchor]);
  const queryClient = useQueryClient();

  /**
   * The three chart queries (bucket chart, weekday, hour-of-day), cached by
   * TanStack Query instead of the manual load()/state pattern the rest of
   * this screen uses. This is what fixes "Por día" being slow to show: SQLite
   * only gets hit once per distinct range, and switching back to a range
   * already seen (Día <-> Semana, or re-selecting a day from the calendar)
   * renders from cache instantly instead of re-querying. `staleTime: Infinity`
   * on the client (see lib/queryClient) means these never refetch on their
   * own - only on pull-to-refresh or after an action that actually changed
   * the data (clearHistory, demo load/clear), which explicitly invalidate
   * them below.
   *
   * None of severity/episodeLimit/readingLimit are in these query keys: the
   * bucket counts and the weekday/hour aggregates don't depend on the
   * severity filter or on how many rows are paged in, so toggling those no
   * longer triggers a bucket requery the way the old single load() did.
   */
  const bucketPlanForRange = useMemo(() => bucketPlan(range), [range]);
  const bucketsQuery = useQuery({
    queryKey: ['history-buckets', range.fromMs, range.toMs, bucketPlanForRange.bucketMs],
    queryFn: () =>
      getSeverityBuckets(
        range.fromMs,
        range.toMs,
        bucketPlanForRange.bucketMs,
        bucketPlanForRange.count,
      ),
  });
  const buckets = bucketsQuery.data ?? EMPTY_BUCKETS;
  const summary = useMemo(
    () => (bucketsQuery.data ? summaryFromBuckets(bucketsQuery.data, cadence) : EMPTY_SUMMARY),
    [bucketsQuery.data, cadence],
  );
  // The readings list's pagination total: same severity-aware count the old
  // load() used to copy out of its own buckets fetch, now read straight off
  // the cached one instead.
  const readingTotal = severity === null ? summary.totalReadings : summary.counts[severity];

  const weekdayQuery = useQuery({
    queryKey: ['history-weekday', range.fromMs, range.toMs, cadence],
    queryFn: () => getTremorMinutesByWeekday(range.fromMs, range.toMs, cadence),
  });
  const weekdayMinutes = weekdayQuery.data ?? EMPTY_WEEKDAY;

  const hourQuery = useQuery({
    queryKey: ['history-hour', range.fromMs, range.toMs, cadence],
    queryFn: () => getTremorMinutesByHour(range.fromMs, range.toMs, cadence),
  });
  const hourMinutes = hourQuery.data ?? EMPTY_HOUR;

  /**
   * Drops every cached chart query. Nothing else lives in this client (see
   * lib/queryClient), so an unfiltered invalidation is exactly "re-fetch the
   * charts" - called after anything that actually changes the underlying
   * data: pull-to-refresh, clearing history, loading/clearing demo data.
   */
  const invalidateCharts = useCallback(() => queryClient.invalidateQueries(), [queryClient]);

  /**
   * Which range the rows in state actually belong to, checked DURING the render.
   *
   * This is the important part, not an optimisation. Clearing stale rows from an
   * effect is too late: the render right after the tap already happened with the
   * new range and the previous range's rows, so the chart got a week to draw with
   * 24 hourly buckets, and the per-day breakdown was mounted for the first time
   * with data that did not describe its range. Comparing keys while rendering
   * means that combination is never built at all — the screen shows a spinner
   * until the rows match the range on screen.
   */
  const dataKey = `${range.fromMs}|${range.toMs}|${severity ?? 'all'}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const dataReady = loadedKey === dataKey;

  // Changing the range or the severity filter starts the lists over, and shows
  // the spinner again: without it a slow query looks like the screen froze.
  //
  // The dependencies are the range's timestamps, not the range object, and the
  // empty values are shared constants rather than fresh `[]` literals. Both
  // matter: this effect writes state, so if it could re-run on an unchanged
  // range it would feed itself forever.
  useEffect(() => {
    setEpisodeLimit(EPISODES_PAGE);
    setReadingLimit(READINGS_PAGE);
    // Drop the previous range's episodes too. Otherwise the render between the
    // tap and the query landing mixes the new range with the old ones. Buckets
    // don't need this: bucketsQuery is keyed by range, so a still-loading new
    // key never reads as the old range's data (see the comment on the query).
    setEpisodes(EMPTY_EPISODES);
  }, [range.fromMs, range.toMs, severity]);

  // Identifies the newest load, so results from a superseded one are dropped.
  // Tapping Día/Semana/Mes quickly starts several loads, and without this the
  // slowest one wins and the screen ends up showing the wrong range.
  const loadToken = useRef(0);

  // Every query is wrapped. Without it a throw left the screen waiting forever on
  // empty data, which also kept the export button disabled — controls that look
  // broken with nothing on screen saying why. The catch marks the range as loaded
  // so the error shows instead of an endless spinner.
  const load = useCallback(async () => {
    const token = ++loadToken.current;

    // Rebuilt here from the primitives rather than closed over, so this
    // callback's identity depends on values, not on an object.
    const activeRange = buildRange(kind, new Date(anchorMs));
    const key = `${activeRange.fromMs}|${activeRange.toMs}|${severity ?? 'all'}`;

    try {
      // First, how far apart the readings in this range actually are. Everything
      // that reports a duration is "how many readings times how long each stands
      // for", so this has to be measured before any of it — see getCadenceMs.
      // The bucket chart and the weekday/hour aggregates no longer go through
      // here - they're their own cached queries (bucketsQuery/weekdayQuery/
      // hourQuery, above) - but episodes and this cadence measurement still do.
      const nextCadence = await getCadenceMs(activeRange.fromMs, activeRange.toMs);

      // Episodes are loaded for every range, week and month included.
      //
      // They were restricted to a single day for a while, on the theory that this
      // query was what froze the screen. It was not — the freeze was in the native
      // commit, fixed by the `key` on the subtree — and the restriction meant the
      // screen reported no episodes for a week or a month while the PDF, which
      // fetched them separately, reported them correctly. Contradicting itself is
      // worse than being slow.
      //
      // The cost is bounded by asking SQLite for the tremor runs only: the Leve
      // readings are the overwhelming majority and never leave the database.
      const periods = await getMotorPeriods(
        activeRange.fromMs,
        activeRange.toMs,
        true,
        nextCadence,
      );

      const nextReadings = await getReadingsPage(
        activeRange.fromMs,
        activeRange.toMs,
        severity,
        readingLimit,
        0,
      );

      if (token !== loadToken.current) {
        return; // a newer load already started
      }

      setCadence(nextCadence);
      setEpisodes(buildEpisodes(periods).reverse());
      setReadings(nextReadings);
      setError(null);
      setLoadedKey(key);
    } catch (err) {
      if (token !== loadToken.current) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn('No se pudo leer el historial', err);
      setEpisodes(EMPTY_EPISODES);
      setReadings([]);
      setError(message);
      // The empty rows do belong to this range, so the screen can stop waiting
      // and show the error instead of a spinner that never ends.
      setLoadedKey(key);
    }
    // Primitives only, never the range object — see the note on anchorMs about
    // why an identity change here is fatal.
  }, [kind, anchorMs, severity, readingLimit]);

  // Calendar markers cover the visible month, independently of the filter. A
  // failure here only costs the dots, so it must not take the screen down.
  const loadMarkers = useCallback(async () => {
    try {
      const month = new Date(visibleMonthMs);
      const from = startOfMonth(month).getTime();
      const to = addMonths(month, 1).getTime();
      setDaysWithData(await getDaysWithData(from, to));
    } catch (err) {
      console.warn('No se pudieron marcar los días con datos', err);
      setDaysWithData([]);
    }
  }, [visibleMonthMs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMarkers();
  }, [loadMarkers]);

  useEffect(() => {
    hasDemoData()
      .then(setDemoLoaded)
      .catch(() => setDemoLoaded(false));
  }, []);

  const onToggleDemo = useCallback(() => {
    if (demoLoaded) {
      Alert.alert('Quitar datos de demostración', 'Se eliminan solo las mediciones de demostración (paciente 11, dataset ALAMEDA). El historial real del sensor no se toca.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            setDemoBusy(true);
            try {
              await clearDemoData();
              setDemoLoaded(false);
              invalidateCharts();
              await Promise.all([load(), loadMarkers()]);
            } catch (err) {
              Alert.alert('No se pudo quitar', err instanceof Error ? err.message : String(err));
            } finally {
              setDemoBusy(false);
            }
          },
        },
      ]);
      return;
    }

    Alert.alert('Cargar datos de demostración', '16 días reales de un paciente del dataset público ALAMEDA (acelerómetro GENEActiv), procesados con el mismo algoritmo del firmware y ubicados en los últimos 16 días del calendario. Se suma al historial sin afectar las mediciones del sensor.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cargar',
        onPress: async () => {
          setDemoBusy(true);
          try {
            await seedDemoData();
            setDemoLoaded(true);
            invalidateCharts();
            await Promise.all([load(), loadMarkers()]);
          } catch (err) {
            Alert.alert('No se pudo cargar', err instanceof Error ? err.message : String(err));
          } finally {
            setDemoBusy(false);
          }
        },
      },
    ]);
  }, [demoLoaded, load, loadMarkers, invalidateCharts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    invalidateCharts();
    await Promise.all([load(), loadMarkers()]);
    setRefreshing(false);
  }, [load, loadMarkers, invalidateCharts]);

  const onShowMoreReadings = useCallback(() => {
    setLoadingMore(true);
    setReadingLimit(limit => Math.min(READINGS_MAX, limit + READINGS_PAGE));
  }, []);

  useEffect(() => {
    if (loadingMore) {
      setLoadingMore(false);
    }
  }, [readings, loadingMore]);

  const onClear = useCallback(() => {
    Alert.alert(
      'Borrar historial',
      'Se eliminan todas las mediciones guardadas. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearHistory();
              setDemoLoaded(false);
            } catch (err) {
              Alert.alert('No se pudo borrar', err instanceof Error ? err.message : String(err));
            }
            invalidateCharts();
            await Promise.all([load(), loadMarkers()]);
          },
        },
      ],
    );
  }, [load, loadMarkers, invalidateCharts]);

  const onSelectDay = useCallback((day: Date) => {
    setAnchorMs(startOfDay(day).getTime());
    setCalendarOpen(false);
  }, []);

  const onChangeMonth = useCallback((month: Date) => {
    setVisibleMonthMs(startOfMonth(month).getTime());
  }, []);

  /** Drill down from the week/month breakdown into a single day. */
  const onSelectDayFromBreakdown = useCallback((day: Date) => {
    setKind('day');
    setAnchorMs(startOfDay(day).getTime());
    setVisibleMonthMs(startOfMonth(day).getTime());
  }, []);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      // The PDF always covers the full range, regardless of what the lists are
      // currently paging through or filtering. The episodes are the same ones on
      // screen, just back in chronological order for the document.
      const base64 = buildReportPdf({
        range,
        summary,
        episodes: [...episodes].reverse(),
        buckets,
        generatedAt: Date.now(),
        cadenceMs: cadence,
        weekdayMinutes,
        hourMinutes,
      });

      const outcome = await sharePdf(base64, reportFileName(range), reportSubject(range));

      if (outcome.status === 'module-missing') {
        Alert.alert(
          'Falta instalar react-native-share',
          'El PDF se generó correctamente, pero para compartirlo hace falta la dependencia nativa.\n\n' +
            'Corré "pnpm install" y volvé a compilar la app con "pnpm android".',
        );
      } else if (outcome.status === 'error') {
        Alert.alert('No se pudo compartir el PDF', outcome.message);
      }
    } catch (err) {
      Alert.alert('No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [range, summary, episodes, buckets, cadence, weekdayMinutes, hourMinutes]);

  // Episodes are stretches of tremor, so they only exist for Moderado/Severo.
  const filteredEpisodes = useMemo(
    () => (severity === null ? episodes : episodes.filter(e => e.maxSeverity === severity)),
    [episodes, severity],
  );
  const visibleEpisodes = useMemo(
    () => filteredEpisodes.slice(0, episodeLimit),
    [filteredEpisodes, episodeLimit],
  );

  const isDay = range.kind === 'day';
  const hasData = summary.totalReadings > 0;
  const hasMoreReadings = readings.length < readingTotal && readings.length < READINGS_MAX;

  // Headline stat for week/month, where episodes are not loaded: how many of the
  // days in the range recorded any tremor at all.
  const daysWithTremor = useMemo(
    () => buckets.filter(b => b.counts[1] + b.counts[2] > 0).length,
    [buckets],
  );

  return (
    /*
     * A plain ScrollView, not a FlatList.
     *
     * Every control on this screen used to live in the FlatList's
     * ListHeaderComponent, and that header changes height when the filter is
     * tapped (the chart is swapped for a spinner). A VirtualizedList whose header
     * resizes is a known source of layout measurement loops, and a loop there
     * blocks everything — which is exactly what the logs showed: the tap arrived,
     * the render started, and then no effect ran and the heartbeat stopped, with
     * no data involved at all (0 readings).
     *
     * Virtualization is not needed here anyway: the records are paged, so the
     * list holds 50 rows at a time, and each row is three Text nodes.
     */
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b61c25" />
      }>
      {/*
        `key={kind}` a propósito: fuerza a React a REMONTAR este subárbol cuando
        cambia el rango, en vez de actualizar las vistas nativas existentes.

        El cuelgue está en ese camino de actualización, y quedó acotado por
        bisección: con el nivel de render en 0 —sin consultas, sin gráfico, sin
        listas, sin calendario, sin tarjetas— cambiar de día a semana igual
        colgaba la app, y eso deja solo el commit nativo de un árbol mínimo.
        Montar de cero, en cambio, siempre funcionó: la carga inicial y el cambio
        de día por el calendario pasan por ahí sin problema.

        El costo es rearmar el subárbol al cambiar de filtro, que es lo mismo que
        haría una librería de navegación al cambiar de pantalla.
      */}
      <View key={kind} className="gap-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-on-surface text-2xl font-bold">Historial</Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={onToggleDemo}
                disabled={demoBusy}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high">
                {demoBusy ? (
                  <ActivityIndicator color="#5b5f63" size="small" />
                ) : (
                  <Text className="text-secondary text-xs font-semibold">
                    {demoLoaded ? 'Quitar demo' : 'Cargar demo'}
                  </Text>
                )}
              </Pressable>
              <Pressable onPress={onClear} className="px-3 py-1.5 rounded-lg bg-surface-container-high">
                <Text className="text-secondary text-xs font-semibold">Borrar</Text>
              </Pressable>
            </View>
          </View>

          {error !== null && (
            <View className="bg-primary-container rounded-2xl p-4 gap-2">
              <Text className="text-on-primary-container font-bold text-sm">
                No se pudo leer el historial
              </Text>
              <Text className="text-on-primary-container text-xs">{error}</Text>
              <Pressable
                onPress={() => {
                  setLoadedKey(null);
                  load();
                }}
                className="self-start px-3 py-1.5 rounded-lg bg-surface">
                <Text className="text-primary text-xs font-bold">Reintentar</Text>
              </Pressable>
            </View>
          )}

          <PeriodSelector value={kind} onChange={setKind} />

          <View className="gap-2">
            {/*
              El nombre del rango va en su propia línea, a lo ancho, sin `flex-1`
              y sin `numberOfLines`. Antes estaba dentro del Pressable como
              `<Text className="flex-1" numberOfLines={1}>`: ese Text tiene que
              crecer para llenar la fila y a la vez recortarse a una línea, así que
              el ancho depende de la medición del texto y la medición del ancho.
              Evitable, y con etiquetas largas como la de semana es pedirle al
              motor de layout una negociación que no hace falta.
            */}
            <Text className="text-on-surface text-sm">{describeRange(range)}</Text>

            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setCalendarOpen(open => !open)}
                className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-xl px-3 py-2.5 shadow-sm">
                <CalendarIcon size={18} />
                <Text className="text-secondary text-xs font-semibold">
                  {calendarOpen ? 'Cerrar calendario' : 'Elegir día'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  const today = startOfDay(new Date());
                  setAnchorMs(today.getTime());
                  setVisibleMonthMs(startOfMonth(today).getTime());
                }}
                className="px-4 py-2.5 rounded-xl bg-surface-container">
                <Text className="text-secondary text-xs font-semibold">Hoy</Text>
              </Pressable>
            </View>
          </View>

          {calendarOpen && (
            <Calendar
              value={anchor}
              visibleMonth={visibleMonth}
              onChangeMonth={onChangeMonth}
              onSelectDay={onSelectDay}
              daysWithData={daysWithData}
            />
          )}

          {/* Dos filas de dos, no un flex-wrap: ver la nota en StatTile. */}
          <View className="gap-3">
          <View className="flex-row gap-3">
            {/* Siempre "Episodios", en todos los rangos: que la pantalla y el PDF
                cuenten lo mismo. */}
            <StatTile
              label="Episodios"
              value={String(episodes.length)}
              unit="detectados"
              icon={<AnalyticsIcon size={18} />}
              animateOnChange
            />
            <StatTile
              label="Tiempo con temblor"
              value={formatDurationValue(summary.tremorDurationMs)}
              unit={durationUnit(summary.tremorDurationMs)}
              icon={<PulseIcon size={18} />}
              animateOnChange
            />
          </View>
          <View className="flex-row gap-3">
            {isDay ? (
              <StatTile
                label="RMS promedio"
                value={summary.avgRms !== null ? summary.avgRms.toFixed(3) : '--'}
                unit="m/s²"
                icon={<PulseIcon size={18} />}
                animateOnChange
              />
            ) : (
              <StatTile
                label="Días con temblor"
                value={String(daysWithTremor)}
                unit={`de ${buckets.length}`}
                icon={<AnalyticsIcon size={18} />}
                animateOnChange
              />
            )}
            <StatTile
              label="RMS máximo"
              value={summary.maxRms !== null ? summary.maxRms.toFixed(3) : '--'}
              unit="m/s²"
              icon={<PulseIcon size={18} />}
              animateOnChange
            />
          </View>

          {/*
            La cadencia medida, a la vista: las duraciones son cantidad de
            mediciones por este intervalo, así que si se ve raro, este número
            explica por qué. Antes se daba por sentado en 0,32 s.
          */}
          {summary.totalReadings > 0 && (
            <Text className="text-secondary text-xs">
              {summary.totalReadings} mediciones, una cada{' '}
              {(cadence / 1000).toFixed(2).replace('.', ',')} s
            </Text>
          )}
          </View>

          <View className="bg-surface p-4 rounded-2xl shadow-sm gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-on-surface text-base font-bold">
                {isDay ? 'Por hora' : 'Por día'}
              </Text>
              {/* bucketsQuery's own loading state, not dataReady: that one
                  tracks episodes/readings, which load separately now and
                  would otherwise blank out an already-cached chart while
                  they finish. */}
              {bucketsQuery.isFetching && <ActivityIndicator color="#b61c25" size="small" />}
            </View>
            {/*
              El gráfico queda montado siempre, incluso mientras carga: se le
              pasan los buckets vacíos (bucketsQuery.data es undefined hasta
              que resuelve) y él dibuja su estado vacío. Reemplazarlo por un
              spinner lo desmontaba, y desmontar sus vistas SVG es lo que
              colgaba la app al cambiar de rango. Ver la nota en HistoryChart.
            */}
            <HistoryChart range={range} buckets={buckets} cadenceMs={cadence} />
          </View>

          {/*
            Por día de la semana / por hora: desgloses de categoría fija, no de
            eje temporal, así que solo aportan algo nuevo en semana/mes - en
            "Día" son el mismo dato que el gráfico de arriba (el rango es un
            único día), así que no se repiten.
          */}
          {!isDay && (
            <>
              <View className="bg-surface p-4 rounded-2xl shadow-sm gap-2">
                <Text className="text-on-surface text-base font-bold">Por día de la semana</Text>
                <BarMetricChart
                  labels={WEEKDAY_LABELS}
                  values={weekdayMinutes}
                  emptyLabel="Sin temblor en este período"
                />
              </View>

              <View className="bg-surface p-4 rounded-2xl shadow-sm gap-2">
                <Text className="text-on-surface text-base font-bold">Por hora</Text>
                <BarMetricChart
                  labels={HOUR_LABELS}
                  values={hourMinutes}
                  labelStep={3}
                  emptyLabel="Sin temblor en este período"
                />
              </View>
            </>
          )}

          <Pressable
            onPress={onExport}
            disabled={exporting || !hasData}
            className={`flex-row items-center justify-center gap-2 rounded-xl py-3.5 ${
              exporting || !hasData ? 'bg-surface-container-high' : 'bg-primary'
            }`}>
            {exporting ? (
              <ActivityIndicator color="#5b5f63" />
            ) : (
              <DocumentIcon size={18} color={hasData ? '#ffffff' : '#5b5f63'} />
            )}
            <Text
              className={`font-bold text-sm ${
                exporting || !hasData ? 'text-secondary' : 'text-on-primary'
              }`}>
              {exporting ? 'Generando PDF…' : 'Exportar reporte en PDF'}
            </Text>
          </Pressable>

          <View className="gap-2">
            <Text className="text-on-surface text-base font-bold">Filtrar por severidad</Text>
            <SeverityFilter value={severity} onChange={setSeverity} />
          </View>

          {!dataReady ? (
            <View className="bg-surface p-6 rounded-2xl items-center shadow-sm">
              <ActivityIndicator color="#b61c25" />
            </View>
          ) : (
            <>
              {/* En semana y mes, el resumen por día va ANTES de los episodios:
                  primero dónde pasó, después el detalle. */}
              {!isDay && (
                <View className="gap-3">
                  <Text className="text-on-surface text-lg font-bold">Resumen por día</Text>
                  <DayBreakdown
                    range={range}
                    buckets={buckets}
                    onSelectDay={onSelectDayFromBreakdown}
                    cadenceMs={cadence}
                  />
                </View>
              )}

              <View className="gap-3">
                <View className="flex-row items-center gap-2">
                  <Text className="text-on-surface text-lg font-bold">Episodios</Text>
                  <View className="px-2 py-0.5 rounded-full bg-surface-container-high">
                    <Text className="text-on-surface text-xs font-semibold">
                      {filteredEpisodes.length}
                    </Text>
                  </View>
                </View>

                {filteredEpisodes.length === 0 ? (
                  <View className="bg-surface p-6 rounded-2xl items-center shadow-sm">
                    <Text className="text-secondary text-sm text-center">
                      {severity === 0
                        ? 'Los episodios son rachas de temblor, así que no hay ninguno con severidad Leve.'
                        : `Sin episodios en ${isDay ? 'este día' : 'este período'}`}
                    </Text>
                  </View>
                ) : (
                  <>
                    {visibleEpisodes.map(episode => (
                      <EventCard key={episode.startedAt} episode={episode} showDate={!isDay} />
                    ))}

                    {filteredEpisodes.length > visibleEpisodes.length && (
                      <Pressable
                        onPress={() => setEpisodeLimit(limit => limit + EPISODES_PAGE)}
                        className="py-3 rounded-xl bg-surface items-center shadow-sm">
                        <Text className="text-primary text-sm font-bold">
                          Mostrar más episodios ({visibleEpisodes.length} de{' '}
                          {filteredEpisodes.length})
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            </>
          )}

        <View className="gap-1">
          <View className="flex-row items-end justify-between">
            <Text className="text-secondary text-xs uppercase tracking-wide font-semibold">
              Mediciones
            </Text>
            <Text className="text-secondary text-xs">
              {readings.length} de {readingTotal}
            </Text>
          </View>

          {readings.length === 0 ? (
            !dataReady ? null : (
              <Text className="text-secondary text-sm">
                {severity === null
                  ? 'Sin mediciones en este período.'
                  : `Sin mediciones ${SEVERITY_LABELS[severity]} en este período.`}
              </Text>
            )
          ) : (
            <View className="rounded-2xl overflow-hidden">
              {readings.map(reading => (
                <ReadingRowItem key={reading.id} reading={reading} />
              ))}
            </View>
          )}

          {hasMoreReadings && (
            <Pressable
              onPress={onShowMoreReadings}
              disabled={loadingMore}
              className="mt-3 py-3 rounded-xl bg-surface items-center shadow-sm">
              {loadingMore ? (
                <ActivityIndicator color="#b61c25" />
              ) : (
                <Text className="text-primary text-sm font-bold">
                  Mostrar {Math.min(READINGS_PAGE, readingTotal - readings.length)} mediciones más
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </ScrollView>
  );
});
