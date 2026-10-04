import { fromByteArray, toByteArray } from 'base64-js';

/**
 * Minimal PDF writer: enough to lay out the tremor report, and nothing else.
 *
 * Written by hand instead of pulling in a PDF library or a native
 * HTML-to-PDF module because the whole feature is a few hundred bytes of
 * page description: text in the standard Helvetica faces (which every reader
 * has, so nothing needs embedding), filled rectangles for the bars and table
 * banding, and one JPEG passed through untouched via /DCTDecode. That keeps
 * the export free of native code, so it works without rebuilding the app.
 *
 * Coordinates are given top-left origin, y growing downwards, because that is
 * how the report reads; they are flipped to PDF's bottom-left origin on the way
 * out.
 */

// A4 in points.
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const BLACK: Rgb = { r: 0.08, g: 0.11, b: 0.14 };
export const GREY: Rgb = { r: 0.36, g: 0.37, b: 0.39 };
export const LIGHT: Rgb = { r: 0.9, g: 0.94, b: 0.97 };
export const MILD: Rgb = { r: 0.13, g: 0.77, b: 0.37 };
export const MODERATE: Rgb = { r: 0.85, g: 0.47, b: 0.02 };
export const SEVERE: Rgb = { r: 0.71, g: 0.11, b: 0.15 };

export type FontName = 'regular' | 'bold';

/**
 * Characters outside ASCII that the report can produce, mapped to their
 * WinAnsiEncoding byte. Latin-1 already covers the accented vowels and ñ, ° and
 * ²; the dashes and quotes live in WinAnsi's 0x80-0x9F block, where Latin-1 has
 * control codes instead, so those need the explicit mapping.
 */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '—': 0x97, // em dash
  '–': 0x96, // en dash
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95, // bullet
  '€': 0x80,
};

function latin1Bytes(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0xff) {
      out.push(code);
    } else if (WIN_ANSI_EXTRA[char] !== undefined) {
      out.push(WIN_ANSI_EXTRA[char]);
    } else {
      out.push(0x3f); // '?'
    }
  }
  return out;
}

