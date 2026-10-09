// A small .xlsx reader for specs, so a test can open the workbook the CPR tool
// downloads and read what the clinician would see in Excel.
//
// The CPR tool builds its workbook with ExcelJS, but ExcelJS lives under
// apps/tools/cpr and CI installs only apps/tools. An .xlsx file is a zip of XML,
// and node can inflate a zip entry on its own, so this reads the central
// directory, inflates the three parts a cell value needs and nothing else.
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const DEFLATE = 8;

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd--;
  if (eocd < 0) throw new Error('Not a zip file: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) throw new Error(`Bad central directory entry ${i}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === DEFLATE ? inflateRawSync(data) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  return decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
}

/**
 * Every cell of one named sheet, as { A1: value }. Numbers come back as
 * numbers, strings as strings.
 */
export function readSheet(buf, sheetName) {
  const files = unzip(buf);
  const read = (name) => (files.get(name) || Buffer.alloc(0)).toString('utf8');

  const workbook = read('xl/workbook.xml');
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => decode((/name="([^"]*)"/.exec(tag) || [])[1] || '') === sheetName);
  if (!sheet) throw new Error(`No sheet named "${sheetName}"`);
  const rid = /r:id="([^"]*)"/.exec(sheet)[1];
  const rels = read('xl/_rels/workbook.xml.rels');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0])
    .find((tag) => tag.includes(`Id="${rid}"`));
  const target = /Target="([^"]*)"/.exec(rel)[1].replace(/^\/?(xl\/)?/, '');

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const cells = {};
  for (const m of read(`xl/${target}`).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, inner = ''] = m;
    const type = (/t="([^"]*)"/.exec(attrs) || [])[1];
    if (type === 'inlineStr') { cells[ref] = textOf(inner); continue; }
    const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
    if (v === undefined) continue;
    if (type === 's') cells[ref] = shared[Number(v)];
    else if (type === 'str') cells[ref] = decode(v);
    else cells[ref] = Number(v);
  }
  return cells;
}

/** The row number of the first cell in column `col` whose value is `label`, at or after row `from`. */
export function findRow(cells, col, label, from = 1) {
  const rows = Object.keys(cells)
    .filter((ref) => ref.replace(/\d+/g, '') === col && cells[ref] === label)
    .map((ref) => Number(ref.replace(/[A-Z]+/g, '')))
    .filter((r) => r >= from)
    .sort((a, b) => a - b);
  return rows.length ? rows[0] : null;
}
