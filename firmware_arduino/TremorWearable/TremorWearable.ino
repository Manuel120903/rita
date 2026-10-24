// XIAO ESP32-C3 tremor wearable firmware — Arduino IDE version.
//
// Pipeline (see project README for the full architecture diagram):
//   1. Adquisicion: interrupcion de Timer0 a 100 Hz -> lectura burst I2C (MPU6050)
//   2. Acondicionamiento: Butterworth pasabanda 4to orden por eje (4-6 Hz) para
//      el canal de temblor, mas un pasabajos 2do orden (<=2 Hz) en paralelo
//      para el canal de movimiento grueso (movimiento voluntario)
//   3. Analisis: ventana de 256 muestras / 87.5% solape -> RMS triaxial de la
//      banda de temblor + una FFT por eje CRUDO (PSD_max en 4-6 Hz y pureza
//      espectral) + motionRms del canal de movimiento
//   4. Clasificacion: gate de movimiento (descarta movimiento voluntario y
//      artefactos de banda ancha) -> K-Means (k=3, centroides fijos) + FSM
//      anti-parpadeo -> severidad
//   5. Transmision: notificacion BLE GATT hacia la app React Native
//
// Cableado (fijo, ver README del proyecto):
//   XIAO 3V3 -> MPU6050 VCC   XIAO GND -> MPU6050 GND + AD0 (fija direccion 0x68)
//   XIAO D5  -> MPU6050 SCL   XIAO D4  -> MPU6050 SDA
//
// ==== Antes de compilar (Arduino IDE) ====
// Este sketch esta escrito para las versiones ACTUALES (2025) de todo:
//   - Boards Manager: "esp32 by Espressif Systems" 3.x (cualquier version reciente)
//   - Board: Tools > Board > esp32 > "XIAO_ESP32C3" (o "ESP32C3 Dev Module" si
//     la primera no aparece en tu instalacion)
//   - Library Manager: "arduinoFFT" (Enrique Condes) 2.x, y "NimBLE-Arduino"
//     (h2zero) 2.x -- las versiones que instala el Library Manager por defecto.

#include <Arduino.h>
#include "mpu6050.h"
#include "butterworth_filter.h"
#include "dsp_features.h"
#include "severity_classifier.h"
#include "ble_service.h"

// GPIO numbers, no las macros D4/D5: asi compila sin importar si elegiste la
// placa "XIAO_ESP32C3" o la generica "ESP32C3 Dev Module" en Tools > Board.
// En el XIAO ESP32-C3, la etiqueta serigrafiada D4 = GPIO6 y D5 = GPIO7.
static constexpr int PIN_SDA = 6; // D4
static constexpr int PIN_SCL = 7; // D5
static constexpr uint8_t DEVICE_ID = 0x01;
static constexpr uint32_t SAMPLE_PERIOD_US = 10000; // 10 ms -> 100 Hz

// ==== Ahorro de bateria ====
// Frecuencia del CPU: 80 MHz es el minimo con el que el radio BLE funciona y
// sobra para el pipeline (antes 160 MHz). Si el aviso de presupuesto de tiempo
// aparece en el Serial, subirlo a 160.
static constexpr uint32_t CPU_FREQ_MHZ = 80;

// Mensajes de diagnostico por Serial. En uso real nadie los lee y gastan
// energia; poner en 1 solo para depurar/probar.
#define ENABLE_SERIAL_LOG 0

#if ENABLE_SERIAL_LOG
#define LOG_PRINTLN(...) Serial.println(__VA_ARGS__)
#define LOG_PRINTF(...) Serial.printf(__VA_ARGS__)
#else
#define LOG_PRINTLN(...) ((void)0)
#define LOG_PRINTF(...) ((void)0)
#endif

static MPU6050 mpu;
static TremorBandpassFilter filterX, filterY, filterZ;
static GrossMotionFilter motionFilterX, motionFilterY, motionFilterZ;
static TremorFeatureExtractor extractor;
static SeverityClassifier classifier;
static TremorBleService ble;

static hw_timer_t *sampleTimer = nullptr;
static volatile bool sampleFlagISR = false;
// Tarea de loop(): la ISR la despierta con una notificacion, asi entre muestras
// la tarea queda bloqueada y el CPU entra en reposo (idle/WFI) en vez de girar
// en vacio comprobando el flag.
static TaskHandle_t loopTaskHandle = nullptr;

// Instrumentacion del presupuesto de tiempo. El analisis de una ventana corre
// dentro de loop(), entre dos muestras, y solo hay UN flag de pendiente: si ese
// analisis tarda mas que el periodo de muestreo (10 ms), el timer vuelve a
// disparar, encuentra el flag todavia en true y esa muestra se pierde sin aviso
// -- lo que rompe el supuesto de muestreo uniforme del que depende la FFT.
// Estos contadores existen para que eso sea visible en el Serial Monitor en vez
// de degradar las medidas en silencio. Las 3 FFT por ventana son el gasto
// grande, y solo se puede medir en el hardware real.
static volatile uint32_t droppedSamples = 0;
static uint32_t analysisMaxUs = 0;
static uint32_t analysisWindows = 0;
static bool budgetWarningShown = false;

