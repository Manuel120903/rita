import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SEVERITY_COLORS, SEVERITY_LABELS, type SeverityLevel } from '../ble/constants';

/** null means "all levels". */
export type SeverityFilterValue = SeverityLevel | null;

const OPTIONS: { value: SeverityFilterValue; label: string }[] = [
  { value: null, label: 'Todas' },
  { value: 0, label: SEVERITY_LABELS[0] },
  { value: 1, label: SEVERITY_LABELS[1] },
  { value: 2, label: SEVERITY_LABELS[2] },
];

interface SeverityFilterProps {
  value: SeverityFilterValue;
  onChange: (value: SeverityFilterValue) => void;
}

export function SeverityFilter({ value, onChange }: SeverityFilterProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {OPTIONS.map(option => {
        const active = option.value === value;
        const dotColor = option.value === null ? '#5b5f63' : SEVERITY_COLORS[option.value];
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            className={`flex-row items-center gap-1.5 px-3 py-2 rounded-full ${
              active ? 'bg-primary' : 'bg-surface'
            }`}>
            <View className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
            <Text
              className={`text-xs ${active ? 'text-on-primary font-bold' : 'text-secondary font-medium'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
