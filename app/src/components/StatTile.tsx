import React from 'react';
import { Text, View } from 'react-native';

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ReactNode;
  accent?: string;
  /** Pone `unit` en su propia línea debajo de `value` en vez de al lado. */
  stackedUnit?: boolean;
}

export function StatTile({
  label,
  value,
  unit,
  icon,
  accent = 'text-tertiary',
  stackedUnit = false,
}: StatTileProps) {
  return (
    /*
     * `flex-1` sin `min-w-[...]`, y el que la usa la pone en una fila de ancho
     * fijo en vez de en un contenedor con `flex-wrap`.
     *
     * La combinación anterior era `flex-1 min-w-[45%]` dentro de un
     * `flex-row flex-wrap`: crecimiento flexible, ancho mínimo porcentual y
     * wrap, los tres juntos. Eso obliga a Yoga a negociar el ancho de la línea
     * contra el mínimo de cada hijo, que es justo el tipo de cálculo que puede
     * no converger al re-medir. Dos columnas explícitas no negocian nada.
     */
    <View className="flex-1 bg-surface p-4 rounded-2xl shadow-sm justify-between min-h-[96px]">
      <View className="flex-row items-center justify-between">
        <Text className="text-secondary text-[11px] uppercase tracking-wide font-semibold">{label}</Text>
        {icon}
      </View>
      {stackedUnit ? (
        <View className="mt-2">
          <Text className="text-on-surface text-3xl font-bold">{value}</Text>
          {unit ? <Text className={`text-sm ${accent} mt-0.5`}>{unit}</Text> : null}
        </View>
      ) : (
        <View className="flex-row items-baseline gap-1.5 mt-2">
          <Text className="text-on-surface text-3xl font-bold">{value}</Text>
          {unit ? <Text className={`text-sm ${accent}`}>{unit}</Text> : null}
        </View>
      )}
    </View>
  );
}
