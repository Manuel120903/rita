# La pulsera mágica que ayuda a los doctores 🖐️⌚

## 1. ¿Qué construimos?

Construimos dos cosas que trabajan juntas, como un equipo:

1. **Una pulsera** (como un reloj inteligente) que se pone una persona con
   Parkinson en la muñeca.
2. **Una aplicación en el celular** que recibe lo que la pulsera mide y lo
   guarda en una libretita digital para que el doctor pueda revisarlo después.

> 🖼️ **Imagen 1 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Ilustración infantil, estilo cuento de
> dibujos animados, colores suaves y amigables: una persona adulta sonriendo
> usa una pulsera electrónica azul en la muñeca, y a su lado hay un celular
> mostrando una pantalla con una carita feliz y una gráfica sencilla. Fondo
> blanco simple, sin texto, estilo acuarela infantil."

## 2. ¿Por qué lo hicimos?

Algunas personas con la enfermedad de Parkinson tienen **temblores en las
manos** cuando están quietas (sin hacer nada), que los médicos llaman
"temblor en reposo". Para que el doctor sepa qué tan fuerte es el temblor,
antes alguien tenía que **anotarlo a mano** o recordarlo de memoria, y eso es
difícil y se le puede olvidar a cualquiera.

Entonces pensamos: *¿y si una pulsera lo mide sola, todo el día, y luego el
celular le hace un resumen al doctor?* Así el doctor ve datos reales, no solo
lo que la persona recuerda.

> 🖼️ **Imagen 2 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Ilustración infantil simple tipo cómic en
> dos viñetas, colores pastel: en la primera viñeta una persona intenta
> recordar y dibuja un signo de interrogación sobre su cabeza con una mano
> temblorosa dibujada como garabato; en la segunda viñeta la misma persona usa
> una pulsera azul y un doctor con bata blanca sonríe mirando una tablet con
> una gráfica clara. Sin texto, estilo acuarela para niños."

## 3. ¿Qué usamos para construirlo?

| Pieza | Para qué sirve | Como si fuera... |
|---|---|---|
| **XIAO ESP32-C3** | Una computadora chiquitita que va dentro de la pulsera | El cerebro de la pulsera |
| **MPU6050** | Un sensor que siente el movimiento, como el del celular que sabe si lo giras | Los "ojos" que sienten el temblor |
| **Bluetooth (BLE)** | Para mandar la información sin cables, como un walkie-talkie | La boca que le habla al celular |
| **React Native** | El programa con el que armamos la app del celular | Los ladrillos para construir la app |
| **SQLite** | Una libretita digital dentro del celular donde se guardan todas las medidas | El cuaderno donde se anota todo |

> 🖼️ **Imagen 3 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Ilustración infantil tipo diagrama
> amigable, colores vivos pero suaves: a la izquierda un chip pequeño
> etiquetado como 'cerebro' con una carita feliz dibujada, conectado por una
> línea punteada a un ícono de Bluetooth azul, que a su vez conecta con un
> celular que tiene un cuaderno dibujado dentro de la pantalla. Estilo
> infográfico para niños, sin texto técnico, solo íconos simples."

## 4. ¿Cómo funciona todo junto? (el viaje de una medición)

Imaginate que la mano tiembla un poquito. Esto es lo que pasa, paso a paso,
como una carrera de postas:

1. El sensor **MPU6050** siente que la muñeca se mueve 100 veces por
   segundo (súper rápido, como tomar 100 fotitos del movimiento cada
   segundo).
2. El "cerebro" de la pulsera (**XIAO ESP32-C3**) junta esas fotitos durante
   un ratito (2.56 segundos) y las analiza con matemáticas para separar: ¿esto
   es un temblor de verdad, o la persona solo está moviendo el brazo a
   propósito (por ejemplo, para comer)?
3. Si **sí es un temblor**, la pulsera decide qué tan fuerte es: **Leve**,
   **Moderado** o **Severo** — como ponerle una etiqueta de color: 🟢🟡🔴.
