import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  MONTH_NAMES,
  WEEKDAY_INITIALS,
  addDays,
  addMonths,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../lib/ranges';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface CalendarProps {
  /** Day currently selected. */
  value: Date;
  /** Month being displayed (any day inside it). */
  visibleMonth: Date;
  onChangeMonth: (month: Date) => void;
  onSelectDay: (day: Date) => void;
  /** Local-midnight timestamps of days that hold readings. */
  daysWithData: number[];
}

/**
 * Month grid, written here rather than pulling in a calendar library: the app
 * already hand-rolls its navigation and icons, the grid is a fixed 6x7, and this
 * way there is no extra native dependency to rebuild for.
 */
export function Calendar({
  value,
  visibleMonth,
  onChangeMonth,
  onSelectDay,
  daysWithData,
}: CalendarProps) {
  const dataSet = useMemo(() => new Set(daysWithData), [daysWithData]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const monthStart = useMemo(() => startOfMonth(visibleMonth), [visibleMonth]);

  // Always 6 rows so the grid does not jump in height between months.
  const days = useMemo(() => {
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthStart]);

  const canGoForward = monthStart.getTime() < startOfMonth(today).getTime();

  return (
    <View className="bg-surface rounded-2xl p-4 shadow-sm gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => onChangeMonth(addMonths(monthStart, -1))}
          hitSlop={8}
          className="w-9 h-9 rounded-xl bg-surface-container items-center justify-center">
          <ChevronLeftIcon size={18} color="#5b5f63" />
        </Pressable>

        <Text className="text-on-surface font-bold text-base capitalize">
          {MONTH_NAMES[monthStart.getMonth()]} {monthStart.getFullYear()}
        </Text>

        <Pressable
          onPress={() => canGoForward && onChangeMonth(addMonths(monthStart, 1))}
          hitSlop={8}
          disabled={!canGoForward}
          className={`w-9 h-9 rounded-xl items-center justify-center ${
            canGoForward ? 'bg-surface-container' : 'bg-surface-container-low'
          }`}>
          <ChevronRightIcon size={18} color={canGoForward ? '#5b5f63' : '#c7ced6'} />
        </Pressable>
      </View>

      <View className="flex-row">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <View key={`${initial}-${index}`} className="flex-1 items-center">
            <Text className="text-secondary text-xs font-semibold">{initial}</Text>
          </View>
        ))}
      </View>

      <View className="gap-1">
        {[0, 1, 2, 3, 4, 5].map(row => (
          <View key={row} className="flex-row">
            {days.slice(row * 7, row * 7 + 7).map(day => {
              const inMonth = day.getMonth() === monthStart.getMonth();
              const selected = isSameDay(day, value);
              const isToday = isSameDay(day, today);
              const hasData = dataSet.has(day.getTime());
              const isFuture = day.getTime() > today.getTime();

              return (
                <Pressable
                  key={day.getTime()}
                  onPress={() => !isFuture && onSelectDay(day)}
                  disabled={isFuture}
                  className="flex-1 items-center py-1">
                  <View
                    className={`w-9 h-9 rounded-full items-center justify-center ${
                      selected ? 'bg-primary' : isToday ? 'bg-primary-container' : ''
                    }`}>
                    <Text
                      className={`text-sm ${
                        selected
                          ? 'text-on-primary font-bold'
                          : isFuture || !inMonth
                          ? 'text-secondary opacity-40'
                          : 'text-on-surface'
                      }`}>
                      {day.getDate()}
                    </Text>
                  </View>
                  <View
                    className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                      hasData && !selected ? 'bg-tertiary' : ''
                    }`}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-1.5">
        <View className="w-1.5 h-1.5 rounded-full bg-tertiary" />
        <Text className="text-secondary text-xs">Días con mediciones</Text>
      </View>
    </View>
  );
}
