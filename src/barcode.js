import JsBarcode from "jsbarcode";

export const EXPORT_PPI = 300;
export const BARCODE_CORNER_RADIUS = 4;

const BARCODE_FONT_FAMILY = 'Inter, "SF Pro Display", "Segoe UI", Arial, sans-serif';
const BARCODE_FONT_WEIGHT = 500;
const BARCODE_TEXT_MARGIN = 8;

export const DEFAULT_SETTINGS = Object.freeze({
  background: "#ffffff",
  displayValue: true,
  exportHeightCm: 3,
  exportWidthCm: 6,
  fontSize: 18,
  height: 92,
  lineColor: "#101828",
  margin: 16,
  textColor: "#101828",
});

function barcodeOptions(
  settings,
  width,
  displayValue = settings.displayValue,
) {
  return {
    background: settings.background,
    displayValue,
    font: BARCODE_FONT_FAMILY,
    fontOptions: String(BARCODE_FONT_WEIGHT),
    fontSize: Number(settings.fontSize),
    format: "CODE128",
    height: Number(settings.height),
    lineColor: settings.lineColor,
    margin: Number(settings.margin),
    textMargin: BARCODE_TEXT_MARGIN,
    width,
  };
}

function fittedTextSize(value, desiredSize, availableWidth) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return desiredSize;

  context.font = `${BARCODE_FONT_WEIGHT} ${desiredSize}px ${BARCODE_FONT_FAMILY}`;
  const measuredWidth = context.measureText(value).width;
  if (!(measuredWidth > availableWidth)) return desiredSize;
  return Math.max(0.5, (desiredSize * availableWidth) / measuredWidth);
}

function appendBarcodeText(svg, value, settings, sourceWidth, fontSize) {
  if (!settings.displayValue) return;

  const margin = Number(settings.margin);
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(sourceWidth / 2));
  text.setAttribute(
    "y",
    String(margin + Number(settings.height) + BARCODE_TEXT_MARGIN + fontSize),
  );
  text.setAttribute("fill", settings.textColor || settings.lineColor);
  text.setAttribute("font-family", BARCODE_FONT_FAMILY);
  text.setAttribute("font-size", String(fontSize));
  text.setAttribute("font-weight", String(BARCODE_FONT_WEIGHT));
  text.setAttribute("text-anchor", "middle");
  text.textContent = value;
  svg.appendChild(text);
}

function fittedBarcodeLayout(value, settings, baseSourceHeight) {
  const aspectRatio =
    normalizeExportWidthCm(settings.exportWidthCm) /
    normalizeExportHeightCm(settings.exportHeightCm);
  const margin = Number(settings.margin);
  const desiredSize = Number(settings.fontSize);
  let fontSize = settings.displayValue ? desiredSize : 0;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sourceHeight =
      baseSourceHeight +
      (settings.displayValue ? BARCODE_TEXT_MARGIN + fontSize : 0);
    const sourceWidth = aspectRatio * sourceHeight;
    const nextFontSize = settings.displayValue
      ? fittedTextSize(value, desiredSize, Math.max(1, sourceWidth - margin * 2))
      : 0;

    if (Math.abs(nextFontSize - fontSize) < 0.001) {
      const fittedSourceHeight =
        baseSourceHeight +
        (settings.displayValue ? BARCODE_TEXT_MARGIN + nextFontSize : 0);
      return {
        fontSize: nextFontSize,
        sourceHeight: fittedSourceHeight,
        sourceWidth: aspectRatio * fittedSourceHeight,
      };
    }
    fontSize = nextFontSize;
  }

  const sourceHeight =
    baseSourceHeight +
    (settings.displayValue ? BARCODE_TEXT_MARGIN + fontSize : 0);
  return {
    fontSize,
    sourceHeight,
    sourceWidth: aspectRatio * sourceHeight,
  };
}

function createSvgElement(value, settings = DEFAULT_SETTINGS) {
  const firstProbe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const secondProbe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(firstProbe, value, barcodeOptions(settings, 1, false));
  JsBarcode(secondProbe, value, barcodeOptions(settings, 2, false));
  const baseSourceHeight = Number.parseFloat(firstProbe.getAttribute("height"));
  const firstWidth = Number.parseFloat(firstProbe.getAttribute("width"));
  const secondWidth = Number.parseFloat(secondProbe.getAttribute("width"));
  const widthPerUnit = secondWidth - firstWidth;
  if (!(baseSourceHeight > 0) || !(firstWidth > 0) || !(widthPerUnit > 0)) {
    throw new Error("无法读取条码尺寸");
  }

  const layout = fittedBarcodeLayout(value, settings, baseSourceHeight);
  const { fontSize, sourceHeight, sourceWidth: targetSourceWidth } = layout;
  const fixedWidth = firstWidth - widthPerUnit;
  const sourceBarWidth = Math.max(
    0.001,
    (targetSourceWidth - fixedWidth) / widthPerUnit,
  );
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, barcodeOptions(settings, sourceBarWidth, false));
  const generatedWidth = Number.parseFloat(svg.getAttribute("width"));
  if (!(generatedWidth > 0)) {
    throw new Error("无法读取条码尺寸");
  }
  const backgroundRect = svg.querySelector(":scope > rect");
  if (backgroundRect) {
    backgroundRect.setAttribute("width", String(targetSourceWidth));
    backgroundRect.setAttribute("height", String(sourceHeight));
    const radius = Math.min(
      BARCODE_CORNER_RADIUS,
      targetSourceWidth / 2,
      sourceHeight / 2,
    );
    backgroundRect.setAttribute("rx", String(radius));
    backgroundRect.setAttribute("ry", String(radius));
    svg.style.borderRadius = `${radius}px`;
  }
  appendBarcodeText(svg, value, settings, targetSourceWidth, fontSize);
  svg.setAttribute("viewBox", `0 0 ${targetSourceWidth} ${sourceHeight}`);
  svg.setAttribute("width", `${targetSourceWidth}px`);
  svg.setAttribute("height", `${sourceHeight}px`);
  svg.setAttribute("preserveAspectRatio", "none");
  return svg;
}

