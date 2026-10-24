#include "mpu6050.h"
#include <Wire.h>

namespace {
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_PWR_MGMT_2 = 0x6C;
constexpr uint8_t PWR1_TEMP_DIS = 0x08;    // PWR_MGMT_1 bit 3: apaga el termometro (reloj interno 8 MHz)
constexpr uint8_t PWR2_STBY_GYRO = 0x07;   // PWR_MGMT_2 bits [2:0]: giroscopio X/Y/Z en standby
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B; // burst read starts here, 6 bytes -> 0x40
constexpr uint8_t ACCEL_FS_2G = 0x00;      // ACCEL_CONFIG bits [4:3] = 00 -> +-2g
}

bool MPU6050::begin(int sdaPin, int sclPin, uint8_t addr) {
  _addr = addr;

  Wire.begin(sdaPin, sclPin);
  Wire.setClock(400000); // Fast Mode, per hardware spec

  // Wake up the sensor: PWR_MGMT_1 defaults to sleep mode enabled at power-on.
  // Ahorro de bateria: se despierta con el termometro apagado y reloj interno
  // (el PLL del giroscopio no sirve si el giroscopio esta apagado).
  if (!writeRegister(REG_PWR_MGMT_1, PWR1_TEMP_DIS)) {
    return false;
  }
  delay(10);

  // Solo se usa el acelerometro: giroscopio en standby.
  if (!writeRegister(REG_PWR_MGMT_2, PWR2_STBY_GYRO)) {
    return false;
  }

  // Explicitly select +-2g full scale (16384 LSB/g).
  if (!writeRegister(REG_ACCEL_CONFIG, ACCEL_FS_2G)) {
    return false;
  }

  // Confirm the device is present by probing WHO_AM_I (0x75, expects 0x68).
  Wire.beginTransmission(_addr);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }
  Wire.requestFrom(_addr, (uint8_t)1);
  if (Wire.available() < 1) {
    return false;
  }
  uint8_t whoAmI = Wire.read();
  return whoAmI == 0x68;
}

bool MPU6050::writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(_addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool MPU6050::readAccelMps2(float &ax, float &ay, float &az) {
  Wire.beginTransmission(_addr);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  const uint8_t bytesToRead = 6; // 0x3B..0x40
  if (Wire.requestFrom(_addr, bytesToRead) != bytesToRead) {
    return false;
  }

  int16_t rawX = (Wire.read() << 8) | Wire.read();
  int16_t rawY = (Wire.read() << 8) | Wire.read();
  int16_t rawZ = (Wire.read() << 8) | Wire.read();

  ax = (rawX / LSB_PER_G) * G_TO_MPS2;
  ay = (rawY / LSB_PER_G) * G_TO_MPS2;
  az = (rawZ / LSB_PER_G) * G_TO_MPS2;
  return true;
}