void IRAM_ATTR onSampleTimer() {
  if (sampleFlagISR) {
    // loop() todavia no consumio la muestra anterior: se pierde esta.
    droppedSamples++;
  }
  sampleFlagISR = true;
  if (loopTaskHandle) {
    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(loopTaskHandle, &woken);
    if (woken) {
      portYIELD_FROM_ISR();
    }
  }
}

void setup() {
  setCpuFrequencyMhz(CPU_FREQ_MHZ);

#if ENABLE_SERIAL_LOG
  Serial.begin(115200);
  delay(200);
#endif

  if (!mpu.begin(PIN_SDA, PIN_SCL)) {
    LOG_PRINTLN("[MPU6050] No se pudo inicializar el sensor. Revisa el cableado I2C.");
  } else {
    LOG_PRINTLN("[MPU6050] Sensor inicializado (I2C 400 kHz, +-2g, solo acelerometro).");
  }

  ble.begin(DEVICE_ID);
  LOG_PRINTLN("[BLE] Anunciando servicio de monitoreo de temblores.");

  loopTaskHandle = xTaskGetCurrentTaskHandle();

  // API de timer del core esp32 3.x: timerBegin ahora recibe la frecuencia del
  // tick directamente (1 MHz -> cada tick = 1 us), y el periodo del alarm se
  // fija con timerAlarm (autoreload=true, reload_count=0 = repetir siempre).
  sampleTimer = timerBegin(1000000);
  timerAttachInterrupt(sampleTimer, &onSampleTimer);
  timerAlarm(sampleTimer, SAMPLE_PERIOD_US, true, 0);
}

void loop() {
  if (!sampleFlagISR) {
    // Dormir hasta que el timer avise (timeout de seguridad de 20 ms).
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(20));
    if (!sampleFlagISR) {
      return;
    }
  }
  sampleFlagISR = false;

  float ax, ay, az;
  if (!mpu.readAccelMps2(ax, ay, az)) {
    return;
  }

  TriaxialSample raw = {ax, ay, az};
  TriaxialSample tremor = {filterX.process(ax), filterY.process(ay), filterZ.process(az)};
  TriaxialSample motion = {motionFilterX.process(ax), motionFilterY.process(ay), motionFilterZ.process(az)};

  if (!extractor.push(raw, tremor, motion)) {
    return;
  }

  uint32_t analysisStartUs = micros();

  float rms, psdMax, motionRms, spectralPurity;
  extractor.computeFeatures(rms, psdMax, motionRms, spectralPurity);
  SeverityLevel severity = classifier.classify(rms, psdMax, motionRms, spectralPurity);

  uint32_t analysisUs = micros() - analysisStartUs;
  if (analysisUs > analysisMaxUs) {
    analysisMaxUs = analysisUs;
  }

  ble.notify(millis(), rms, psdMax, severity);

  // Esta linea se mantiene corta a proposito. A 115200 baudios cada caracter
  // cuesta ~87us, y Serial.printf bloquea cuando se llena el buffer de TX: una
  // linea de 200 caracteres son ~17ms, mas que el periodo de muestreo, o sea
  // que el log mismo haria perder muestras. Por eso el diagnostico de tiempos
  // va aparte y cada 10 ventanas (~3.2 s), no en cada una.
  LOG_PRINTF("RMS=%.4f  PSD_max=%.5f  motionRms=%.4f  purity=%.2f  severity=%d  connected=%d\n", rms, psdMax,
             motionRms, spectralPurity, severity, ble.isConnected());

  analysisWindows++;
  if (analysisWindows % 10 == 0) {
    LOG_PRINTF("[tiempos] analisis=%luus  max=%luus  presupuesto=%luus  perdidas=%lu\n",
                  (unsigned long)analysisUs, (unsigned long)analysisMaxUs, (unsigned long)SAMPLE_PERIOD_US,
                  (unsigned long)droppedSamples);
  }

  // El analisis debe caber en un periodo de muestreo, o se pierden muestras.
  // Se avisa una sola vez para no empeorar el problema llenando el Serial.
  if (analysisMaxUs > SAMPLE_PERIOD_US && !budgetWarningShown) {
    budgetWarningShown = true;
    LOG_PRINTF("[AVISO] El analisis tardo %luus, mas que el periodo de muestreo (%luus): se pierden "
                  "muestras y el muestreo deja de ser uniforme. Mover el analisis a una tarea aparte, o "
                  "abaratarlo (ventana mas corta / hop mas largo / menos ejes con FFT).\n",
                  (unsigned long)analysisMaxUs, (unsigned long)SAMPLE_PERIOD_US);
  }
}
