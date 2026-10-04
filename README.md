# Sistema Vestible de Detección de Temblor en Parkinson

Pulsera (XIAO ESP32-C3 + MPU6050) que detecta y clasifica la severidad del
temblor en reposo (Leve/Moderado/Severo) mediante Edge Computing, y una app
móvil en React Native (CLI puro, sin Expo Go) que se conecta por BLE, guarda
el historial en SQLite local y lo visualiza. No hay backend/API externo.

```
[MPU6050] --I2C 400kHz--> [XIAO ESP32-C3]
                                |
                    Butterworth 4to orden (4-6Hz)
                    + pasabajos 2do orden (<=2Hz, canal movimiento)
                    + FFT por eje (256 muestras, 87.5% solape)
                    + RMS/PSD + gate de movimiento
                    + K-Means (k=3) + FSM
                                |
                              BLE GATT (NimBLE)
                                |
                      [App React Native]
                    react-native-ble-plx
                                |
                    SQLite (@op-engineering/op-sqlite)
                                |
                  UI (NativeWind / Tailwind) — Monitor + Historial ON/OFF
```

## Estructura del repo

- `firmware_arduino/TremorWearable/` — firmware del wearable como **sketch de
  Arduino IDE** (todos los archivos en una sola carpeta, como exige el IDE).
- `app/` — app React Native (bare CLI, no Expo), con NativeWind para el UI.

## Firmware (`firmware_arduino/TremorWearable/`)

Este sketch está escrito para las versiones **actuales** (las que instalan
Boards/Library Manager por defecto hoy): core esp32 3.x, `arduinoFFT` 2.x y
`NimBLE-Arduino` 2.x.

1. **Soporte de placa ESP32**: File/Archivo → Preferences → agregar en
   "Additional Boards Manager URLs":
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   Luego Tools → Board → Boards Manager → buscar "esp32" (Espressif Systems)
   e instalar la versión más reciente (3.x).
2. **Placa**: Tools → Board → esp32 → `XIAO_ESP32C3` (en el buscador de placas
   del IDE 2.x podés escribir "XIAO" para filtrar).

   **¿No aparece `XIAO_ESP32C3`?** Usá **`ESP32C3 Dev Module`** (genérico,
   viene en cualquier versión del core) — el sketch no depende de la placa
   específica del XIAO: los pines SDA/SCL están puestos como números de GPIO
   (6 y 7), no como las macros `D4`/`D5`, así que compila igual. Con
   `ESP32C3 Dev Module` dejá el resto de las opciones de Tools en sus valores
   por defecto (Flash Size 4MB, Partition Scheme "Default").
3. **Librerías** (Tools → Manage Libraries), versión más reciente de cada una:
   - `arduinoFFT` (Enrique Condes) — 2.x
   - `NimBLE-Arduino` (h2zero) — 2.x
4. Abrí `firmware_arduino/TremorWearable/TremorWearable.ino` (el IDE carga
   automáticamente los demás `.h`/`.cpp` de la misma carpeta).
5. Conectá el XIAO por USB-C, elegí el puerto en Tools → Port (si no aparece,
   puede que falte el driver USB-serial del chip del XIAO — revisá la wiki de
   Seeed para tu revisión de placa).
6. Verify/Compile (✓) y luego Upload (→). Si falla la conexión al subir,
   mantené presionado el botón **BOOT** del XIAO mientras conectás el USB (o
   mientras hacés reset), soltalo, y reintentá el upload.
7. Tools → Serial Monitor a **115200 baud** para ver `RMS=... PSD_max=... severity=...`.

### Cableado y pipeline

Pines I2C (fijos, ver `TremorWearable.ino`): `D4`→SDA, `D5`→SCL, `3V3`→VCC,
`GND`→GND y AD0 (dirección `0x68`). En el XIAO ESP32-C3 la etiqueta `D4`
corresponde a GPIO6 y `D5` a GPIO7, que es cómo están escritos en el sketch.

El pipeline completo (timer de hardware a 100 Hz, filtro Butterworth,
FFT/RMS/PSD, gate de movimiento, K-Means + FSM, notificación BLE) está
implementado en:

- `mpu6050.*` — driver I2C directo (sin librería de terceros).
- `butterworth_filter.h` — cascada de 2 biquads (4to orden, 4-6 Hz @ 100 Hz),
  coeficientes verificados numéricamente (-3 dB en 4 y 6 Hz, 0 dB en 5 Hz). Además
  el pasabajos de 2do orden (≤2 Hz) del canal de movimiento grueso.
