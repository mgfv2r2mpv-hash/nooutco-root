/**
 * excelImport — reads a CPR .xlsx file exported by this tool and reconstructs an Assessment.
 *
 * Sheet detection:
 *   "Data - Attention / Escape / Tangible / Sensory"  → separate single-condition sessions
 *   "Data - Synthesized" (or suffixed "Data - Synthesized 2", etc.) → synthesized sessions
 *
 * Cell mapping: Y → 'yes' | N → 'no' | C/anything else → 'could_not_score'
 */
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import type { Assessment, Session, Interval, ConditionType, ThreeWay, ConsequenceRecord } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';

// ─── Public entry point ───────────────────────────────────────────────────────

export async function importAssessmentFromExcel(file: File): Promise<Assessment> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const now = new Date().toISOString();
  const id  = uuidv4();

  // Parse header from first available data sheet
  let clientName = '';
  let observer   = '';
  let setting    = '';
  let date       = new Date().toISOString().slice(0, 10);
  let startEndTime = '';
  let targetBehaviorName       = '';
  let targetBehaviorDefinition = '';

  // Collect all absolute start/end times across sheets to find the broadest window
  const allStartEndPairs: Array<{ startSec: number; endSec: number }> = [];

  const separateSessions: Partial<Record<ConditionType, Session>> = {};
  const synthesizedSessions: Session[] = [];

  wb.eachSheet(ws => {
    const name = ws.name;

    // Check for separate condition sheets
    const matchedCond = ALL_CONDITIONS.find(
      c => name.toLowerCase() === `data - ${CONDITION_META[c].label.toLowerCase()}`,
    );

    if (matchedCond) {
      const header = parseSheetHeader(ws);
      if (!clientName) {
        clientName   = header.clientName;
        observer     = header.observer;
        setting      = header.setting;
        date         = header.date;
        startEndTime             = header.startEndTime;
        targetBehaviorName       = header.targetBehaviorName;
        targetBehaviorDefinition = header.targetBehaviorDefinition;
      }
      // Collect start/end pair for broadest-window computation
      const pair = parseStartEndAbsoluteSecs(header.startEndTime);
      if (pair) allStartEndPairs.push(pair);

      const intervals = parseSingleConditionIntervals(ws, matchedCond);
      // Per-session elapsed: time column span → interval math fallback
      const elapsed   = deriveElapsedFromTimeColumn(intervals)
        ?? (intervals.length * 10);
      const session   = buildSession(id, 'single', matchedCond, intervals, now, elapsed);
      separateSessions[matchedCond] = session;
      return;
    }

    // Synthesized sheets
    if (/^data - synthesized/i.test(name)) {
      const header = parseSheetHeader(ws);
      if (!clientName) {
        clientName   = header.clientName;
        observer     = header.observer;
        setting      = header.setting;
        date         = header.date;
        startEndTime             = header.startEndTime;
        targetBehaviorName       = header.targetBehaviorName;
        targetBehaviorDefinition = header.targetBehaviorDefinition;
      }
      const pair = parseStartEndAbsoluteSecs(header.startEndTime);
      if (pair) allStartEndPairs.push(pair);

      const intervals = parseSynthesizedIntervals(ws);
      const elapsed   = deriveElapsedFromTimeColumn(intervals)
        ?? (intervals.length * 10);
      const session   = buildSession(id, 'synthesized', null, intervals, now, elapsed);
      synthesizedSessions.push(session);
    }
  });

  if (!clientName && Object.keys(separateSessions).length === 0 && synthesizedSessions.length === 0) {
    throw new Error('No recognisable CPR data sheets found in this file.');
  }

  // Derive broadest window: earliest start → latest end across all parsed sheets
  let importedDurationSeconds: number | undefined;
  if (allStartEndPairs.length > 0) {
    const minStart = Math.min(...allStartEndPairs.map(p => p.startSec));
    const maxEnd   = Math.max(...allStartEndPairs.map(p => p.endSec));
    const window   = maxEnd - minStart;
    if (window > 0) importedDurationSeconds = window;
  }

  return {
    id,
    _schemaVersion: 2,
    clientName:               clientName || 'Imported',
    observer,
    setting,
    date,
    startEndTime,
    targetBehaviorName,
    targetBehaviorDefinition,
    separateSessions,
    synthesizedSessions,
    notes: '',
    importedDurationSeconds,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Header parsing ───────────────────────────────────────────────────────────

interface SheetHeader {
  clientName: string;
  observer: string;
  setting: string;
  date: string;
  startEndTime: string;
  targetBehaviorName: string;
  targetBehaviorDefinition: string;
}

function parseSheetHeader(ws: ExcelJS.Worksheet): SheetHeader {
  // Standard header layout written by excelExport:
  //   Row 3: Client:  <name>
  //   Row 4: Observer: <obs>
  //   Row 5: Setting: <set>
  //   Row 6: Target Behavior Name: <name>
  //   Row 7: Target Behavior Definition: <def>
  //   Row 8: Date: <date>
  //   Row 9: Start Time: <time>   (new format) or Start/End Time: <combined> (old format)
  //   Row 10: End Time: <time>    (new format only)
  function cellStr(row: number, col: number): string {
    return String(ws.getCell(row, col).value ?? '').trim();
  }
  // Detect old vs new header format by checking the row 9 label
  const row9Label = cellStr(9, 1).toLowerCase();
  let startEndTime: string;
  if (row9Label.startsWith('start time')) {
    // New format: separate start and end rows
    const st = cellStr(9, 2);
    const et = cellStr(10, 2);
    startEndTime = [st, et].filter(Boolean).join(' – ');
  } else {
    // Old format: combined "Start/End Time:" in row 9
    startEndTime = cellStr(9, 2);
  }
  return {
    clientName:               cellStr(3, 2),
    observer:                 cellStr(4, 2),
    setting:                  cellStr(5, 2),
    targetBehaviorName:       cellStr(6, 2),
    targetBehaviorDefinition: cellStr(7, 2),
    date:                     cellStr(8, 2),
    startEndTime,
  };
}

// ─── Interval parsing ─────────────────────────────────────────────────────────

function cellToTw(cell: ExcelJS.Cell): ThreeWay {
  const v = String(cell.value ?? '').trim().toUpperCase();
  if (v === 'Y') return 'yes';
  if (v === 'N') return 'no';
  return 'could_not_score';
}

function parseSingleConditionIntervals(ws: ExcelJS.Worksheet, condition: ConditionType): Interval[] {
  // Data starts after header block — find first row where col 1 is a number
  const intervals: Interval[] = [];
  ws.eachRow((row, rowNum) => {
    const first = row.getCell(1).value;
    if (typeof first !== 'number') return;

    const bx   = cellToTw(row.getCell(3));
    const eo   = cellToTw(row.getCell(4));
    const cons = cellToTw(row.getCell(5));

    const defaultCons: ConsequenceRecord = {
      attention: 'could_not_score',
      escape:    'could_not_score',
      tangible:  'could_not_score',
      sensory:   'could_not_score',
    };
    defaultCons[condition] = cons;

    intervals.push({
      id:             uuidv4(),
      intervalNumber: first,
      timeLabel:      String(row.getCell(2).value ?? '').trim(),
      behavior:       bx,
      eo:             { [condition]: eo },
      consequences:   defaultCons,
      note:           String(row.getCell(6).value ?? '').trim(),
    });
    void rowNum;
  });
  return intervals;
}

function parseSynthesizedIntervals(ws: ExcelJS.Worksheet): Interval[] {
  // Synthesized sheet: cols 1=Int#, 2=Time, 3=Bx,
  //   4=Attn EO, 5=Attn C, 6=Escape EO, 7=Escape C,
  //   8=Tangible EO, 9=Tangible C, 10=Sensory EO, 11=Sensory C, 12=Notes
  const intervals: Interval[] = [];
  ws.eachRow(row => {
    const first = row.getCell(1).value;
    if (typeof first !== 'number') return;

    intervals.push({
      id:             uuidv4(),
      intervalNumber: first,
      timeLabel:      String(row.getCell(2).value ?? '').trim(),
      behavior:       cellToTw(row.getCell(3)),
      eo: {
        attention: cellToTw(row.getCell(4)),
        escape:    cellToTw(row.getCell(6)),
        tangible:  cellToTw(row.getCell(8)),
        sensory:   cellToTw(row.getCell(10)),
      },
      consequences: {
        attention: cellToTw(row.getCell(5)),
        escape:    cellToTw(row.getCell(7)),
        tangible:  cellToTw(row.getCell(9)),
        sensory:   cellToTw(row.getCell(11)),
      },
      note: String(row.getCell(12).value ?? '').trim(),
    });
  });
  return intervals;
}

// ─── Session builder ──────────────────────────────────────────────────────────

function buildSession(
  assessmentId: string,
  type: 'single' | 'synthesized',
  condition:    ConditionType | null,
  intervals:    Interval[],
  now:          string,
  elapsedSeconds?: number,
): Session {
  return {
    id:                      uuidv4(),
    assessmentId,
    sessionType:             type,
    condition,
    conditionNote:           '',
    intervalDurationSeconds: 10,
    intervalCount:           intervals.length,
    indicatedFunctions:      [],
    intervals,
    notes:                   '',
    elapsedSeconds,
    createdAt:               now,
    updatedAt:               now,
  };
}

/**
 * Parse a "HH:MM AM – HH:MM AM" or "HH:MM–HH:MM" string (24h or 12h) and return
 * absolute seconds-from-midnight for start and end.  Returns null if the string
 * cannot be reliably parsed.
 */
function parseStartEndAbsoluteSecs(s: string): { startSec: number; endSec: number } | null {
  if (!s) return null;
  // Split on common separators: en-dash, em-dash, hyphen surrounded by spaces
  const parts = s.split(/\s*[–—]\s*|\s+-\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  function parseSingleTime(t: string): number | null {
    // Normalise: remove extra spaces around colon, collapse whitespace
    t = t.replace(/\s*:\s*/g, ':').trim();
    // Check for AM/PM
    const amPm = /([AaPp][Mm])$/.exec(t);
    const suffix = amPm ? amPm[1].toUpperCase() : null;
    const timePart = suffix ? t.slice(0, t.length - suffix.length).trim() : t;
    const colonParts = timePart.split(':').map(Number);
    if (colonParts.some(isNaN) || colonParts.length < 1) return null;
    let h = colonParts[0];
    const m = colonParts[1] ?? 0;
    const sec = colonParts[2] ?? 0;
    if (suffix) {
      if (suffix === 'PM' && h !== 12) h += 12;
      if (suffix === 'AM' && h === 12) h = 0;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) return null;
    return h * 3600 + m * 60 + sec;
  }

  const startSec = parseSingleTime(parts[0]);
  const endSec   = parseSingleTime(parts[1]);
  if (startSec === null || endSec === null) return null;
  // Handle midnight crossing: if end < start assume end is next day
  const adjustedEnd = endSec < startSec ? endSec + 86400 : endSec;
  return { startSec, endSec: adjustedEnd };
}

/**
 * Try to derive elapsed seconds from the Time column of a worksheet.
 * Accepts time strings like "0:10", "0:10:00", "10:05", "1:05:30".
 * Returns undefined if times cannot be parsed or there are fewer than 2 parseable values.
 */
function deriveElapsedFromTimeColumn(intervals: Interval[]): number | undefined {
  function parseTimeLabel(s: string): number | null {
    // Try HH:MM:SS or MM:SS
    const parts = s.trim().split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
    return null;
  }

  const times = intervals
    .map(iv => parseTimeLabel(iv.timeLabel))
    .filter((t): t is number => t !== null);

  if (times.length < 2) return undefined;
  const span = Math.max(...times) - Math.min(...times);
  return span > 0 ? span : undefined;
}
