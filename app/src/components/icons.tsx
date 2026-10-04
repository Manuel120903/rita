import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

export function AnalyticsIcon({ size = 20, color = '#b61c25' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20V10M12 20V4M20 20v-6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function TimerIcon({ size = 20, color = '#006867' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={13} r={8} stroke={color} strokeWidth={2} />
      <Path d="M12 9v4l3 2M10 2h4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function PulseIcon({ size = 20, color = '#006867' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12h4l2 6 4-12 2 6h6"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WatchIcon({ size = 20, color = '#006867' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M9 3h6M9 21h6M12 9v3l2 1.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 20, color = '#006867' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path d="M8 12.5l2.5 2.5L16 9.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function WarningIcon({ size = 20, color = '#b61c25' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4l9 16H3L12 4z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Path d="M12 10v4M12 17h.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function BluetoothIcon({ size = 24, color = '#ffffff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 7l10 10-5 4V3l5 4L7 17"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 20, color = '#5b5f63' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 20, color = '#5b5f63' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CalendarIcon({ size = 20, color = '#5b5f63' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8h16M7 3v3M17 3v3M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function DocumentIcon({ size = 20, color = '#ffffff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7l-4-4z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M13 3v5h5M9 13h6M9 17h4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
