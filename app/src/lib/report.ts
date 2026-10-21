import { LOGO_JPEG_BASE64, LOGO_JPEG_HEIGHT, LOGO_JPEG_WIDTH } from '../assets/logoBase64';
import { SEVERITY_LABELS } from '../ble/constants';
import type { SeverityBucket, SeveritySummary } from '../db/database';
import {
  GREY,
  LIGHT,
  MILD,
  MODERATE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PdfBuilder,
  SEVERE,
  textWidth,
  wrapText,
  type Rgb,
} from './pdf';
import { formatDuration, type TremorEpisode } from './periods';
import { bucketLabel, bucketPlan, describeRange, type DateRange } from './ranges';

const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TOP = PAGE_HEIGHT - 52;

/** Caps the episode table at a handful of pages regardless of how many the range actually has. */
const MAX_PDF_EPISODES = 200;

const SEVERITY_COLORS: Rgb[] = [MILD, MODERATE, SEVERE];

export interface ReportData {
  range: DateRange;
  summary: SeveritySummary;
  episodes: TremorEpisode[];
  buckets: SeverityBucket[];
  generatedAt: number;
  /** Measured ms per reading, which is what turns counts into time. */
  cadenceMs: number;
  /** Minutes with tremor per weekday (index 0 = Sunday), as shown on the Semana/Mes history view. */
  weekdayMinutes: number[];
  /** Minutes with tremor per hour of day (index 0-23), as shown on the Semana/Mes history view. */
  hourMinutes: number[];
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return `${date} ${formatTime(ms)}`;
}

