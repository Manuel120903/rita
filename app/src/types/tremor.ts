import type { SeverityLevel } from '../ble/constants';

export interface TremorReading {
  deviceTimestampMs: number; // millis() on the ESP32 at the moment of capture
  receivedAt: number; // Date.now() on the phone when the notification arrived
  rms: number; // m/s^2, triaxial RMS of the filtered tremor band
  psdMax: number; // peak spectral density in the 4-6 Hz tremor band
  severity: SeverityLevel;
  deviceId: number;
}
