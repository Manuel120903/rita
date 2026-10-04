import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { RangeKind } from '../lib/ranges';

const OPTIONS: { key: RangeKind; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

interface PeriodSelectorProps {
  value: RangeKind;
  onChange: (kind: RangeKind) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <View className="flex-row bg-surface-container rounded-xl p-1">
      {OPTIONS.map(option => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            /*
             * Solo cambia el color de fondo entre activo e inactivo. Antes
             * alternaba `shadow-sm`, que en Android es `elevation`: agregar y
             * quitar propiedades de sombra en cada cambio de filtro altera la
             * forma del estilo, no solo un valor, y es trabajo nativo evitable
             * en el camino exacto donde la pantalla se colgaba.
             */
            className={`flex-1 py-2 rounded-lg items-center ${
              active ? 'bg-surface' : 'bg-surface-container'
            }`}>
            <Text
              className={`text-sm ${active ? 'text-on-surface font-bold' : 'text-secondary font-medium'}`}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