function formatDayShort(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Lays the report out across as many pages as the episode table needs. */
export function buildReportPdf(data: ReportData): string {
  const pdf = new PdfBuilder({
    base64: LOGO_JPEG_BASE64,
    width: LOGO_JPEG_WIDTH,
    height: LOGO_JPEG_HEIGHT,
  });

  let y = 0;
  let pageIndex = 0;

  const drawFooter = () => {
    pdf.line(MARGIN, FOOTER_TOP, PAGE_WIDTH - MARGIN, FOOTER_TOP, LIGHT, 0.8);
    pdf.text(
      'Generado por la pulsera de monitoreo de temblor. Los umbrales de severidad no están ' +
        'calibrados clínicamente: este informe es un registro de mediciones, no un diagnóstico.',
      MARGIN,
      FOOTER_TOP + 8,
      { size: 6.5, color: GREY },
    );
    pdf.text(`Página ${pageIndex + 1}`, PAGE_WIDTH - MARGIN, FOOTER_TOP + 8, {
      size: 6.5,
      color: GREY,
      align: 'right',
    });
  };

  const startPage = (withHeader: boolean) => {
    if (pageIndex > 0 || pdf.pageCount > 0) {
      drawFooter();
      pdf.newPage();
      pageIndex++;
    }
    if (withHeader) {
      // The logo keeps its aspect ratio: 300x164 scaled to 104 wide.
      const logoWidth = 104;
      const logoHeight = (LOGO_JPEG_HEIGHT / LOGO_JPEG_WIDTH) * logoWidth;
      pdf.drawImage(MARGIN, MARGIN - 6, logoWidth, logoHeight);
      pdf.text('Reporte de monitoreo de temblor', MARGIN + logoWidth + 16, MARGIN - 2, {
        size: 15,
        font: 'bold',
      });
      pdf.text(describeRange(data.range), MARGIN + logoWidth + 16, MARGIN + 18, {
        size: 10,
        color: GREY,
      });
      pdf.text(`Generado el ${formatDateTime(data.generatedAt)}`, MARGIN + logoWidth + 16, MARGIN + 32, {
        size: 8,
        color: GREY,
      });
      y = MARGIN + logoHeight + 6;
      pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y, LIGHT, 1);
      y += 18;
    } else {
      pdf.text('Reporte de monitoreo de temblor (continuación)', MARGIN, MARGIN, {
        size: 10,
        font: 'bold',
        color: GREY,
      });
      y = MARGIN + 24;
    }
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > FOOTER_TOP - 10) {
      startPage(false);
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(34);
    pdf.text(title, MARGIN, y, { size: 11, font: 'bold' });
    y += 16;
  };

  startPage(true);

  // ---- Resumen -------------------------------------------------------------
  sectionTitle('Resumen');

  const { summary } = data;
  const tiles: { label: string; value: string; unit: string }[] = [
    { label: 'Episodios', value: String(data.episodes.length), unit: 'detectados' },
    { label: 'Tiempo con temblor', value: formatDuration(summary.tremorDurationMs), unit: 'acumulado' },
    {
      label: 'RMS promedio',
      value: summary.avgRms !== null ? summary.avgRms.toFixed(3) : '--',
      unit: 'm/s²',
    },
    {
      label: 'RMS máximo',
      value: summary.maxRms !== null ? summary.maxRms.toFixed(3) : '--',
      unit: 'm/s²',
    },
  ];

  const tileWidth = (CONTENT_WIDTH - 3 * 8) / 4;
  tiles.forEach((tile, index) => {
    const x = MARGIN + index * (tileWidth + 8);
    pdf.rect(x, y, tileWidth, 50, LIGHT);
    pdf.text(tile.label, x + 8, y + 8, { size: 7, color: GREY });
    pdf.text(tile.value, x + 8, y + 20, { size: 14, font: 'bold' });
    pdf.text(tile.unit, x + 8, y + 38, { size: 7, color: GREY });
  });
  y += 50 + 20;

  // ---- Distribución por severidad -----------------------------------------
  sectionTitle('Distribución por severidad');

  const totalReadings = summary.totalReadings;
  const barLeft = MARGIN + 70;
  const barWidth = CONTENT_WIDTH - 70 - 120;

  for (let level = 0; level < 3; level++) {
    ensureSpace(20);
    const count = summary.counts[level];
    const share = totalReadings > 0 ? count / totalReadings : 0;
    pdf.text(SEVERITY_LABELS[level], MARGIN, y + 2, { size: 8 });
    pdf.rect(barLeft, y, barWidth, 10, LIGHT);
    if (share > 0) {
      pdf.rect(barLeft, y, Math.max(1, barWidth * share), 10, SEVERITY_COLORS[level]);
    }
    pdf.text(
      `${(share * 100).toFixed(1)}%  ·  ${formatDuration(summary.durationsMs[level])}`,
      barLeft + barWidth + 8,
      y + 2,
      { size: 8, color: GREY },
    );
    y += 16;
  }
  y += 10;

  if (totalReadings === 0) {
    ensureSpace(20);
    pdf.text('No hay mediciones registradas en este período.', MARGIN, y, { size: 9, color: GREY });
    y += 20;
  }

  // ---- Gráfico por hora/día --------------------------------------------------
  // Same three sections HistoryScreen shows, in the same order: the time-axis
  // chart always, then - only for Semana/Mes, where they add information the
  // time axis alone doesn't (see the screen's own note on this) - the
  // weekday and hour-of-day breakdowns.
  const plan = bucketPlan(data.range);
  const isDay = data.range.kind === 'day';
  if (totalReadings > 0) {
    sectionTitle(plan.hourly ? 'Por hora' : 'Por día');

    const chartHeight = 110;
    ensureSpace(chartHeight + 26);

    const maxCount = data.buckets.reduce(
      (max, bucket) => Math.max(max, bucket.counts[0] + bucket.counts[1] + bucket.counts[2]),
      0,
    );

    pdf.line(MARGIN, y + chartHeight, PAGE_WIDTH - MARGIN, y + chartHeight, GREY, 0.8);

    const slot = CONTENT_WIDTH / Math.max(1, data.buckets.length);
    const barW = Math.max(2, Math.min(18, slot * 0.62));

    data.buckets.forEach((bucket, index) => {
      const total = bucket.counts[0] + bucket.counts[1] + bucket.counts[2];
      const x = MARGIN + slot * index + (slot - barW) / 2;
      if (maxCount > 0 && total > 0) {
        // Stacked from the axis upwards: mild, moderate, severe.
        let bottom = y + chartHeight;
        for (let level = 0; level < 3; level++) {
          const h = (bucket.counts[level] / maxCount) * chartHeight;
          if (h <= 0) {
            continue;
          }
          pdf.rect(x, bottom - h, barW, h, SEVERITY_COLORS[level]);
          bottom -= h;
        }
      }
      // Axis labels, thinned out when the slots get narrow.
      const step = slot < 14 ? (plan.hourly ? 3 : 2) : 1;
      if (index % step === 0) {
        pdf.text(bucketLabel(data.range, index), MARGIN + slot * index + slot / 2, y + chartHeight + 4, {
          size: 6,
          color: GREY,
          align: 'center',
        });
      }
    });

    const scaleLabel =
      `máx ${formatDuration(maxCount * data.cadenceMs)} por ${plan.hourly ? 'hora' : 'día'}`;
    pdf.text(scaleLabel, PAGE_WIDTH - MARGIN, y - 12, { size: 6.5, color: GREY, align: 'right' });

    y += chartHeight + 26;
  }

  // ---- Por día de la semana / por hora --------------------------------------
  // Single-series bar chart over a fixed category axis (weekday or hour of
  // day) instead of a time axis - same shape and color as the app's own
  // BarMetricChart. `values` are already minutes; unlike the chart above,
  // there is no severity split to stack, so this is also simpler to draw.
  const drawCategoryBarChart = (title: string, labels: string[], values: number[]) => {
    const maxMinutes = Math.max(...values, 0);
    sectionTitle(title);
    if (maxMinutes <= 0) {
      ensureSpace(16);
      pdf.text('Sin temblor en este período.', MARGIN, y, { size: 9, color: GREY });
      y += 20;
      return;
    }

    const chartHeight = 100;
    ensureSpace(chartHeight + 26);

    pdf.line(MARGIN, y + chartHeight, PAGE_WIDTH - MARGIN, y + chartHeight, GREY, 0.8);

    const slot = CONTENT_WIDTH / Math.max(1, values.length);
    const barW = Math.max(2, Math.min(18, slot * 0.62));
    const step = slot < 14 ? (values.length > 20 ? 3 : 2) : 1;

    values.forEach((minutes, index) => {
      const x = MARGIN + slot * index + (slot - barW) / 2;
      const h = (minutes / maxMinutes) * chartHeight;
      if (h > 0) {
        pdf.rect(x, y + chartHeight - h, barW, h, SEVERE);
      }
      if (index % step === 0) {
        pdf.text(labels[index], MARGIN + slot * index + slot / 2, y + chartHeight + 4, {
          size: 6,
          color: GREY,
          align: 'center',
        });
      }
    });

    pdf.text(`pico ${formatDuration(maxMinutes * 60_000)}`, PAGE_WIDTH - MARGIN, y - 12, {
      size: 6.5,
      color: GREY,
      align: 'right',
    });

    y += chartHeight + 26;
  };

  // Only for Semana/Mes: on "Día" these would repeat the chart above exactly,
  // since the range is already a single day - see the matching gate on
  // HistoryScreen.
  if (!isDay) {
    drawCategoryBarChart('Por día de la semana', WEEKDAY_LABELS, data.weekdayMinutes);
    const hourLabels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
    drawCategoryBarChart('Por hora', hourLabels, data.hourMinutes);
  }

  // ---- Episodios -----------------------------------------------------------
  // A busy day of real data easily produces thousands of brief episodes (a
  // day of the ALAMEDA demo recording alone generates ~2600), and the table
  // used to print every single one: tens of pages of nothing but rows. The
  // report is a clinical summary, not a raw dump, so it lists only the most
  // clinically relevant episodes - worst severity first, then longest - and
  // says plainly how many were left out.
  const episodesToShow =
    data.episodes.length > MAX_PDF_EPISODES
      ? [...data.episodes]
          .sort((a, b) => b.maxSeverity - a.maxSeverity || b.durationMs - a.durationMs)
          .slice(0, MAX_PDF_EPISODES)
          .sort((a, b) => a.startedAt - b.startedAt)
      : data.episodes;
  const omittedCount = data.episodes.length - episodesToShow.length;

  sectionTitle(`Episodios (${data.episodes.length})`);

  if (omittedCount > 0) {
    ensureSpace(14);
    pdf.text(
      `Mostrando los ${episodesToShow.length} episodios más relevantes (mayor severidad y duración). ` +
        `${omittedCount} más no se listan; el resumen y el gráfico de arriba sí los incluyen a todos.`,
      MARGIN,
      y,
      { size: 7.5, color: GREY },
    );
    y += 14;
  }

  if (data.episodes.length === 0) {
    pdf.text('Sin episodios de temblor en este período.', MARGIN, y, { size: 9, color: GREY });
    y += 16;
  } else {
    const columns: { title: string; width: number; align: 'left' | 'right' }[] = [
      { title: 'Día', width: 46, align: 'left' },
      { title: 'Inicio', width: 46, align: 'left' },
      { title: 'Fin', width: 46, align: 'left' },
      { title: 'Duración', width: 90, align: 'left' },
      { title: 'Severidad máx.', width: 90, align: 'left' },
      { title: 'Muestras', width: CONTENT_WIDTH - 46 * 3 - 90 * 2, align: 'right' },
    ];

    const drawTableHeader = () => {
      pdf.rect(MARGIN, y, CONTENT_WIDTH, 16, LIGHT);
      let x = MARGIN + 6;
      for (const column of columns) {
        pdf.text(column.title, column.align === 'right' ? x + column.width - 12 : x, y + 5, {
          size: 7.5,
          font: 'bold',
          align: column.align,
        });
        x += column.width;
      }
      y += 16;
    };

    drawTableHeader();

    episodesToShow.forEach((episode, index) => {
      if (y + 15 > FOOTER_TOP - 10) {
        startPage(false);
        drawTableHeader();
      }
      if (index % 2 === 1) {
        pdf.rect(MARGIN, y, CONTENT_WIDTH, 15, { r: 0.97, g: 0.98, b: 0.99 });
      }
      const values = [
        formatDayShort(episode.startedAt),
        formatTime(episode.startedAt),
        formatTime(episode.endedAt),
        formatDuration(episode.durationMs),
        SEVERITY_LABELS[episode.maxSeverity],
        String(episode.sampleCount),
      ];
      let x = MARGIN + 6;
      values.forEach((value, column) => {
        const spec = columns[column];
        const isSeverity = column === 4;
        if (isSeverity) {
          pdf.rect(x, y + 3.5, 8, 8, SEVERITY_COLORS[episode.maxSeverity]);
          pdf.text(value, x + 12, y + 4.5, { size: 7.5 });
        } else {
          pdf.text(value, spec.align === 'right' ? x + spec.width - 12 : x, y + 4.5, {
            size: 7.5,
            align: spec.align,
          });
        }
        x += spec.width;
      });
      y += 15;
    });
  }

  // ---- Nota metodológica ---------------------------------------------------
  y += 14;
  ensureSpace(60);
  pdf.text('Cómo se miden estos datos', MARGIN, y, { size: 9, font: 'bold' });
  y += 13;
  // El intervalo va medido, no supuesto: la pulsera evalúa una ventana cada
  // 0,32 s, pero cada cuánto llega una notificación depende del enlace BLE.
  const cadenceSeconds = (data.cadenceMs / 1000).toFixed(2).replace('.', ',');
  const gapSeconds = ((data.cadenceMs * 3) / 1000).toFixed(2).replace('.', ',');
  const note =
    `En este período llegó una medición cada ${cadenceSeconds} s (intervalo medido, ` +
    'no supuesto: la pulsera evalúa una ventana de 256 muestras a 100 Hz cada 0,32 s, pero ' +
    'cada cuánto llega la notificación depende del enlace Bluetooth). Las duraciones se ' +
    `calculan como cantidad de mediciones por ${cadenceSeconds} s, de modo que una ` +
    'desconexión no agrega tiempo inexistente. Un episodio es una racha con severidad ' +
    'Moderada o Severa; se corta cuando el temblor cesa por más de 2 s, y una racha se ' +
    `interrumpe cuando faltan más de ${gapSeconds} s de datos.`;
  for (const line of wrapText(note, 7.5, CONTENT_WIDTH)) {
    ensureSpace(11);
    pdf.text(line, MARGIN, y, { size: 7.5, color: GREY });
    y += 10;
  }

  drawFooter();
  return pdf.toBase64();
}

/** File name for the exported report, e.g. reporte-temblor-2026-09-28.pdf */
export function reportFileName(range: DateRange): string {
  const d = new Date(range.fromMs);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const suffix = range.kind === 'day' ? iso : `${range.kind}-${iso}`;
  return `reporte-temblor-${suffix}.pdf`;
}

/** Exposed so the screen can show the same summary line the PDF carries. */
export function reportSubject(range: DateRange): string {
  return `Reporte de monitoreo de temblor — ${describeRange(range)}`;
}

// Re-exported so callers do not need to reach into pdf.ts for this.
export { textWidth };
