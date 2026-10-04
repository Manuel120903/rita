#pragma once
#include "ble_protocol.h"

// Thin wrapper around NimBLE-Arduino: advertises the tremor GATT service and
// exposes a single call to push a notification with the latest reading.
class TremorBleService {
public:
  void begin(uint8_t deviceId);
  void notify(uint32_t timestampMs, float rms, float psdMax, SeverityLevel severity);
  bool isConnected() const;

private:
  uint8_t _deviceId = 0;
};
