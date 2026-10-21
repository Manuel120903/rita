import React, { useMemo, useState } from 'react';
import { type LayoutChangeEvent, Text, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

const HEIGHT = 160;

/** Brand red, same one the rest of the app's charts use. */
const BAR_COLOR = '#b61c25';

interface BarMetricChartProps {
  /** One label per bar, e.g. weekday initials or hour numbers. */
  labels: string[];
  /** One value per bar, same length as labels. */
  values: number[];
  /** Only every Nth label is drawn, so narrow charts (24 hours) don't overlap. */
  labelStep?: number;
  emptyLabel: string;
}

/**
 * Plain (non-stacked) bar chart for a single metric across a fixed set of
 * categories - weekday or hour of day - instead of a time axis. Used next to
 * HistoryChart, which is the time-axis view of the same underlying minutes.
 */
export function BarMetricChart({ labels, values, labelStep = 1, emptyLabel }: BarMetricChartProps) {
  const [width, setWidth] = useState(0);

  const maxValue = useMemo(() => Math.max(...values, 0), [values]);
  const empty = maxValue === 0;

  const barData = useMemo(
    () =>
      values.map((value, index) => ({
        value,
        label: index % labelStep === 0 ? labels[index] : '',
        frontColor: BAR_COLOR,
      })),
    [values, labels, labelStep],
  );

  const slot = width / Math.max(1, values.length);
  const barWidth = Math.max(2, Math.min(22, slot * 0.6));
  const spacing = Math.max(1, slot - barWidth);

  return (
    <View className="gap-1" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {empty && <Text className="text-secondary text-xs">{emptyLabel}</Text>}

      {width > 0 && (
        <BarChart
          data={barData}
          width={width - 36}
          height={HEIGHT}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={spacing / 2}
          endSpacing={spacing / 2}
          maxValue={maxValue > 0 ? maxValue * 1.15 : 1}
          noOfSections={4}
          roundToDigits={0}
          frontColor={BAR_COLOR}
          // Rounded caps instead of flat-topped bars, matching the reference
          // chart style - plain rectangles is what made this read as "boxy".
          barBorderTopLeftRadius={6}
          barBorderTopRightRadius={6}
          hideYAxisText={false}
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