- `dsp_features.*` — ventaneo de 256 muestras (2.56 s) con hop de 32 muestras
  (87.5% de solape, ~0.32 s entre actualizaciones). Qué señal alimenta cada
  feature, y por qué:
  - **RMS** ← ejes pasabanda 4-6 Hz (sin FFT, solo suma de cuadrados).
  - **PSD_max y pureza espectral** ← **una FFT por eje crudo** (`arduinoFFT`),
    sumando las tres PSD bin a bin. Crudo y no filtrado porque la pureza compara
    la banda de temblor contra el resto del espectro, y sobre una señal ya
    filtrada todo lo que está fuera de 4-6 Hz es la banda de rechazo del filtro,
    lo que volvía el cociente inservible (~3e5 para cualquier entrada).
    Tampoco reemplazar las tres FFT por una sola de la magnitud vectorial
    `sqrt(x²+y²+z²)`: eso rectifica lo que no esté alineado con la gravedad y
    manda un temblor de 5 Hz a 10 Hz, fuera de la banda que se mide.
  - **motionRms** ← ejes pasabajos ≤2 Hz, como `sqrt(varX+varY+varZ)` con la
    media de cada eje removida (no sobre la magnitud vectorial, que está
    dominada por la gravedad y casi no responde al movimiento perpendicular).

  La FFT corre en precisión simple a propósito: el ESP32-C3 no tiene FPU, así
  que `double` se emula en software y cuesta varias veces más por operación.
- `severity_classifier.*` — **gate de movimiento**, que descarta la ventana si el
  brazo está en movimiento voluntario (`motionRms > 1.0`) o si la energía en
  4-6 Hz no es un pico nítido sino ruido de banda ancha (pureza `< 3.0`); si
  pasa el gate, K-Means (k=3) a centroides fijos + debounce (FSM).
  Las dos features se **normalizan** por su escala característica antes de medir
  distancia: `rms` va en ~0.05-1.0 y `psd_max` en ~0.002-0.5, así que sin
  normalizar la feature de mayor rango numérico decide sola la etiqueta y la otra
  es decoración. Y el `psd_max` de cada centroide se deriva de su `rms` mediante
  `psd ≈ 0.69·rms²`, la relación medida en banco, en vez de elegirse por separado.
  **Los centroides y los dos umbrales del gate siguen siendo un placeholder**:
  deben recalibrarse con los registros de PhysioNet según el plan de validación
  del proyecto (sección 6 del documento base), y el gate además con grabaciones de
  actividad diaria normal.
  **Falso positivo conocido**: un impulso repetido dentro de la banda
  (golpecitos ~5 veces por segundo, cepillo eléctrico, vibración de un vehículo)
  pasa los dos gates y se reporta como Severo. Ver la nota en el header: el
  discriminador sería el contenido armónico, y no está implementado a propósito
  porque calibrarlo sin datos etiquetados arriesga suprimir temblor real.
- `ble_service.*` — servidor GATT (NimBLE-Arduino).
- `ble_protocol.h` — UUIDs y el layout binario del paquete BLE (**debe coincidir
  exactamente** con `app/src/ble/constants.ts` y `payload.ts`).

## App móvil (`app/`)

React Native CLI puro (RN 0.87, sin Expo Go), gestionado con **pnpm**.

```bash
cd app
pnpm install
pnpm android            # requiere emulador Android corriendo o dispositivo por USB
```

Stack:

- **BLE**: `react-native-ble-plx` (`src/ble/BleService.ts`) — pide permisos,
  escanea por el Service UUID de la pulsera, se conecta y se suscribe a las
  notificaciones GATT.
- **Persistencia**: `@op-engineering/op-sqlite` (`src/db/database.ts`) — tabla
  `readings`. El agrupamiento en periodos, los totales por severidad y los
  buckets de las gráficas se hacen **en SQL** (funciones de ventana), no en JS:
  a una lectura cada 0,32 s un día son ~270 000 filas, y traerlas todas para
  agruparlas en el teléfono no escala. SQLite devuelve una fila por corrida.
  (Se descartó `react-native-sqlite-storage`: está sin mantenimiento y su
  `build.gradle` llama a `jcenter()`, que Gradle moderno ya no soporta.)
