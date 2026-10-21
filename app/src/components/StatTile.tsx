import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ReactNode;
  accent?: string;
  /** Pone `unit` en su propia línea debajo de `value` en vez de al lado. */
  stackedUnit?: boolean;
  /**
   * Brief scale "bump" whenever `value` changes. Opt-in, not the default:
   * on HomeScreen the live tiles update about three times a second while
   * connected, where a bump on every tick would be noise, not a signal.
   * HistoryScreen's tiles change only when the selected range/filter does,
   * where drawing the eye to "this number just updated" is the point.
   */
  animateOnChange?: boolean;
}

export function StatTile({
  label,
  value,
  unit,
  icon,
  accent = 'text-tertiary',
  stackedUnit = false,
  animateOnChange = false,
}: StatTileProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const previousValue = useRef(value);

  useEffect(() => {
    if (!animateOnChange || previousValue.current === value) {
      previousValue.current = value;
      return;
    }
    previousValue.current = value;
    // Overshoot past 1 and spring back, rather than a plain fade: a size bump
    // reads as "this number changed" at a glance, which is the point - a
    // fade would have been just as easy to miss as the old static swap.
    scale.setValue(1);
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.14,
        speed: 50,
        bounciness: 6,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 14,
        bounciness: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [value, animateOnChange, scale]);

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
          <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
            <Text className="text-on-surface text-3xl font-bold">{value}</Text>
          </Animated.View>
          {unit ? <Text className={`text-sm ${accent} mt-0.5`}>{unit}</Text> : null}
        </View>
      ) : (
        <View className="flex-row items-baseline gap-1.5 mt-2">
          <Animated.View style={{ transform: [{ scale }] }}>
            <Text className="text-on-surface text-3xl font-bold">{value}</Text>
          </Animated.View>
          {unit ? <Text className={`text-sm ${accent}`}>{unit}</Text> : null}
        </View>
      )}
    </View>
  );
}
