import React, { useMemo, useState } from 'react';
import { type LayoutChangeEvent, Text, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import type { SeverityBucket } from '../db/database';
import { NOMINAL_CADENCE_MS, formatDuration } from '../lib/periods';
import { bucketLabel, bucketPlan, type DateRange } from '../lib/ranges';

const HEIGHT = 180;

/** Brand red, same one the live chart's gradient fill uses (see TremorChart). */
const LINE_COLOR = '#b61c25';

interface HistoryChartProps {
  range: DateRange;
  buckets: SeverityBucket[];
  /** Measured ms per reading, which is what turns counts into time. */
  cadenceMs?: number;
}

/**
 * Minutes with tremor (Moderado + Severo) per bucket, as one smooth filled
 * curve - the same shape as a typical attendance/activity-over-time chart.
 *
 * This used to be three stacked severity series. That read fine as a static
 * report, but on screen - especially replaying a day of real demo data, which
 * is ~93% Leve - the single combined line this draws now uses the chart's
 * full vertical range on its own scale, instead of being one tiny, flattened
 * slice of a scale Leve dominates. The per-level breakdown is still one
 * stat tile up, and the full severity split stays in the PDF report.
 *
 * Buckets are hourly for a single day and daily for a week or month; empty
 * buckets are already filled in by the query, so the series is dense.
 */
export function HistoryChart({
  range,
  buckets,
  cadenceMs = NOMINAL_CADENCE_MS,
}: HistoryChartProps) {
  const plan = useMemo(() => bucketPlan(range), [range]);
  const [width, setWidth] = useState(0);

  const labelStep = useMemo(() => {
    if (buckets.length <= 8) {
      return 1;
    }
    return plan.hourly ? 3 : buckets.length > 20 ? 3 : 2;
  }, [buckets.length, plan.hourly]);

  // Minutes, not raw counts: a direct, already-familiar unit for this axis,
  // instead of a reading count nobody has an intuition for.
  const minutesPerBucket = useMemo(
    () => buckets.map(b => ((b.counts[1] + b.counts[2]) * cadenceMs) / 60000),
    [buckets, cadenceMs],
  );

  const maxMinutes = useMemo(() => Math.max(...minutesPerBucket, 0), [minutesPerBucket]);
  const empty = maxMinutes === 0;

  const lineData = useMemo(
    () =>
      minutesPerBucket.map((minutes, index) => ({
        value: minutes,
        label: index % labelStep === 0 ? bucketLabel(range, index) : '',
      })),
    [minutesPerBucket, range, labelStep],
  );

  // gifted-charts lays out in absolute points, not percentages, so the chart
  // only renders once the container has actually been measured.
  const slot = width / Math.max(1, buckets.length);
  const spacing = Math.max(4, slot);

  return (
    <View
      className="gap-1"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View className="flex-row items-center justify-between">
        <Text className="text-secondary text-xs">
          {empty ? 'Sin temblor en este período' : `Minutos con temblor por ${plan.hourly ? 'hora' : 'día'}`}
        </Text>
        {!empty && (
          <Text className="text-secondary text-xs">pico {formatDuration(maxMinutes * 60000)}</Text>
        )}
      </View>

      {width > 0 && (
        // No `key` here: HistoryScreen already remounts this whole screen's
        // content on range-kind change (see its own `key={kind}`), and within
        // one mount buckets legitimately cycle through EMPTY_BUCKETS (length 0)
        // while a load is in flight. Keying this on buckets.length would force
        // gifted-charts to unmount and remount its SVG tree on every load -
        // which is the exact pattern that used to hang this screen (see the
        // HistoryScreen comment on why the chart is never swapped for a
        // spinner).
        <LineChart
          data={lineData}
          width={width - 36}
          height={HEIGHT}
          spacing={spacing}
          initialSpacing={spacing / 2}
          endSpacing={spacing / 2}
          maxValue={maxMinutes > 0 ? maxMinutes * 1.15 : 1}
          noOfSections={4}
          roundToDigits={0}
          curved
          curvature={0.2}
          areaChart
          color={LINE_COLOR}
          startFillColor={LINE_COLOR}
          endFillColor={LINE_COLOR}
          startOpacity={0.35}
          endOpacity={0.02}
          thickness={2.5}
          hideDataPoints
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor="#c7ced6"
          rulesColor="#e6eff8"
          rulesType="solid"
          yAxisTextStyle={{ color: '#5b5f63', fontSize: 9 }}
          xAxisLabelTextStyle={{ color: '#5b5f63', fontSize: 9 }}
          disableScroll
        />
      )}
    </View>
  );
}
