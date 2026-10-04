import { toByteArray } from 'base64-js';
import type { TremorReading } from '../types/tremor';
import type { SeverityLevel } from './constants';

/**
 * Binary layout written by the ESP32 (little-endian, packed struct — see
 * firmware_arduino/TremorWearable/ble_protocol.h `TremorPacket`):
 *
 *   offset  size  field
 *   0       4     timestamp   uint32  (millis() on the device)
 *   4       4     rms         float32
 *   8       4     psd_max     float32
 *   12      1     severity    uint8   (0 = Leve, 1 = Moderado, 2 = Severo)
 *   13      1     device_id   uint8
 *
 * Total: 14 bytes.
 */
export const TREMOR_PACKET_SIZE = 14;

export function parseTremorPacket(base64Value: string): TremorReading | null {
  const bytes = toByteArray(base64Value);
  if (bytes.byteLength < TREMOR_PACKET_SIZE) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    deviceTimestampMs: view.getUint32(0, true),
    receivedAt: Date.now(),
    rms: view.getFloat32(4, true),
    psdMax: view.getFloat32(8, true),
    severity: view.getUint8(12) as SeverityLevel,
    deviceId: view.getUint8(13),
  };
}
