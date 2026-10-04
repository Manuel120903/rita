#pragma once
#include <stdint.h>

// Minimal direct-register MPU6050 accelerometer driver.
// Deliberately avoids a third-party MPU6050 library: the project spec calls
// for a specific burst read of registers 0x3B-0x40 (accelerometer only, no
// gyro/temp) over I2C Fast Mode (400 kHz), which is simple enough to own
// directly and keeps the dependency surface small.

class MPU6050 {
public:
  // sda/scl: XIAO ESP32-C3 pins D4/D5. addr: 0x68 (AD0 tied to GND).
  bool begin(int sdaPin, int sclPin, uint8_t addr = 0x68);

  // Burst-reads ACCEL_XOUT_H..ACCEL_ZOUT_L (0x3B-0x40, 6 bytes) in one
  // transaction and converts to m/s^2 using the +-2g sensitivity
  // (16384 LSB/g, per the hardware spec).
  bool readAccelMps2(float &ax, float &ay, float &az);

private:
  uint8_t _addr = 0x68;
  static constexpr float LSB_PER_G = 16384.0f;
  static constexpr float G_TO_MPS2 = 9.80665f;

  bool writeRegister(uint8_t reg, uint8_t value);
};
