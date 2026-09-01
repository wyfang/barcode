const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_CELLS = 2_000_000;
const HEADER_SCAN_ROWS = 30;

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function dateText(value) {
  const pad = (part) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function cellText(cell, XLSX) {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  if (cell.v instanceof Date) return dateText(cell.v);
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t !== "n") return String(cell.v);

  const raw = Number(cell.v);
  if (!Number.isFinite(raw)) return "";
  const formatted = XLSX.utils.format_cell(cell);
  const isZeroMask = typeof cell.z === "string" && /^0+$/.test(cell.z);
  if (isZeroMask && formatted) return formatted;
  if (Number.isInteger(raw)) return raw.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  return String(raw);
}

function detectHeaderRow(rows) {
  let best = { index: 0, score: -Infinity };
  const scanLength = Math.min(rows.length, HEADER_SCAN_ROWS);

  for (let rowIndex = 0; rowIndex < scanLength; rowIndex += 1) {
    const cells = rows[rowIndex] || [];
    const texts = cells.map((cell) => cell.text.trim()).filter(Boolean);
    if (!texts.length) continue;

    const uniqueCount = new Set(texts).size;
    const textCount = cells.filter(
      (cell) => cell.text.trim() && cell.type !== "n",
    ).length;
    const nextRows = rows.slice(rowIndex + 1, rowIndex + 4);
    const populatedBelow = nextRows.reduce(
      (count, row) => count + row.filter((cell) => cell.text.trim()).length,
      0,
    );
    const score =
      texts.length * 12 +
      uniqueCount * 3 +
      textCount * 2 +
      Math.min(populatedBelow, texts.length * 3) -
      (texts.length === 1 ? 18 : 0);

    if (score > best.score) best = { index: rowIndex, score };
  }

  return best.index;
}

function buildHeaders(rows, headerRow) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const headerCells = rows[headerRow] || [];
  const counts = new Map();

  for (let index = 0; index < width; index += 1) {
    const name = headerCells[index]?.text.trim() || "未命名列";
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return Array.from({ length: width }, (_, index) => {
    const letter = columnName(index);
    const name = headerCells[index]?.text.trim() || "未命名列";
    return {
      id: String(index),
      index,
      label: `${name}（${letter} 列）`,
      letter,
      name,
      repeated: (counts.get(name) || 0) > 1,
    };
  });
}

function suggestColumn(headers, rows, headerRow) {
  const keyword = /邮件号|运单|单号|编号|条码|barcode|tracking/i;
  const byName = headers.find((header) => keyword.test(header.name));
  if (byName) return byName.index;

  let best = { index: 0, count: -1 };
  for (const header of headers) {
    const count = rows
      .slice(headerRow + 1)
      .reduce(
        (total, row) => total + (row[header.index]?.text.trim() ? 1 : 0),
        0,
      );
    if (count > best.count) best = { index: header.index, count };
  }
  return best.index;
}

function parseSheet(name, worksheet, XLSX) {
  const decoded = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  const rowCount = decoded.e.r - decoded.s.r + 1;
  const columnCount = decoded.e.c - decoded.s.c + 1;
  if (rowCount * columnCount > MAX_CELLS) {
    throw new Error(`工作表“${name}”过大，请控制在 200 万个单元格以内`);
  }

  const rows = [];
  for (let rowIndex = decoded.s.r; rowIndex <= decoded.e.r; rowIndex += 1) {
    const row = [];
    for (let columnIndex = decoded.s.c; columnIndex <= decoded.e.c; columnIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];
      row.push({
        precisionRisk:
          cell?.t === "n" && Number.isInteger(cell.v) && Math.abs(cell.v) >= 1e15,
        text: cellText(cell, XLSX),
        type: cell?.t || "z",
      });
    }
    rows.push(row);
  }

  const suggestedHeaderRow = detectHeaderRow(rows);
  const headers = buildHeaders(rows, suggestedHeaderRow);
  return {
    columnCount,
    headers,
    name,
    rowCount,
    rows,
    suggestedColumn: suggestColumn(headers, rows, suggestedHeaderRow),
    suggestedHeaderRow,
  };
}

export async function readExcelFile(file) {
  if (!file) throw new Error("未选择文件");
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    throw new Error("请选择 .xls 或 .xlsx 文件");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("文件超过 30 MB，请先拆分后再导入");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    cellDates: true,
    cellNF: true,
    cellText: false,
    type: "array",
  });
  if (!workbook.SheetNames.length) throw new Error("Excel 中没有可读取的工作表");

  return {
    fileName: file.name,
    fileSize: file.size,
    sheets: workbook.SheetNames.map((name) =>
      parseSheet(name, workbook.Sheets[name], XLSX),
    ),
  };
}

export function configureSheet(sheet, headerRow, columnIndex) {
  const normalizedHeaderRow = Math.min(
    Math.max(0, Math.round(Number(headerRow) || 0)),
    Math.max(0, sheet.rows.length - 1),
  );
  const headers = buildHeaders(sheet.rows, normalizedHeaderRow);
  const normalizedColumn = Math.min(
    Math.max(0, Math.round(Number(columnIndex) || 0)),
    Math.max(0, headers.length - 1),
  );
  return { headers, headerRow: normalizedHeaderRow, columnIndex: normalizedColumn };
}

export function analyzeExcelColumn(sheet, headerRow, columnIndex) {
  const dataRows = sheet.rows.slice(headerRow + 1);
  const values = [];
  const preview = [];
  let emptyCount = 0;
  let precisionRiskCount = 0;

  for (let index = 0; index < dataRows.length; index += 1) {
    const cell = dataRows[index][columnIndex] || { text: "", precisionRisk: false };
    const value = cell.text.trim();
    if (!value) emptyCount += 1;
    else values.push(value);
    if (cell.precisionRisk) precisionRiskCount += 1;
    if (preview.length < 80) {
      preview.push({ empty: !value, row: headerRow + index + 2, value });
    }
  }

  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const duplicateCount = values.reduce(
    (count, value) => count + ((counts.get(value) || 0) > 1 ? 1 : 0),
    0,
  );
  const previewWithStatus = preview.map((item) => ({
    ...item,
    duplicate: !!item.value && (counts.get(item.value) || 0) > 1,
  }));

  return {
    duplicateCount,
    emptyCount,
    precisionRiskCount,
    preview: previewWithStatus,
    totalCount: dataRows.length,
    validCount: values.length,
    values,
  };
}
