#pragma once
#include <stdint.h>

// GATT contract shared with the React Native app
// (app/src/ble/constants.ts + app/src/ble/payload.ts).
// Changing anything here MUST be mirrored there or the app will fail to
// find the device or will misparse the notification payload.

#define TREMOR_SERVICE_UUID "12345678-1234-5678-1234-56789abc0001"
#define TREMOR_CHARACTERISTIC_UUID "12345678-1234-5678-1234-56789abc0002"

// The app scans for this prefix as a human-friendly fallback; the actual
// filtering is done by TREMOR_SERVICE_UUID.
#define BLE_DEVICE_NAME_PREFIX "TremorBand"

enum SeverityLevel : uint8_t {
  SEVERITY_MILD = 0,
  SEVERITY_MODERATE = 1,
  SEVERITY_SEVERE = 2,
};

// Little-endian, packed, 14 bytes total — must match app/src/ble/payload.ts.
#pragma pack(push, 1)
struct TremorPacket {
  uint32_t timestamp;   // millis() at the time the window was closed
  float rms;            // triaxial RMS of the filtered tremor band [m/s^2]
  float psd_max;        // peak spectral density within 4-6 Hz [ (m/s^2)^2/Hz ]
  uint8_t severity;      // SeverityLevel
  uint8_t device_id;     // static identifier for this wearable
};
#pragma pack(pop)

static_assert(sizeof(TremorPacket) == 14, "TremorPacket must stay 14 bytes to match the app parser");