export function serializeBarcode(value, settings = DEFAULT_SETTINGS) {
  const svg = createSvgElement(value, settings);
  return new XMLSerializer().serializeToString(svg);
}

export function parseBarcodeInput(input, settings = DEFAULT_SETTINGS) {
  const values = input
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);

  return values.map((value, index) => {
    try {
      return {
        duplicate: (counts.get(value) || 0) > 1,
        error: null,
        id: `${index}-${value}`,
        index,
        svg: serializeBarcode(value, settings),
        valid: true,
        value,
      };
    } catch {
      return {
        duplicate: (counts.get(value) || 0) > 1,
        error: "当前 CODE128 条码不支持这一行内容",
        id: `${index}-${value}`,
        index,
        svg: "",
        valid: false,
        value,
      };
    }
  });
}

export function safeFilename(value, fallback = "barcode") {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function svgBlob(svg) {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

function normalizeExportHeightCm(value) {
  const height = Number(value);
  return Math.min(
    10,
    Math.max(1, Number.isFinite(height) ? height : DEFAULT_SETTINGS.exportHeightCm),
  );
}

function normalizeExportWidthCm(value) {
  const width = Number(value);
  return Math.min(
    20,
    Math.max(3, Number.isFinite(width) ? width : DEFAULT_SETTINGS.exportWidthCm),
  );
}

function sizeSvgForExport(
  svg,
  requestedHeightCm = DEFAULT_SETTINGS.exportHeightCm,
  requestedWidthCm = DEFAULT_SETTINGS.exportWidthCm,
) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const element = document.documentElement;
  const viewBox = (element.getAttribute("viewBox") || "")
    .trim()
    .split(/\s+/)
    .map(Number);
  const sourceWidth =
    viewBox.length === 4 && Number.isFinite(viewBox[2])
      ? viewBox[2]
      : Number.parseFloat(element.getAttribute("width"));
  const sourceHeight =
    viewBox.length === 4 && Number.isFinite(viewBox[3])
      ? viewBox[3]
      : Number.parseFloat(element.getAttribute("height"));

  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error("无法读取条码尺寸");
  }

  const heightCm = normalizeExportHeightCm(requestedHeightCm);
  const widthCm = normalizeExportWidthCm(requestedWidthCm);
  const height = Math.max(1, Math.round((heightCm / 2.54) * EXPORT_PPI));
  const width = Math.max(1, Math.round((widthCm / 2.54) * EXPORT_PPI));

  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    element.setAttribute("viewBox", `0 0 ${sourceWidth} ${sourceHeight}`);
  }
  element.setAttribute("width", `${Number(widthCm.toFixed(1))}cm`);
  element.setAttribute("height", `${Number(heightCm.toFixed(1))}cm`);
  element.setAttribute("preserveAspectRatio", "none");

  return {
    height,
    svg: new XMLSerializer().serializeToString(element),
    width,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngDensityChunk(ppi) {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  const pixelsPerMeter = Math.round(ppi / 0.0254);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, pixelsPerMeter);
  view.setUint32(12, pixelsPerMeter);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

async function setPngDensity(blob, ppi = EXPORT_PPI) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const densityChunk = createPngDensityChunk(ppi);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));

    if (type === "pHYs") {
      if (!inserted) parts.push(densityChunk);
      inserted = true;
    } else {
      if (type === "IDAT" && !inserted) {
        parts.push(densityChunk);
        inserted = true;
      }
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }

  if (offset < bytes.length) parts.push(bytes.subarray(offset));
  return new Blob(parts, { type: "image/png" });
}

export async function svgToPngBlob(
  svg,
  exportHeightCm = DEFAULT_SETTINGS.exportHeightCm,
  exportWidthCm = DEFAULT_SETTINGS.exportWidthCm,
) {
  const sized = sizeSvgForExport(svg, exportHeightCm, exportWidthCm);
  const sourceBlob = svgBlob(sized.svg);
  const sourceUrl = URL.createObjectURL(sourceBlob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("条码图像加载失败"));
      image.src = sourceUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = sized.width;
    canvas.height = sized.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建导出画布");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG 生成失败"))),
        "image/png",
      );
    });
    return await setPngDensity(blob);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function downloadRecord(
  record,
  format = "png",
  exportHeightCm = DEFAULT_SETTINGS.exportHeightCm,
  exportWidthCm = DEFAULT_SETTINGS.exportWidthCm,
) {
  const basename = safeFilename(record.value);
  if (format === "svg") {
    const sized = sizeSvgForExport(record.svg, exportHeightCm, exportWidthCm);
    downloadBlob(svgBlob(sized.svg), `${basename}.svg`);
    return `${basename}.svg`;
  }

  const blob = await svgToPngBlob(record.svg, exportHeightCm, exportWidthCm);
  downloadBlob(blob, `${basename}.png`);
  return `${basename}.png`;
}

export async function downloadRecords(
  records,
  format = "png",
  exportHeightCm = DEFAULT_SETTINGS.exportHeightCm,
  exportWidthCm = DEFAULT_SETTINGS.exportWidthCm,
) {
  const filenames = [];

  for (const record of records) {
    filenames.push(
      await downloadRecord(record, format, exportHeightCm, exportWidthCm),
    );
  }

  return filenames;
}
