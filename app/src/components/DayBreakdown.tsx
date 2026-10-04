import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SEVERITY_COLORS } from '../ble/constants';
import type { SeverityBucket } from '../db/database';
import { NOMINAL_CADENCE_MS, formatDuration } from '../lib/periods';
import { MONTH_NAMES, addDays, type DateRange } from '../lib/ranges';

interface DayBreakdownProps {
  range: DateRange;
  /** Daily buckets, as returned for a week or month range. */
  buckets: SeverityBucket[];
  onSelectDay: (day: Date) => void;
  /** Measured ms per reading, which is what turns counts into time. */
  cadenceMs?: number;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * One row per day for the week and month views, built from the same daily
 * buckets the chart uses — so it costs no extra query and is capped at 31 rows.
 *
 * It replaces the episode list on those ranges deliberately. Listing every
 * episode of a month is both unreadable and the one piece of this screen whose
 * cost grows without a ceiling (it needs the per-reading window query). Here a
 * day is a row, and tapping it switches the filter to that day, where the real
 * episode list lives.
 */
export function DayBreakdown({
  range,
  buckets,
  onSelectDay,
  cadenceMs = NOMINAL_CADENCE_MS,
}: DayBreakdownProps) {
  const maxTremor = buckets.reduce(
    (max, b) => Math.max(max, (b.counts[1] + b.counts[2]) * cadenceMs),
    0,
  );

  const withData = buckets.filter(b => b.counts[0] + b.counts[1] + b.counts[2] > 0);

  if (withData.length === 0) {
    return (
      <View className="bg-surface p-6 rounded-2xl items-center shadow-sm">
        <Text className="text-secondary text-sm">Sin mediciones en este período</Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      {withData.map(bucket => {
        const day = addDays(new Date(range.fromMs), bucket.index);
        const tremorMs = (bucket.counts[1] + bucket.counts[2]) * cadenceMs;
        const totalMs = (bucket.counts[0] + bucket.counts[1] + bucket.counts[2]) * cadenceMs;
        const share = maxTremor > 0 ? tremorMs / maxTremor : 0;

        return (
          <Pressable
            key={bucket.index}
            onPress={() => onSelectDay(day)}
            className="bg-surface rounded-2xl p-3.5 shadow-sm gap-2">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-on-surface font-bold text-sm">
                  {day.getDate()} de {MONTH_NAMES[day.getMonth()]}
                </Text>
                <Text className="text-secondary text-xs capitalize">{WEEKDAYS[day.getDay()]}</Text>
              </View>
              <View className="items-end">
                <Text className="text-on-surface text-sm font-semibold">
                  {tremorMs > 0 ? formatDuration(tremorMs) : 'sin temblor'}
                </Text>
                <Text className="text-secondary text-xs">
                  {formatDuration(totalMs)} registrados
                </Text>
              </View>
            </View>

            {/*
              Proporción de cada severidad dentro del día.

              Anchos en porcentaje y no `flex: fracción`: las fracciones pueden
              quedar muy chicas (un día casi todo Leve da 0.0002) y un flexGrow
              así es un valor raro de pedirle a Yoga. Un porcentaje está bien
              definido para cualquier valor. Tampoco se usa overflow-hidden con
              borde redondeado, que en Android da problemas.
            */}
            <View className="flex-row h-2 rounded-sm bg-surface-container">
              {([0, 1, 2] as const).map(level => {
                const total = bucket.counts[0] + bucket.counts[1] + bucket.counts[2];
                const percent = total > 0 ? (bucket.counts[level] / total) * 100 : 0;
                if (percent <= 0) {
                  return null;
                }
                return (
                  <View
                    key={level}
                    style={{
                      width: `${percent}%`,
                      backgroundColor: SEVERITY_COLORS[level],
                    }}
                  />
                );
              })}
            </View>

            {share > 0 && (
              <Text className="text-secondary text-xs">
                Toca para ver los episodios de este día
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
