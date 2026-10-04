import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State, type Subscription } from 'react-native-ble-plx';
import { TREMOR_CHARACTERISTIC_UUID, TREMOR_SERVICE_UUID } from './constants';
import { parseTremorPacket } from './payload';
import type { TremorReading } from '../types/tremor';

export type BleConnectionStatus =
  | 'disconnected'
  | 'requesting-permissions'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

type StatusListener = (status: BleConnectionStatus, message?: string) => void;
type ReadingListener = (reading: TremorReading) => void;

/**
 * Thin wrapper around react-native-ble-plx that knows exactly one thing:
 * how to find the tremor wearable, connect to it, and stream parsed readings.
 * Kept as a singleton so the connection survives screen/tab switches.
 */
class TremorBleService {
  private manager = new BleManager();
  private device: Device | null = null;
  private notifySubscription: Subscription | null = null;
  private statusListeners = new Set<StatusListener>();
  private readingListeners = new Set<ReadingListener>();
  private status: BleConnectionStatus = 'disconnected';

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onReading(listener: ReadingListener): () => void {
    this.readingListeners.add(listener);
    return () => this.readingListeners.delete(listener);
  }

  getStatus(): BleConnectionStatus {
    return this.status;
  }

  private setStatus(status: BleConnectionStatus, message?: string) {
    this.status = status;
    this.statusListeners.forEach(listener => listener(status, message));
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    this.setStatus('requesting-permissions');

    if (Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  private waitForPoweredOn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sub = this.manager.onStateChange(state => {
        if (state === State.PoweredOn) {
          sub.remove();
          resolve();
        } else if (state === State.Unsupported || state === State.Unauthorized) {
          sub.remove();
          reject(new Error(`Bluetooth no disponible: ${state}`));
        }
      }, true);
    });
  }

  /** Scans, connects to the first matching wearable, and starts streaming readings. */
  async connect(): Promise<void> {
    try {
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        this.setStatus('error', 'Permisos de Bluetooth/Ubicación denegados');
        return;
      }

      await this.waitForPoweredOn();

      this.setStatus('scanning');
      const device = await this.scanForDevice();
      if (!device) {
        this.setStatus('error', 'No se encontró la pulsera. Verifica que esté encendida.');
        return;
      }

      this.setStatus('connecting');
      const connected = await device.connect({ autoConnect: false, timeout: 10000 });
      await connected.discoverAllServicesAndCharacteristics();

      // Android negotiates a "balanced" (power-saving) connection interval by
      // default, which adds latency to every notification. Requesting HIGH
      // priority asks for the shortest interval the OS allows (~11-15ms) —
      // no-op on iOS, where the OS manages this on its own.
      if (Platform.OS === 'android') {
        await connected.requestConnectionPriority(1).catch(() => undefined);
      }

      this.device = connected;

      connected.onDisconnected(() => {
        this.notifySubscription?.remove();
        this.notifySubscription = null;
        this.device = null;
        this.setStatus('disconnected');
      });

      this.notifySubscription = connected.monitorCharacteristicForService(
        TREMOR_SERVICE_UUID,
        TREMOR_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            this.setStatus('error', error.message);
            return;
          }
          if (!characteristic?.value) {
            return;
          }
          const reading = parseTremorPacket(characteristic.value);
          if (reading) {
            this.readingListeners.forEach(listener => listener(reading));
          }
        },
      );

      this.setStatus('connected');
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err));
    }
  }

  private scanForDevice(): Promise<Device | null> {
    return new Promise(resolve => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.manager.stopDeviceScan();
          resolve(null);
        }
      }, 15000);

      this.manager.startDeviceScan([TREMOR_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
        if (error) {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
          return;
        }

        if (device) {
          clearTimeout(timeout);
          this.manager.stopDeviceScan();
          if (!resolved) {
            resolved = true;
            resolve(device);
          }
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    this.notifySubscription?.remove();
    this.notifySubscription = null;
    if (this.device) {
      await this.device.cancelConnection().catch(() => undefined);
      this.device = null;
    }
    this.setStatus('disconnected');
  }

  destroy(): void {
    this.manager.destroy();
  }
}

export const tremorBle = new TremorBleService();
