#include "ble_service.h"
#include <NimBLEDevice.h>

namespace {
NimBLEServer *g_server = nullptr;
NimBLECharacteristic *g_characteristic = nullptr;
volatile bool g_connected = false;

// NimBLE-Arduino 2.x added a NimBLEConnInfo parameter to these callbacks
// (and a disconnect reason code) compared to the older 1.x signatures.
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &connInfo) override {
    g_connected = true;
    // Only one client (the paired phone) is expected; keep advertising off
    // while connected and resume on disconnect.
    NimBLEDevice::stopAdvertising();
  }

  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &connInfo, int reason) override {
    g_connected = false;
    NimBLEDevice::startAdvertising();
  }
};
} // namespace

void TremorBleService::begin(uint8_t deviceId) {
  _deviceId = deviceId;

  char deviceName[32];
  snprintf(deviceName, sizeof(deviceName), "%s-%02X", BLE_DEVICE_NAME_PREFIX, deviceId);
  NimBLEDevice::init(deviceName);

  g_server = NimBLEDevice::createServer();
  g_server->setCallbacks(new ServerCallbacks());

  NimBLEService *service = g_server->createService(TREMOR_SERVICE_UUID);
  g_characteristic = service->createCharacteristic(
      TREMOR_CHARACTERISTIC_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(TREMOR_SERVICE_UUID);
  advertising->start();
}

bool TremorBleService::isConnected() const { return g_connected; }

void TremorBleService::notify(uint32_t timestampMs, float rms, float psdMax, SeverityLevel severity) {
  if (!g_characteristic || !g_connected) {
    return;
  }

  TremorPacket packet;
  packet.timestamp = timestampMs;
  packet.rms = rms;
  packet.psd_max = psdMax;
  packet.severity = (uint8_t)severity;
  packet.device_id = _deviceId;

  g_characteristic->setValue((uint8_t *)&packet, sizeof(packet));
  g_characteristic->notify();
}
