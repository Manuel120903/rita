import React from 'react';
import { Text, View } from 'react-native';
import { SEVERITY_LABELS, type SeverityLevel } from '../ble/constants';
import { formatDuration, type TremorEpisode } from '../lib/periods';
import { WarningIcon } from './icons';

const BADGE_STYLE: Record<SeverityLevel, { bg: string; text: string }> = {
  0: { bg: 'bg-tertiary-container', text: 'text-tertiary' },
  1: { bg: 'bg-primary-container', text: 'text-primary' },
  2: { bg: 'bg-primary', text: 'text-on-primary' },
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface EventCardProps {
  episode: TremorEpisode;
  /** Shows the date as well, for ranges that span more than one day. */
  showDate?: boolean;
}

export function EventCard({ episode, showDate = false }: EventCardProps) {
  const badge = BADGE_STYLE[episode.maxSeverity];
  const start = new Date(episode.startedAt);
  const dateLabel = showDate
    ? `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')} · `
    : '';

  // An episode that drifted between Moderado and Severo is one episode, but the
  // mix is worth showing.
  const levels = Array.from(new Set(episode.periods.map(p => p.severity))).sort();
  const mixLabel = levels.length > 1 ? levels.map(l => SEVERITY_LABELS[l]).join(' / ') : null;

  return (
    <View className="bg-surface p-4 rounded-2xl shadow-sm flex-row items-start gap-2.5">
      <View className="w-9 h-9 rounded-xl bg-primary-container items-center justify-center">
        <WarningIcon size={18} color="#b61c25" />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-on-surface text-base font-bold">
            {dateLabel}
            {formatTime(episode.startedAt)} — {formatTime(episode.endedAt)}
          </Text>
          <View className={`px-2 py-0.5 rounded-full ${badge.bg}`}>
            <Text className={`text-xs font-bold ${badge.text}`}>
              {SEVERITY_LABELS[episode.maxSeverity]}
            </Text>
          </View>
        </View>

        <Text className="text-secondary text-xs mt-0.5">
          Duración: {formatDuration(episode.durationMs)} · {episode.sampleCount} mediciones
          {mixLabel ? ` · pasó por ${mixLabel}` : ''}
        </Text>
      </View>
    </View>
  );
}
