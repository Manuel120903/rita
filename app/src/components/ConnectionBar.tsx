import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import type { BleConnectionStatus } from '../ble/BleService';
import { BluetoothIcon } from './icons';

const LOGO = require('../assets/Imagen1.png');

interface ConnectionBarProps {
  status: BleConnectionStatus;
  errorMessage?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_LABEL: Record<BleConnectionStatus, string> = {
  disconnected: 'Desconectado',
  'requesting-permissions': 'Solicitando permisos…',
  scanning: 'Buscando pulsera…',
  connecting: 'Conectando…',
  connected: 'Conectado',
  error: 'Error de conexión',
};

const STATUS_DOT: Record<BleConnectionStatus, string> = {
  disconnected: 'bg-secondary',
  'requesting-permissions': 'bg-primary',
  scanning: 'bg-primary',
  connecting: 'bg-primary',
  connected: 'bg-tertiary',
  error: 'bg-severe',
};

const BUSY_STATES: BleConnectionStatus[] = ['requesting-permissions', 'scanning', 'connecting'];

export function ConnectionBar({ status, errorMessage, onConnect, onDisconnect }: ConnectionBarProps) {
  const isBusy = BUSY_STATES.includes(status);
  const isConnected = status === 'connected';

  return (
    <View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Image source={LOGO} style={{ width: 96, height: 40 }} resizeMode="contain" />
          <View>
            <Text className="text-secondary text-xs font-medium">Dispositivo Motus</Text>
            <View className="flex-row items-center gap-1.5 mt-1 bg-surface-container-high/60 px-2 py-0.5 rounded-full self-start">
              <View className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
              <Text className="text-tertiary text-xs font-semibold">{STATUS_LABEL[status]}</Text>
              {isBusy && <ActivityIndicator size="small" color="#006867" />}
            </View>
          </View>
        </View>

        <Pressable
          onPress={isConnected ? onDisconnect : onConnect}
          disabled={isBusy}
          className={`w-11 h-11 rounded-xl items-center justify-center ${isConnected ? 'bg-primary-container' : 'bg-surface-container'} ${isBusy ? 'opacity-50' : ''}`}
        >
          <BluetoothIcon size={20} color={isConnected ? '#930014' : '#006867'} />
        </Pressable>
      </View>

      {status === 'error' && errorMessage ? (
        <Text className="text-severe text-xs mt-2">{errorMessage}</Text>
      ) : null}
    </View>
  );
}
