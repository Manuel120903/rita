/**
 * Tremor Monitor — bare React Native app for the Parkinson wearable project.
 * BLE (react-native-ble-plx) <-> ESP32-C3 firmware, local persistence via SQLite.
 *
 * @format
 */

import React, { useState } from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { useTremorMonitor } from './src/hooks/useTremorMonitor';
import { queryClient } from './src/lib/queryClient';

type Tab = 'home' | 'history';

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center py-3">
      <Text className={active ? 'text-primary font-bold' : 'text-secondary font-medium'}>{label}</Text>
      <View className={`h-1 w-8 mt-1.5 rounded-full ${active ? 'bg-primary' : 'bg-transparent'}`} />
    </Pressable>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>('home');

  // The BLE subscription lives here, not inside HomeScreen: switching tabs
  // unmounts the inactive screen, and while the monitor was mounted there,
  // standing on the Historial tab silently stopped persisting readings.
  const monitor = useTremorMonitor();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView className="flex-1 bg-background" edges={['top', 'left', 'right', 'bottom']}>
          <View className="flex-1">
            {tab === 'home' ? <HomeScreen monitor={monitor} /> : <HistoryScreen />}
          </View>

          <View className="flex-row bg-surface shadow-sm">
            <TabButton label="Monitor" active={tab === 'home'} onPress={() => setTab('home')} />
            <TabButton label="Historial" active={tab === 'history'} onPress={() => setTab('history')} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export default App;
