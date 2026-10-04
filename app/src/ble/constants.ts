/**
 * BLE GATT contract shared with the ESP32-C3 firmware
 * (firmware_arduino/TremorWearable/ble_protocol.h).
 * Any change here MUST be mirrored there or the payload parsing will break.
 */

export const TREMOR_SERVICE_UUID = '12345678-1234-5678-1234-56789abc0001';
export const TREMOR_CHARACTERISTIC_UUID = '12345678-1234-5678-1234-56789abc0002';

// Prefix used to find the wearable while scanning, in case the OS also
// returns unrelated nearby BLE devices that advertise the same service.
export const DEVICE_NAME_PREFIX = 'TremorBand';

export const SEVERITY_LABELS = ['Leve', 'Moderado', 'Severo'] as const;
export type SeverityLevel = 0 | 1 | 2;

export const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  0: '#22C55E', // mild
  1: '#F59E0B', // moderate
  2: '#EF4444', // severe
};
