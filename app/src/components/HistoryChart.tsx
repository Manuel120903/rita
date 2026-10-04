import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { SEVERITY_COLORS } from '../ble/constants';
import type { SeverityBucket } from '../db/database';
import { NOMINAL_CADENCE_MS, formatDuration } from '../lib/periods';
import { bucketLabel, bucketPlan, type DateRange } from '../lib/ranges';

const HEIGHT = 220;

interface HistoryChartProps {
  range: DateRange;
  buckets: SeverityBucket[];
  /** Measured ms per reading, which is what turns counts into time. */
  cadenceMs?: number;
}

/**
 * Time per severity across the selected range, as one continuous line per
 * level sharing an x axis, instead of bars.
 *
 * Buckets are hourly for a single day and daily for a week or month; empty
 * buckets are already filled in by the query, so the series is dense.
 */
/**
 * NOTE: the <Svg> element here is never conditionally removed.
 *
 * The empty state keeps the Svg mounted and drops only its children.
 * Tearing down a react-native-svg view is what this screen has to avoid: the
 * freeze on changing the range was traced to the commit that unmounted this
 * chart — the tap arrived, the render completed, and then no effect ran and
 * the heartbeat stopped, with no data involved. It never happened on first
 * load, where there was no chart to tear down yet.
 */
export function HistoryChart({
  range,
  buckets,
  cadenceMs = NOMINAL_CADENCE_MS,
}: HistoryChartProps) {
  const plan = useMemo(() => bucketPlan(range), [range]);

  // Height reference for the lines: the tallest single severity count in any
  // bucket, so all three levels share one scale.
  const maxCount = useMemo(
    () => buckets.reduce((max, b) => Math.max(max, b.counts[0], b.counts[1], b.counts[2]), 0),
    [buckets],
  );

  // Width is in viewBox units; the SVG scales to the container.
  const slot = 100 / Math.max(1, buckets.length);

  const levelPaths = useMemo(() => {
    if (maxCount <= 0) {
      return ['', '', ''];
    }
    return ([0, 1, 2] as const).map(level => {
      const points = buckets.map((bucket, index) => {
        const x = slot * index + slot / 2;
        const y = HEIGHT - (bucket.counts[level] / maxCount) * (HEIGHT - 4) - 2;
        return { x, y };
      });
      if (points.length === 0) {
        return '';
      }
      return points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ');
    });
  }, [buckets, maxCount, slot]);

  const labelStep = useMemo(() => {
    if (buckets.length <= 12) {
      return 1;
    }
    return plan.hourly ? 3 : buckets.length > 20 ? 3 : 2;
  }, [buckets.length, plan.hourly]);

  const empty = maxCount === 0;

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-secondary text-xs">
          {empty ? 'Sin mediciones en este período' : `Tiempo por ${plan.hourly ? 'hora' : 'día'}`}
        </Text>
        {!empty && (
          <Text className="text-secondary text-xs">máx {formatDuration(maxCount * cadenceMs)}</Text>
        )}
      </View>

      <Svg width="100%" height={HEIGHT} viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none">
        {/* Guías horizontales al 25/50/75% */}
        {[0.25, 0.5, 0.75].map(fraction => (
          <Line
            key={fraction}
            x1={0}
            y1={HEIGHT * (1 - fraction)}
            x2={100}
            y2={HEIGHT * (1 - fraction)}
            stroke="#e6eff8"
            strokeWidth={0.5}
          />
        ))}

        {empty
          ? null
          : ([0, 1, 2] as const).map(level =>
              levelPaths[level] === '' ? null : (
                <Path
                  key={level}
                  d={levelPaths[level]}
                  stroke={SEVERITY_COLORS[level]}
                  strokeWidth={1.4}
                  fill="none"
                />
              ),
            )}

        <Line x1={0} y1={HEIGHT} x2={100} y2={HEIGHT} stroke="#c7ced6" strokeWidth={0.6} />
      </Svg>

      <View className="flex-row">
        {buckets.map((_, index) => (
          <View key={index} className="flex-1 items-center">
            {index % labelStep === 0 ? (
              <Text className="text-secondary text-[9px]">{bucketLabel(range, index)}</Text>
            ) : null}
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-3 mt-1">
        {(['Leve', 'Moderado', 'Severo'] as const).map((label, level) => (
          <View key={label} className="flex-row items-center gap-1.5">
            <View
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: SEVERITY_COLORS[level as 0 | 1 | 2] }}
            />
            <Text className="text-secondary text-xs">{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
