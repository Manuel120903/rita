import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { SEVERITY_COLORS, type SeverityLevel } from '../ble/constants';

interface ChartPoint {
  receivedAt: number;
  rms: number;
  severity: SeverityLevel;
}

interface TremorChartProps {
  points: ChartPoint[];
  height?: number;
  /** Sliding time window shown on screen, in ms. Defaults to 2 minutes. */
  windowMs?: number;
}

const WIDTH = 320;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Catmull-Rom -> cubic Bezier, so the line reads as a smooth trace instead of a jagged polyline. */
function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;

  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Ticks a few times a second so the time-based x-axis keeps sweeping even between BLE packets. */
function useLiveClock(active: boolean, intervalMs = 200) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
}

function usePulse() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return pulse;
}

export function TremorChart({ points, height = 120, windowMs = 120000 }: TremorChartProps) {
  const now = useLiveClock(points.length > 0);
  const pulse = usePulse();

  const { linePath, areaPath, lastPoint, hasData } = useMemo(() => {
    const windowStart = now - windowMs;
    const visible = points.filter(p => p.receivedAt >= windowStart);

    if (visible.length === 0) {
      return { linePath: '', areaPath: '', lastPoint: null as { x: number; y: number; color: string } | null, hasData: false };
    }

    const max = Math.max(...visible.map(p => p.rms), 0.0001);
    const min = Math.min(...visible.map(p => p.rms), 0);
    const range = max - min || 1;
    const padTop = 10;
    const usableHeight = height - padTop;

    const coords = visible.map(p => ({
      x: ((p.receivedAt - windowStart) / windowMs) * WIDTH,
      y: padTop + usableHeight - ((p.rms - min) / range) * usableHeight,
      color: SEVERITY_COLORS[p.severity],
    }));

    const line = smoothPath(coords);
    const area =
      coords.length > 1
        ? `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`
        : '';

    return { linePath: line, areaPath: area, lastPoint: coords[coords.length - 1], hasData: true };
  }, [points, now, windowMs, height]);

  if (!hasData) {
    return (
      <View className="w-full items-center justify-center" style={{ height }}>
        <Text className="text-secondary text-sm">Aún no hay lecturas para graficar</Text>
      </View>
    );
  }

  const pulseRadius = pulse.interpolate({ inputRange: [0, 1], outputRange: [5, 10] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View className="w-full">
      <Svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        <Defs>
          <LinearGradient id="tremorFill" x1="0" y1="0" x2="0" y2={height}>
            <Stop offset="0%" stopColor="#b61c25" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#b61c25" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Line x1={0} y1={height - 1} x2={WIDTH} y2={height - 1} stroke="#e0e9f2" strokeWidth={1} />
        {areaPath ? <Path d={areaPath} fill="url(#tremorFill)" /> : null}
        <Path d={linePath} fill="none" stroke="#b61c25" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {lastPoint && (
          <>
            <AnimatedCircle cx={lastPoint.x} cy={lastPoint.y} r={pulseRadius} fill={lastPoint.color} opacity={pulseOpacity} />
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={4.5} fill={lastPoint.color} />
          </>
        )}
      </Svg>
      <View className="flex-row justify-between pt-1.5">
        <Text className="text-secondary text-xs">hace {Math.round(windowMs / 60000)} min</Text>
        <Text className="text-tertiary text-xs font-semibold">Ahora</Text>
      </View>
    </View>
  );
}