- **Lógica de periodos**: `src/lib/periods.ts` — una corrida se corta por cambio
  de severidad **o por hueco temporal** (> 0,96 s), y la duración se cuenta como
  `mediciones × 0,32 s`. Un episodio son las corridas no-Leve adyacentes
  fusionadas, así que uno que pasa de Moderado a Severo y vuelve es **un**
  episodio, no tres.
- **Rangos**: `src/lib/ranges.ts` — día, semana (lunes a domingo) y mes de
  **calendario**, no ventanas móviles de 24 h / 7 / 30 días.
- **Reporte PDF**: `src/lib/pdf.ts` genera el PDF byte a byte en JS (texto en
  Helvetica estándar, barras, y el logo embebido como JPEG vía `/DCTDecode`), y
  `src/lib/report.ts` lo maqueta con paginación. Sin módulo nativo de PDF ni de
  filesystem: lo único nativo es `react-native-share`, que recibe el base64 y lo
  entrega al sistema (`src/lib/exportPdf.ts`).
  El logo va en `src/assets/logoBase64.ts`, **generado**: es `logo.jpeg`
  reconvertido a JPEG *baseline*, porque `/DCTDecode` no admite progresivo (el
  original lo es). Las instrucciones para regenerarlo están en ese archivo.
- **UI**: NativeWind (Tailwind para React Native) — `tailwind.config.js`,
  `global.css`, componentes en `src/components/` y pantallas en `src/screens/`.
- Dos pestañas (sin librería de navegación, switch de estado simple): **Monitor**
  (severidad en vivo + gráfico RMS) e **Historial** (filtro día/semana/mes,
  calendario para elegir el día, gráficas del período, episodios, lista
  cronológica y exportación a PDF).
  El hook de BLE vive en `App.tsx`, no en la pantalla Monitor: los tabs
  desmontan la pantalla inactiva, y con la suscripción dentro de Monitor se
  dejaban de guardar lecturas mientras se miraba el Historial.

### Permisos Android

`android/app/src/main/AndroidManifest.xml` ya incluye los permisos BLE
(`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` para Android 12+, y los legacy
`BLUETOOTH`/`ACCESS_FINE_LOCATION` para versiones anteriores). Se piden en
runtime desde `BleService.requestPermissions()`.

## Contrato BLE (debe mantenerse sincronizado)

| Campo | Tipo | Offset | Firmware | App |
|---|---|---|---|---|
| Service UUID | — | — | `ble_protocol.h` | `ble/constants.ts` |
| Characteristic UUID (NOTIFY) | — | — | `ble_protocol.h` | `ble/constants.ts` |
| `timestamp` | uint32 LE | 0 | `TremorPacket` | `payload.ts` |
| `rms` | float32 LE | 4 | `TremorPacket` | `payload.ts` |
| `psd_max` | float32 LE | 8 | `TremorPacket` | `payload.ts` |
| `severity` | uint8 | 12 | `TremorPacket` | `payload.ts` |
| `device_id` | uint8 | 13 | `TremorPacket` | `payload.ts` |

Paquete total: 14 bytes.

## Pendientes (siguientes pasos naturales)

- Recalibrar los centroides de K-Means con datos reales/PhysioNet.
- Recalibrar los dos umbrales del gate (`MOTION_GATE_RMS`,
  `SPECTRAL_PURITY_GATE`) con grabaciones de actividad diaria normal; los
  valores actuales salen de un banco sintético, no de datos reales. En ese mismo
  paso, ajustar un test de contenido armónico para el falso positivo de los
  impulsos rítmicos (ver `severity_classifier.h`).
- **Leer el `analisis=...us` y `perdidas=...` del Serial Monitor** en el XIAO. El
  firmware ya mide cuánto tarda el análisis de cada ventana y cuenta las muestras
  perdidas, y avisa si el análisis excede los 10 ms del periodo de muestreo. Si
  eso aparece, el análisis hay que sacarlo del `loop()` a una tarea aparte (o
  abaratarlo), porque con un solo flag de muestra pendiente las muestras se
  pierden en silencio y la FFT deja de ver un muestreo uniforme.
- Prueba de banco con actuador oscilante (3/5/8 Hz) para validar FFT y muestreo.
- Medición de consumo/paquetes perdidos con nRF Connect + multímetro.