/** Escapes a string for a PDF literal, byte by byte in WinAnsi. */
function pdfString(text: string): string {
  let out = '(';
  for (const byte of latin1Bytes(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += '\\' + String.fromCharCode(byte);
    } else if (byte < 0x20 || byte > 0x7e) {
      out += '\\' + byte.toString(8).padStart(3, '0');
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out + ')';
}

function num(value: number): string {
  // PDF wants a plain decimal, and trailing zeros are noise.
  return (Math.round(value * 100) / 100).toString();
}

function color(c: Rgb): string {
  return `${num(c.r)} ${num(c.g)} ${num(c.b)}`;
}

/**
 * Widths of Helvetica and Helvetica-Bold, per 1000 units, for the printable
 * ASCII range starting at space (32). Needed to centre and right-align text and
 * to wrap it, since there is no layout engine here. Non-ASCII falls back to the
 * width of 'o', which is close enough for accented vowels.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export function textWidth(text: string, size: number, font: FontName = 'regular'): number {
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const fallback = table[0x6f - 32];
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const index = code - 32;
    total += index >= 0 && index < table.length ? table[index] : fallback;
  }
  return (total * size) / 1000;
}

/** Greedy word wrap to a maximum width, in the given font. */
export function wrapText(text: string, size: number, maxWidth: number, font: FontName = 'regular'): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, font) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

export interface JpegImage {
  base64: string;
  width: number;
  height: number;
}

interface PdfObject {
  /** Body without the "N 0 obj" wrapper or "endobj". */
  head: string;
  /** Optional raw stream payload. */
  stream?: Uint8Array;
}

export class PdfBuilder {
  private pages: string[] = [];
  private current: string[] = [];
  private image: JpegImage | null = null;

  constructor(image?: JpegImage) {
    this.image = image ?? null;
  }

  /** Starts a new page; the first call is implicit on the first draw. */
  newPage(): void {
    if (this.current.length > 0) {
      this.pages.push(this.current.join('\n'));
      this.current = [];
    }
  }

  get pageCount(): number {
    return this.pages.length + (this.current.length > 0 ? 1 : 0);
  }

  text(
    value: string,
    x: number,
    y: number,
    options: { size?: number; font?: FontName; color?: Rgb; align?: 'left' | 'center' | 'right' } = {},
  ): void {
    const size = options.size ?? 10;
    const font = options.font ?? 'regular';
    const align = options.align ?? 'left';
    let drawX = x;
    if (align !== 'left') {
      const width = textWidth(value, size, font);
      drawX = align === 'center' ? x - width / 2 : x - width;
    }
    const fontRef = font === 'bold' ? '/F2' : '/F1';
    this.current.push(
      `BT ${color(options.color ?? BLACK)} rg ${fontRef} ${num(size)} Tf ` +
        `${num(drawX)} ${num(PAGE_HEIGHT - y - size)} Td ${pdfString(value)} Tj ET`,
    );
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb): void {
    this.current.push(
      `${color(fill)} rg ${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re f`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, width = 0.6): void {
    this.current.push(
      `${color(stroke)} RG ${num(width)} w ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ` +
        `${num(x2)} ${num(PAGE_HEIGHT - y2)} l S`,
    );
  }

  /** Draws the document's JPEG, if one was supplied. */
  drawImage(x: number, y: number, width: number, height: number): void {
    if (!this.image) {
      return;
    }
    this.current.push(
      `q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(PAGE_HEIGHT - y - height)} cm /Im0 Do Q`,
    );
  }

  /** Serializes the document and returns it base64-encoded. */
  toBase64(): string {
    return fromByteArray(this.build());
  }

  private build(): Uint8Array {
    this.newPage();
    if (this.pages.length === 0) {
      this.pages.push('');
    }

    const objects: PdfObject[] = [];
    const push = (object: PdfObject): number => {
      objects.push(object);
      return objects.length; // object numbers are 1-based
    };

    // Reserve 1 for the catalog and 2 for the page tree, so the page objects can
    // point at the tree before it knows its children.
    const catalogNum = push({ head: '' });
    const pagesNum = push({ head: '' });
    const fontRegularNum = push({
      head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    });
    const fontBoldNum = push({
      head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    });

    let imageNum = 0;
    if (this.image) {
      const bytes = toByteArray(this.image.base64);
      imageNum = push({
        head:
          `<< /Type /XObject /Subtype /Image /Width ${this.image.width} ` +
          `/Height ${this.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
          `/Filter /DCTDecode /Length ${bytes.length} >>`,
        stream: bytes,
      });
    }

    const resourcesNum = push({
      head:
        `<< /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >>` +
        (imageNum ? ` /XObject << /Im0 ${imageNum} 0 R >>` : '') +
        ' >>',
    });

    const pageNums: number[] = [];
    for (const content of this.pages) {
      const stream = new Uint8Array(latin1Bytes(content));
      const contentNum = push({
        head: `<< /Length ${stream.length} >>`,
        stream,
      });
      pageNums.push(
        push({
          head:
            `<< /Type /Page /Parent ${pagesNum} 0 R ` +
            `/MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
            `/Resources ${resourcesNum} 0 R /Contents ${contentNum} 0 R >>`,
        }),
      );
    }

    objects[catalogNum - 1].head = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
    objects[pagesNum - 1].head =
      `<< /Type /Pages /Count ${pageNums.length} /Kids [` +
      pageNums.map(n => `${n} 0 R`).join(' ') +
      '] >>';

    // Assemble, tracking each object's byte offset for the xref table.
    const chunks: Uint8Array[] = [];
    let length = 0;
    const write = (bytes: Uint8Array) => {
      chunks.push(bytes);
      length += bytes.length;
    };
    const writeAscii = (text: string) => write(new Uint8Array(latin1Bytes(text)));

    writeAscii('%PDF-1.4\n');
    // A comment with high bytes marks the file as binary for tools that care.
    write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets[index] = length;
      writeAscii(`${index + 1} 0 obj\n${object.head}\n`);
      if (object.stream) {
        writeAscii('stream\n');
        write(object.stream);
        writeAscii('\nendstream\n');
      }
      writeAscii('endobj\n');
    });

    const xrefOffset = length;
    writeAscii(`xref\n0 ${objects.length + 1}\n`);
    writeAscii('0000000000 65535 f \n');
    for (const offset of offsets) {
      // Every entry must be exactly 20 bytes.
      writeAscii(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    writeAscii(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    );

    const out = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}
