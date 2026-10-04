import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConnectionBar } from '../components/ConnectionBar';
import { StatTile } from '../components/StatTile';
import { TremorChart } from '../components/TremorChart';
import { PulseIcon, WatchIcon } from '../components/icons';
import { SEVERITY_LABELS } from '../ble/constants';
import type { useTremorMonitor } from '../hooks/useTremorMonitor';

interface HomeScreenProps {
  /** Owned by App, so the BLE subscription survives switching tabs. */
  monitor: ReturnType<typeof useTremorMonitor>;
}

/**
 * Live monitor. The period filters, aggregates and charts moved to the history
 * screen, which is also what removed this screen's performance problem: it used
 * to re-query and re-group the whole selected range on every incoming reading
 * (about three times a second), which does not scale past a few hours of data.
 * Nothing here touches the database on the read path.
 */
export function HomeScreen({ monitor }: HomeScreenProps) {
  const { status, errorMessage, latest, readingsHistory, connect, disconnect } = monitor;

  const isConnected = status === 'connected';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4 gap-5">
      <ConnectionBar
        status={status}
        errorMessage={errorMessage}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      {/* Dos filas de dos, no un flex-wrap: ver la nota en StatTile. */}
      <View className="gap-3">
      <View className="flex-row gap-3">
        <StatTile
          label="RMS actual"
          value={latest ? latest.rms.toFixed(2) : '--'}
          unit="m/s²"
          icon={<PulseIcon size={18} />}
        />
        <StatTile
          label="PSD máx."
          value={latest ? latest.psdMax.toFixed(3) : '--'}
          unit="(m/s²)²/Hz"
          icon={<PulseIcon size={18} />}
        />
      </View>
      <View className="flex-row gap-3">
        <StatTile
          label="Severidad"
          value={latest ? SEVERITY_LABELS[latest.severity] : '--'}
          unit={latest ? 'última lectura' : 'sin datos'}
          accent={latest && latest.severity > 0 ? 'text-primary' : 'text-tertiary'}
          icon={<PulseIcon size={18} />}
          stackedUnit
        />
        <StatTile
          label="Sensor muñeca"
          value={isConnected ? 'Activo' : 'Inactivo'}
          unit={isConnected ? 'En vivo' : 'Sin señal'}
          accent={isConnected ? 'text-tertiary' : 'text-secondary'}
          icon={<WatchIcon size={18} color={isConnected ? '#006867' : '#5b5f63'} />}
        />
      </View>
      </View>

      <View className="bg-surface p-5 rounded-2xl shadow-sm gap-4">
        <View>
          <Text className="text-on-surface text-lg font-bold">Cronología reciente</Text>
          <Text className="text-secondary text-sm">RMS triaxial de las últimas mediciones</Text>
        </View>
        <TremorChart points={readingsHistory} />
      </View>

      <Text className="text-secondary text-xs text-center">
        El resumen por día, semana y mes, junto con las gráficas y la exportación en PDF, está en la
        pestaña Historial.
      </Text>
    </ScrollView>
  );
}
