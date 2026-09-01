import JsBarcode from "jsbarcode";

export const EXPORT_PPI = 300;

export const DEFAULT_SETTINGS = Object.freeze({
  background: "#ffffff",
  displayValue: true,
  exportHeightCm: 3,
  exportWidthCm: 6,
  fontSize: 18,
  height: 92,
  lineColor: "#101828",
  margin: 16,
});

function barcodeOptions(settings, width) {
  return {
    background: settings.background,
    displayValue: settings.displayValue,
    font: 'Inter, "SF Pro Display", "Segoe UI", Arial, sans-serif',
    fontOptions: "500",
    fontSize: Number(settings.fontSize),
    format: "CODE128",
    height: Number(settings.height),
    lineColor: settings.lineColor,
    margin: Number(settings.margin),
    textMargin: 8,
    width,
  };
}

function createSvgElement(value, settings = DEFAULT_SETTINGS) {
  const firstProbe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const secondProbe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(firstProbe, value, barcodeOptions(settings, 1));
  JsBarcode(secondProbe, value, barcodeOptions(settings, 2));
  const sourceHeight = Number.parseFloat(firstProbe.getAttribute("height"));
  const firstWidth = Number.parseFloat(firstProbe.getAttribute("width"));
  const secondWidth = Number.parseFloat(secondProbe.getAttribute("width"));
  const widthPerUnit = secondWidth - firstWidth;
  if (!(sourceHeight > 0) || !(firstWidth > 0) || !(widthPerUnit > 0)) {
    throw new Error("无法读取条码尺寸");
  }

  const exportWidthCm = normalizeExportWidthCm(settings.exportWidthCm);
  const exportHeightCm = normalizeExportHeightCm(settings.exportHeightCm);
  const fixedWidth = firstWidth - widthPerUnit;
  const targetSourceWidth = (exportWidthCm / exportHeightCm) * sourceHeight;
  const sourceBarWidth = Math.max(
    0.01,
    (targetSourceWidth - fixedWidth) / widthPerUnit,
  );
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, barcodeOptions(settings, sourceBarWidth));
  const naturalWidth = Number.parseFloat(svg.getAttribute("width"));
  const naturalHeight = Number.parseFloat(svg.getAttribute("height"));
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    throw new Error("无法读取条码尺寸");
  }
  svg.setAttribute("viewBox", `0 0 ${naturalWidth} ${naturalHeight}`);
  svg.setAttribute("width", `${targetSourceWidth}px`);
  svg.setAttribute("height", `${naturalHeight}px`);
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
  exportHeightCm = DEFAULT_SETTINGS.exportHeightCm,
  exportWidthCm = DEFAULT_SETTINGS.exportWidthCm,
) {
  const filenames = [];

  for (const record of records) {
    const blob = await svgToPngBlob(record.svg, exportHeightCm, exportWidthCm);
    const filename = `${safeFilename(record.value)}.png`;
    downloadBlob(blob, filename);
    filenames.push(filename);
  }

  return filenames;
}