4. La pulsera le **avisa al celular por Bluetooth**, mandándole un
   paquetito de información cada 0.32 segundos (súper rápido también).
5. El celular **guarda ese paquetito en su libretita digital** (la base de
   datos).
6. Cuando el doctor o la familia abren la app, pueden ver **gráficas**,
   un **calendario** de los días con temblor, y hasta pedir un **PDF** para
   imprimir o enviar.

> 🖼️ **Imagen 4 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Infografía ilustrada para niños, estilo
> línea de tiempo horizontal con 6 pasos numerados y pequeños íconos
> redondeados en colores pastel: 1) una mano temblando, 2) un chip con
> engranajes pensando, 3) tres etiquetas de colores verde, amarilla y roja,
> 4) una ondita de Bluetooth viajando hacia un celular, 5) un cuaderno dentro
> del celular, 6) una gráfica y un papel de PDF saliendo de la pantalla.
> Fondo blanco, estilo amigable tipo libro de cuentos, sin texto técnico."

## 5. El código del Arduino (la pulsera), explicado fácil

El cerebrito de la pulsera (el programa que corre en el ESP32-C3) hace cinco
cosas, una detrás de la otra, muy rápido y todo el tiempo:

### a) Leer el sensor (`mpu6050.*`)
Le pregunta al sensor: *"¿hacia dónde y cuánto te moviste?"* 100 veces por
segundo. Esto da tres números (uno por cada dirección: adelante-atrás,
izquierda-derecha, arriba-abajo).

### b) Filtrar la señal (`butterworth_filter.h`)
Es como un colador: deja pasar **solo** los movimientos que vibran entre 4 y
6 veces por segundo, que es justo la velocidad típica del temblor de
Parkinson. Si la persona mueve el brazo despacio (para tomar un vaso, por
ejemplo), ese colador lo bloquea y no lo confunde con temblor.

### c) Sacar "características" de la señal (`dsp_features.*`)
Aquí la computadora calcula tres números resumen cada 0.32 segundos:
- **RMS**: qué tan fuerte es la vibración en la banda del temblor.
- **PSD_max y pureza**: si esa vibración es un "pico" bien definido (como una
  nota musical limpia) o es puro ruido desordenado.
- **motionRms**: si el brazo se está moviendo *a propósito* (despacio), para
  no confundirlo con temblor.

### d) Decidir la severidad (`severity_classifier.*`)
Con esos tres números, el programa decide:
- Si el brazo se estaba moviendo a propósito → **no es temblor**, se ignora.
- Si no hay un pico limpio de vibración → **no es temblor**, se ignora.
- Si pasó esos dos filtros → compara los números con tres "perfiles guardados"
  (Leve, Moderado, Severo) y elige el más parecido, como cuando comparás un
  color con una paleta de pinturas para saber cuál se parece más.
- Además espera un poquito antes de cambiar de etiqueta (para no estar
  parpadeando entre Leve y Moderado todo el rato).

### e) Avisarle al celular (`ble_service.*` y `ble_protocol.h`)
Arma un paquetito con 14 números/letras (hora, RMS, PSD, severidad, número de
la pulsera) y lo manda por Bluetooth. Este paquetito tiene que tener
**exactamente** la misma forma del lado de la pulsera y del lado de la app,
o si no se entienden mal, como hablar dos idiomas distintos.

```
┌───────────────────────────────┐
│ hora | RMS | PSD | severidad | id │   ← 14 bytes viajando por Bluetooth
└───────────────────────────────┘
```

## 6. La lógica de la aplicación (el celular), explicada fácil

1. **`BleService.ts`** — es quien "escucha" el Bluetooth: busca la pulsera,
   se conecta, y cada vez que llega un paquetito lo traduce de números en
   binario a algo que el resto de la app entiende (`payload.ts`).
2. **`useTremorMonitor.ts`** — es el encargado de recibir esa información y
   guardarla, ademas de mostrar en vivo la severidad actual en la pantalla.
