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
    // Ahorro de bateria: pedir un intervalo de conexion de 100-200 ms (unidades
    // de 1.25 ms), latencia 0, timeout 4 s (unidades de 10 ms). Se generan solo
    // ~3 paquetes/s, asi que caben todos sin perder datos.
    server->updateConnParams(connInfo.getConnHandle(), 80, 160, 0, 400);
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
  // Menor potencia de radio: el celular siempre esta cerca.
  NimBLEDevice::setPower(0); // dBm

  g_server = NimBLEDevice::createServer();
  g_server->setCallbacks(new ServerCallbacks());

  NimBLEService *service = g_server->createService(TREMOR_SERVICE_UUID);
  g_characteristic = service->createCharacteristic(
      TREMOR_CHARACTERISTIC_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(TREMOR_SERVICE_UUID);
  // Anunciar cada ~500 ms en vez del intervalo rapido por defecto
  // (unidades de 0.625 ms: 800 = 500 ms).
  advertising->setMinInterval(800);
  advertising->setMaxInterval(800);
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