3. **`periods.ts`** — agrupa las medidas en "corridas": si la severidad
   cambia o hay un hueco de tiempo (la pulsera se desconectó un rato), corta
   ahí y empieza una corrida nueva. Esto sirve para calcular **episodios** de
   temblor (por ejemplo: "tembló fuerte desde las 3:15 hasta las 3:40").
4. **`ranges.ts`** — sabe calcular qué es "hoy", "esta semana" (de lunes a
   domingo) y "este mes", como un calendario normal.
5. **Pantallas (`HomeScreen.tsx`, `HistoryScreen.tsx`)** — son las dos
   pestañas: **Monitor** (lo que está pasando ahora mismo) e **Historial**
   (lo que pasó antes, con gráficas y calendario).
6. **`pdf.ts` / `report.ts` / `exportPdf.ts`** — arman un reporte en PDF con
   gráficas y texto, para que se pueda compartir con el médico sin necesitar
   internet ni ninguna cuenta.

> 🖼️ **Imagen 5 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Mockup ilustrado tipo dibujo infantil de
> una pantalla de celular amigable, con dos pestañas redondeadas arriba
> llamadas con íconos (un corazón latiendo para 'ahora' y un calendario para
> 'antes'), debajo una gráfica de barras simple de colores verde, amarillo y
> rojo, y un botón redondeado con un ícono de documento para exportar.
> Colores pastel, estilo app para niños, sin texto real, solo íconos."

## 7. La libretita digital (la base de datos), explicada fácil

Todo lo que llega de la pulsera se guarda en una tabla gigante llamada
`readings` (en español: "lecturas"), como una hoja de cálculo con estas
columnas:

| Columna | Qué guarda |
|---|---|
| `device_timestamp_ms` | La hora según el reloj de la pulsera |
| `received_at` | La hora según el reloj del celular |
| `rms` | Qué tan fuerte fue el temblor |
| `psd_max` | Qué tan "limpio" fue el pico de vibración |
| `severity` | La etiqueta: 0 = Leve, 1 = Moderado, 2 = Severo |
| `device_id` | El número de la pulsera (por si hay más de una) |

Como la pulsera manda una medida casi 3 veces por segundo, en **un solo día**
se juntan como **270,000 filas** — ¡muchísimas! Por eso la libretita no deja
que el celular las lea todas de una (sería como pedirle a un niño que cuente
270,000 caramelos uno por uno). En cambio, le pedimos a la propia libretita
que haga la cuenta por nosotros con "trucos de SQL" (ventanas y agrupamientos),
y ella nos devuelve solo el resumen: cuántas fueron Leves, cuántas Moderadas,
cuántas Severas, y en qué ratos pasó cada episodio.

> 🖼️ **Imagen 6 — aquí va tu dibujo o foto**
>
> *Prompt para generar la imagen:* "Ilustración infantil de un cuaderno
> gigante y amigable con ojos y sonrisa (personificado), con filas y columnas
> dibujadas de forma simple y coloreadas en verde, amarillo y rojo como
> fichas, mientras una lupa mágica sobrevuela resumiendo las fichas en tres
   pilas ordenadas de cada color al costado. Estilo cuento ilustrado, sin
   texto técnico."

## 8. Resumen para contarlo en una frase

> *"Hicimos una pulsera que siente cuándo tiembla una mano, decide qué tan
> fuerte es el temblor, se lo cuenta al celular por Bluetooth, y el celular
> lo guarda y lo dibuja en gráficas para que el doctor pueda ayudar mejor."*

---

### Notas para quien use este documento
- Reemplazá cada bloque "🖼️ Imagen N" con tu propia imagen (foto, dibujo
  escaneado, o una imagen generada con el *prompt* sugerido justo encima).
- Los *prompts* están escritos para generadores de imágenes tipo
  texto-a-imagen; podés ajustarlos agregando el nombre de tu personaje o
  colores favoritos.
