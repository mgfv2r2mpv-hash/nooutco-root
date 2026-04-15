/**
 * excelExport — produces a functional .xlsx file mirroring the CPR template.
 *
 * Sheet structure:
 *   Data - Attention / Escape / Tangible / Sensory  (one per separate session)
 *   Data - Synthesized (one sheet per synthesized run, suffixed with run number if >1)
 *   Conditional Probability  (LAG-1 toggles + COUNTIFS formulas + CV/ACV)
 *
 * Lag-1 formulas use hidden helper columns so COUNTIFS remain readable.
 *
 * FUTURE API NOTE: exportAssessmentToExcel receives a plain Assessment object.
 * When connected to a backend, fetch the assessment first then pass it here.
 */
import ExcelJS from 'exceljs';
import type { Assessment, Session, ConditionType, Interval, ContingencyTable } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';
import { analyzeAssessment } from './conditionalProbability';
import { sessionProgress } from './assessmentHelpers';
import { drawBarChartToCanvas, canvasToPngBase64 } from './chartCanvas';

function fmtSecExcel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Public entry points ──────────────────────────────────────────────────────

export type ExportScope = 'both' | 'separate' | 'synthesized';

/** Download a blank CPR template with empty data sheets for all 4 conditions + synthesized. */
export async function exportBlankTemplate(): Promise<void> {
  const blank: Assessment = {
    id: 'template',
    _schemaVersion: 2,
    clientName:               'Client Name',
    observer:                 'Observer',
    setting:                  'Setting',
    date:                     new Date().toISOString().slice(0, 10),
    startEndTime:             '9:00 AM – 9:30 AM',
    targetBehaviorName:       'Target Behavior Name',
    targetBehaviorDefinition: 'Operational definition of the target behavior',
    separateSessions:         Object.fromEntries(
      ALL_CONDITIONS.map(cond => [cond, {
        id: `template-${cond}`,
        assessmentId: 'template',
        sessionType: 'single' as const,
        condition: cond,
        conditionNote: '',
        intervalDurationSeconds: 10,
        intervalCount: 60,
        indicatedFunctions: [],
        intervals: Array.from({ length: 60 }, (_, i) => ({
          id: `${cond}-${i}`,
          intervalNumber: i + 1,
          timeLabel: '',
          behavior: 'could_not_score' as const,
          eo: { [cond]: 'could_not_score' as const },
          consequences: {
            attention: 'could_not_score' as const,
            escape:    'could_not_score' as const,
            tangible:  'could_not_score' as const,
            sensory:   'could_not_score' as const,
          },
          note: '',
        })),
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }])
    ) as Assessment['separateSessions'],
    synthesizedSessions: [],
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'SDA CPR Tool';
  wb.modified = new Date();

  for (const cond of ALL_CONDITIONS) {
    const session = blank.separateSessions[cond]!;
    addDataSheet(wb, blank, session, cond, null);
  }
  addConditionalProbabilitySheet(wb, blank);
  addGraphInstructionsSheet(wb, blank);

  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = 'CPR_Template_Blank.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportAssessmentToExcel(assessment: Assessment, scope: ExportScope = 'both'): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'SDA CPR Tool';
  wb.modified = new Date();

  // Separate condition sheets
  if (scope !== 'synthesized') {
    for (const cond of ALL_CONDITIONS) {
      const session = assessment.separateSessions[cond];
      if (session) addDataSheet(wb, assessment, session, cond, null);
    }
  }

  // Synthesized sheets
  if (scope !== 'separate') {
    assessment.synthesizedSessions.forEach((session, i) => {
      addSynthesizedSheet(wb, assessment, session, i);
    });
  }

  // Conditional Probability sheet
  addConditionalProbabilitySheet(wb, assessment);

  // Graph helper sheets (instructions + PNG-embedded charts)
  addGraphInstructionsSheet(wb, assessment);
  const fullAnalysis = analyzeAssessment(assessment, true, true);
  const scopedAnalysis = {
    ...fullAnalysis,
    separateConditionAnalyses: scope === 'synthesized' ? [] : fullAnalysis.separateConditionAnalyses,
    synthesizedAnalyses:       scope === 'separate'    ? [] : fullAnalysis.synthesizedAnalyses,
  };
  addGraphsSheet(wb, assessment, scopedAnalysis);

  // Trigger browser download
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `CPR_${assessment.clientName.replace(/\s+/g, '_')}_${assessment.date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Data sheet (single condition) ───────────────────────────────────────────

function addDataSheet(
  wb:         ExcelJS.Workbook,
  assessment: Assessment,
  session:    Session,
  condition:  ConditionType,
  _runIndex:  number | null,
): ExcelJS.Worksheet {
  const meta = CONDITION_META[condition];
  const ws   = wb.addWorksheet(`Data - ${meta.label}`);

  writeSheetHeader(ws, assessment, `CPR — ${meta.label} Condition`);

  // Session summary row
  const { total: sTotal, scored: sScored, behaviorCount: sBx, csCount: sCS } = sessionProgress(session);
  const sesInfoParts = [`Intervals: ${sTotal}`, `Scored: ${sScored}`, `CS: ${sCS}`, `Bx count: ${sBx}`];
  if (session.elapsedSeconds) sesInfoParts.push(`Observed time: ${fmtSecExcel(session.elapsedSeconds)}`);
  const sesInfoRow = ws.addRow([sesInfoParts.join('  |  ')]);
  sesInfoRow.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  ws.mergeCells(`A${sesInfoRow.number}:F${sesInfoRow.number}`);

  // Instructions
  ws.addRow([]);
  ws.addRow(['10-second partial interval recording.']);
  ws.addRow([]);
  ws.addRow(['For each interval, record Y/N for:']);
  ws.addRow(['(1) Behavior occurred,']);
  ws.addRow(['(2) Antecedent/EO/SD was present,']);
  ws.addRow(['(3) Consequence was delivered.']);
  ws.addRow([]);
  ws.addRow([`Antecedent = EO/SD present in current interval.`]);
  ws.addRow(['Consequence = delivered in current interval.']);
  ws.addRow([]);

  // Column headers — row 14
  const headerRow = ws.addRow(['Int #', 'Time\n(opt)', 'Bx Occurred\n(Y/N)',
    `${meta.eoLabel}\n(EO Y/N)`, `${meta.cLabel}\n(C+ Y/N)`, 'Notes']);
  styleHeaderRow(headerRow, condition);
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 32;

  const DATA_START_ROW = ws.rowCount + 1;

  // Interval data rows
  for (const iv of session.intervals) {
    const row = ws.addRow([
      iv.intervalNumber,
      iv.timeLabel || null,
      twToCell(iv.behavior),
      twToCell(iv.eo[condition] ?? 'could_not_score'),
      twToCell(iv.consequences[condition]),
      iv.note || null,
    ]);
    applyIntervalRowStyle(row, iv);
    addYNCValidation(ws, row.number, [3, 4, 5]);
  }

  // Store metadata for the Conditional Probability sheet to reference
  (ws as WorksheetWithMeta)._dataStartRow = DATA_START_ROW;
  (ws as WorksheetWithMeta)._dataEndRow   = ws.rowCount;
  (ws as WorksheetWithMeta)._condition    = condition;

  return ws;
}

// ─── Synthesized data sheet ───────────────────────────────────────────────────

function addSynthesizedSheet(
  wb:         ExcelJS.Workbook,
  assessment: Assessment,
  session:    Session,
  runIndex:   number,
): ExcelJS.Worksheet {
  const suffix = assessment.synthesizedSessions.length > 1 ? ` ${runIndex + 1}` : '';
  const ws     = wb.addWorksheet(`Data - Synthesized${suffix}`);

  const synthConds = session.synthesizedConditions ?? ALL_CONDITIONS;
  const condNames  = synthConds.map(c => CONDITION_META[c].label).join(' + ');
  writeSheetHeader(ws, assessment, `CPR — Synthesized Condition${suffix ? ` (Run ${runIndex + 1})` : ''}`, 12);
  const { total: sTotal, scored: sScored, behaviorCount: sBx, csCount: sCS } = sessionProgress(session);
  const sesInfoParts = [`Intervals: ${sTotal}`, `Scored: ${sScored}`, `CS: ${sCS}`, `Bx count: ${sBx}`];
  if (session.elapsedSeconds) sesInfoParts.push(`Observed time: ${fmtSecExcel(session.elapsedSeconds)}`);
  const sesInfoRow2 = ws.addRow([sesInfoParts.join('  |  ')]);
  sesInfoRow2.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  ws.mergeCells(`A${sesInfoRow2.number}:L${sesInfoRow2.number}`);
  const synthInfoRow = ws.addRow([`EO Conditions: ${condNames}`]);
  synthInfoRow.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  ws.mergeCells(`A${synthInfoRow.number}:L${synthInfoRow.number}`);
  ws.addRow([]);

  // Multi-condition header — condition-coloured pairs
  const topHeader = ws.addRow([
    '', '', '',
    'ATTENTION', '', 'ESCAPE', '', 'TANGIBLE', '', 'SENSORY', '',
    '',
  ]);
  // Style first 3 cells (Int#, Time, Bx) and Notes cell in neutral dark gray
  const neutralFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B5563' } };
  [1, 2, 3, 12].forEach(c => {
    topHeader.getCell(c).fill = neutralFill;
  });
  // Style each condition pair with its colour and merge
  const condPairs: [ConditionType, number][] = [
    ['attention', 4], ['escape', 6], ['tangible', 8], ['sensory', 10],
  ];
  for (const [cond, startCol] of condPairs) {
    const colLetter1 = String.fromCharCode(64 + startCol);
    const colLetter2 = String.fromCharCode(64 + startCol + 1);
    const rowN = topHeader.number;
    topHeader.getCell(startCol).fill = { type: 'pattern', pattern: 'solid', fgColor: condArgb(cond) };
    topHeader.getCell(startCol + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: condArgb(cond) };
    ws.mergeCells(`${colLetter1}${rowN}:${colLetter2}${rowN}`);
  }
  topHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  topHeader.alignment = { horizontal: 'center', vertical: 'middle' };
  topHeader.height = 20;

  const subHeader = ws.addRow([
    'Int #', 'Time\n(opt)', 'Bx Occurred\n(Y/N)',
    `${CONDITION_META.attention.eoLabel}\n(EO Y/N)`, `${CONDITION_META.attention.cLabel}\n(C+ Y/N)`,
    `${CONDITION_META.escape.eoLabel}\n(EO Y/N)`,   `${CONDITION_META.escape.cLabel}\n(C+ Y/N)`,
    `${CONDITION_META.tangible.eoLabel}\n(EO Y/N)`,  `${CONDITION_META.tangible.cLabel}\n(C+ Y/N)`,
    `${CONDITION_META.sensory.eoLabel}\n(EO Y/N)`,   `${CONDITION_META.sensory.cLabel}\n(C+ Y/N)`,
    'Notes',
  ]);
  // Apply lighter tint to each condition pair in the sub-header
  const lightArgb: Record<ConditionType, string> = {
    attention: 'FFD1DCF5', escape: 'FFD1EAD8', tangible: 'FFF5E0D0', sensory: 'FFE2D5F5',
  };
  for (const [cond, startCol] of condPairs) {
    const lightFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightArgb[cond] } };
    subHeader.getCell(startCol).fill = lightFill;
    subHeader.getCell(startCol + 1).fill = lightFill;
  }
  subHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  subHeader.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  subHeader.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  subHeader.font = { bold: true };
  subHeader.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  subHeader.height = 36;

  // Column widths
  [8, 10, 14, 16, 16, 16, 16, 14, 14, 18, 18, 32].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const DATA_START_ROW = ws.rowCount + 1;

  for (const iv of session.intervals) {
    const row = ws.addRow([
      iv.intervalNumber, iv.timeLabel || null,
      twToCell(iv.behavior),
      twToCell(iv.eo.attention ?? 'could_not_score'), twToCell(iv.consequences.attention),
      twToCell(iv.eo.escape   ?? 'could_not_score'), twToCell(iv.consequences.escape),
      twToCell(iv.eo.tangible ?? 'could_not_score'), twToCell(iv.consequences.tangible),
      twToCell(iv.eo.sensory  ?? 'could_not_score'), twToCell(iv.consequences.sensory),
      iv.note || null,
    ]);
    applyIntervalRowStyle(row, iv);
    addYNCValidation(ws, row.number, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  }

  (ws as WorksheetWithMeta)._dataStartRow = DATA_START_ROW;
  (ws as WorksheetWithMeta)._dataEndRow   = ws.rowCount;
  (ws as WorksheetWithMeta)._runIndex     = runIndex;

  return ws;
}

// ─── Conditional Probability sheet ───────────────────────────────────────────

function addConditionalProbabilitySheet(wb: ExcelJS.Workbook, assessment: Assessment): void {
  const ws = wb.addWorksheet('Conditional Probability');

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 4;
  ws.getColumn(6).width = 36;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 16;
  ws.getColumn(9).width = 14;

  // Compute analysis with both lag-1 flags ON (default, matching app UI default)
  const analysis = analyzeAssessment(assessment, true, true);

  // Title
  const titleRow = ws.addRow(['CONDITIONAL PROBABILITY CALCULATOR']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } };
  ws.mergeCells(`A1:I1`);
  titleRow.alignment = { horizontal: 'center' };

  ws.addRow([]);

  // LAG-1 settings (informational — values are pre-computed with both lag-1 flags ON)
  const lagHeaderRow = ws.addRow(['LAG-1 SETTINGS (applied during export)', '', '', '',
    '', 'Both antecedent lag-1 and consequence lag-1 are applied. Adjust in the app to re-export.']);
  lagHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  lagHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  ws.mergeCells(`A${lagHeaderRow.number}:D${lagHeaderRow.number}`);
  ws.mergeCells(`F${lagHeaderRow.number}:I${lagHeaderRow.number}`);

  const antInfoRow = ws.addRow([
    'Antecedent lag-1\n(current + preceding interval)', 'Y (applied)', '', '',
    '', 'EO in interval n OR n−1 credited to behavior in n',
  ]);
  antInfoRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  antInfoRow.getCell(2).font = { bold: true };
  antInfoRow.getCell(2).alignment = { horizontal: 'center' };

  const consInfoRow = ws.addRow([
    'Consequence lag-1\n(current + following interval)', 'Y (applied)', '', '',
    '', 'Consequence in interval n OR n+1 credited to behavior in n',
  ]);
  consInfoRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  consInfoRow.getCell(2).font = { bold: true };
  consInfoRow.getCell(2).alignment = { horizontal: 'center' };

  ws.addRow([]);

  // Per-condition analysis blocks — separate sessions
  for (const condAnalysis of analysis.separateConditionAnalyses) {
    addConditionBlock(ws, condAnalysis.condition, condAnalysis.consequenceTable, condAnalysis.antecedentTable);
    ws.addRow([]);
  }

  // Per-condition analysis blocks — synthesized runs
  analysis.synthesizedAnalyses.forEach((runAnalyses, runIdx) => {
    const runLabel = analysis.synthesizedAnalyses.length > 1 ? `SYNTHESIZED RUN ${runIdx + 1}` : 'SYNTHESIZED';
    const runHdr = ws.addRow([runLabel]);
    runHdr.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    runHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    ws.mergeCells(`A${runHdr.number}:I${runHdr.number}`);
    ws.addRow([]);
    for (const condAnalysis of runAnalyses) {
      // Only show conditions that have any data
      const hasData = condAnalysis.consequenceTable.grandTotal > 0 || condAnalysis.antecedentTable.grandTotal > 0;
      if (!hasData) continue;
      addConditionBlock(ws, condAnalysis.condition, condAnalysis.consequenceTable, condAnalysis.antecedentTable);
      ws.addRow([]);
    }
  });

  // ── Behavior Frequency & Rate summary table ────────────────────────────────
  const rateRows: Array<{ label: string; total: number; scored: number; bx: number; cs: number; sec: number }> = [];
  for (const cond of ALL_CONDITIONS) {
    const s = assessment.separateSessions[cond];
    if (!s) continue;
    const { total, scored, behaviorCount, csCount } = sessionProgress(s);
    rateRows.push({ label: CONDITION_META[cond].label, total, scored, bx: behaviorCount, cs: csCount, sec: s.elapsedSeconds ?? 0 });
  }
  assessment.synthesizedSessions.forEach((s, i) => {
    const { total, scored, behaviorCount, csCount } = sessionProgress(s);
    rateRows.push({ label: `Synthesized Run ${i + 1}`, total, scored, bx: behaviorCount, cs: csCount, sec: s.elapsedSeconds ?? 0 });
  });

  if (rateRows.length > 0) {
    ws.addRow([]);
    const rHdr = ws.addRow(['BEHAVIOR FREQUENCY & RATE SUMMARY']);
    rHdr.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    rHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws.mergeCells(`A${rHdr.number}:I${rHdr.number}`);

    const hasTimes = rateRows.some(r => r.sec > 0);
    const rColHdr = ws.addRow(['Condition', 'Intervals', 'Scored', 'CS', 'Bx Count', 'Bx Rate', ...(hasTimes ? ['Obs. Time', 'Bx/min'] : [])]);
    rColHdr.font = { bold: true };
    rColHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

    let totTotal = 0, totScored = 0, totBx = 0, totCS = 0, totSec = 0;
    for (const r of rateRows) {
      totTotal += r.total; totScored += r.scored; totBx += r.bx; totCS += r.cs; totSec += r.sec;
      const bxRate = r.scored > 0 ? r.bx / r.scored : null;
      const bxMin  = r.sec > 0 ? r.bx / (r.sec / 60) : null;
      const row = ws.addRow([
        r.label, r.total, r.scored, r.cs, r.bx,
        bxRate !== null ? bxRate : '—',
        ...(hasTimes ? [r.sec > 0 ? fmtSecExcel(r.sec) : '—', bxMin !== null ? bxMin.toFixed(2) : '—'] : []),
      ]);
      if (bxRate !== null) row.getCell(6).numFmt = '0.0%';
    }
    // Total row
    const totBxRate = totScored > 0 ? totBx / totScored : null;
    const totBxMin  = totSec > 0 ? totBx / (totSec / 60) : null;
    const totRow = ws.addRow([
      'Total', totTotal, totScored, totCS, totBx,
      totBxRate !== null ? totBxRate : '—',
      ...(hasTimes ? [totSec > 0 ? fmtSecExcel(totSec) : '—', totBxMin !== null ? totBxMin.toFixed(2) : '—'] : []),
    ]);
    totRow.font = { bold: true };
    totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
    if (totBxRate !== null) totRow.getCell(6).numFmt = '0.0%';
  }
}

// ─── Per-condition analysis block (pre-computed values — no Excel formulas) ───

function addConditionBlock(
  ws:         ExcelJS.Worksheet,
  condition:  ConditionType,
  ct:         ContingencyTable,  // consequence table
  at:         ContingencyTable,  // antecedent table
): void {
  const meta = CONDITION_META[condition];

  const pct = (v: number | null) => v !== null ? v : null; // null → blank cell

  // Section header
  const sectionRow = ws.addRow([`▶ ${meta.label.toUpperCase()}`]);
  sectionRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  sectionRow.fill = { type: 'pattern', pattern: 'solid', fgColor: condArgb(condition) };
  ws.mergeCells(`A${sectionRow.number}:I${sectionRow.number}`);

  // Sub-headers (cols A–D = Consequence, F–I = Antecedent)
  const subRow = ws.addRow([
    `CONSEQUENCE ANALYSIS — P(Bx | C±)`, '', '', '',
    '', `ANTECEDENT ANALYSIS — P(Bx | A±)`, '', '', '',
  ]);
  subRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  subRow.fill = { type: 'pattern', pattern: 'solid', fgColor: condArgb(condition) };
  ws.mergeCells(`A${subRow.number}:D${subRow.number}`);
  ws.mergeCells(`F${subRow.number}:I${subRow.number}`);

  // Light tint of the condition color for the column header row
  const lightArgbMap: Record<ConditionType, string> = {
    attention: 'FFD1DCF5', escape: 'FFD1EAD8', tangible: 'FFF5E0D0', sensory: 'FFE2D5F5',
  };
  const colRowFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightArgbMap[condition] } };

  const colRow = ws.addRow([
    '', 'C+ (Cons. Delivered)', 'C− (Cons. Absent)', 'Row Total',
    '', '', 'A+ (EO Present)', 'A− (EO Absent)', 'Row Total',
  ]);
  colRow.font = { bold: true };
  [1,2,3,4,6,7,8,9].forEach(c => { colRow.getCell(c).fill = colRowFill; });

  // Count rows (direct values)
  ws.addRow(['Bx Occurred (Bx+)',    ct.bxPlusCPlus,  ct.bxPlusCMinus,  ct.rowTotalBxPlus,
    '', 'Bx Occurred (Bx+)',    at.bxPlusCPlus,  at.bxPlusCMinus,  at.rowTotalBxPlus]);
  ws.addRow(['Bx Did NOT Occur (Bx−)', ct.bxMinusCPlus, ct.bxMinusCMinus, ct.rowTotalBxMinus,
    '', 'Bx Did NOT Occur (Bx−)', at.bxMinusCPlus, at.bxMinusCMinus, at.rowTotalBxMinus]);
  ws.addRow(['Column Total', ct.colTotalCPlus, ct.colTotalCMinus, ct.grandTotal,
    '', 'Column Total', at.colTotalCPlus, at.colTotalCMinus, at.grandTotal]);

  // Probability rows
  const pBxCp  = pct(ct.pBxGivenCPlus);
  const pBxCm  = pct(ct.pBxGivenCMinus);
  const cv     = pct(ct.cv);
  const pBxAp  = pct(at.pBxGivenCPlus);
  const pBxAm  = pct(at.pBxGivenCMinus);
  const acv    = pct(at.cv);

  const condLightFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightArgbMap[condition] } };

  const pRow1 = ws.addRow(['P(Bx | C+)', pBxCp, 'Probability of Bx given consequence delivered', '', '',
    'P(Bx | A+)', pBxAp, 'Probability of Bx given EO present', '']);
  if (pBxCp !== null) pRow1.getCell(2).numFmt = '0.0%';
  if (pBxAp !== null) pRow1.getCell(7).numFmt = '0.0%';
  pRow1.getCell(3).alignment = { wrapText: true };
  pRow1.getCell(8).alignment = { wrapText: true };

  const pRow2 = ws.addRow(['P(Bx | C−)', '', pBxCm, 'Probability of Bx given consequence absent', '',
    'P(Bx | A−)', '', pBxAm, 'Probability of Bx given EO absent']);
  if (pBxCm !== null) pRow2.getCell(3).numFmt = '0.0%';
  if (pBxAm !== null) pRow2.getCell(8).numFmt = '0.0%';
  pRow2.getCell(4).alignment = { wrapText: true };
  pRow2.getCell(9).alignment = { wrapText: true };

  const cvRow = ws.addRow(['CV', cv, '', 'P(Bx|C+) − P(Bx|C−)', '',
    'ACV', acv, '', 'P(Bx|A+) − P(Bx|A−)']);
  if (cv  !== null) cvRow.getCell(2).numFmt = '0.0%';
  if (acv !== null) cvRow.getCell(7).numFmt = '0.0%';
  cvRow.font = { bold: true };
  [1,2,3,4,6,7,8,9].forEach(c => { cvRow.getCell(c).fill = condLightFill; });
}

// ─── Instructions sheet ───────────────────────────────────────────────────────

function addGraphInstructionsSheet(wb: ExcelJS.Workbook, _assessment: Assessment): void {
  const ws = wb.addWorksheet('Instructions');

  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 80;

  // Sheet title
  const titleRow = ws.addRow(['', 'SDA CPR — Reference & Instructions']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  titleRow.height = 26;
  titleRow.alignment = { vertical: 'middle' };
  ws.addRow([]);

  // ── SECTION 1: Graphing ──────────────────────────────────────────────────────
  addInstrSectionHead(ws, '1  GRAPHING IN EXCEL');
  addInstrBody(ws, 'The "Graphs" sheet contains pre-rendered chart images. The steps below produce interactive Excel charts if preferred.');
  ws.addRow([]);

  addInstrHeading(ws, 'STEP 1 — Select data');
  addInstrBody(ws, 'Go to the "Conditional Probability" sheet. Find the analysis table for the condition set you want to chart.');
  addInstrBullet(ws, 'Consequence chart: use the P(Bx|C+) and P(Bx|C−) values.');
  addInstrBullet(ws, 'Antecedent chart: use the P(Bx|A+) and P(Bx|A−) values.');
  ws.addRow([]);

  addInstrHeading(ws, 'STEP 2 — Insert a clustered column chart');
  addInstrBullet(ws, 'Insert → Charts → Column → Clustered Column (or Bar for horizontal).');
  addInstrBullet(ws, 'One cluster per condition; two bars per cluster (+ and −).');
  ws.addRow([]);

  addInstrHeading(ws, 'STEP 3 — Format');
  addInstrBullet(ws, 'Y-axis: set minimum 0, maximum 1 (displays as 0%–100%).');
  addInstrBullet(ws, 'Add data labels → format as percentage.');
  addInstrBullet(ws, 'Condition colors: Attention = Blue, Escape = Green, Tangible = Orange, Sensory = Purple.');
  ws.addRow([]);
  addInstrSeparator(ws);

  // ── SECTION 2: About the SDA CPR Tool ────────────────────────────────────────
  addInstrSectionHead(ws, '2  ABOUT THIS TOOL');
  addInstrBody(ws,
    'The SDA CPR Tool supports Systematic Descriptive Assessment (SDA) — an observational procedure that quantifies ' +
    'co-occurrence between behavior and environmental events without experimentally manipulating consequences.');
  ws.addRow([]);
  addInstrBody(ws, 'For each interval the observer records:');
  addInstrBullet(ws, 'Bx — did the target behavior occur (partial interval)?');
  addInstrBullet(ws, 'EO — was the relevant motivating operation present (Establishing Operation / antecedent)?');
  addInstrBullet(ws, 'C+ — was the relevant consequence delivered naturally in this interval?');
  addInstrBody(ws, 'All four functions are scored simultaneously in every interval, eliminating observer-selection bias.');
  ws.addRow([]);

  addInstrHeading(ws, 'FOUR CONDITIONS');
  addInstrBullet(ws, 'Attention — EO: attention withheld/absent;  C+: attention delivered.');
  addInstrBullet(ws, 'Escape — EO: demands/tasks present;  C+: escape/removal granted.');
  addInstrBullet(ws, 'Tangible — EO: preferred item unavailable;  C+: item provided.');
  addInstrBullet(ws, 'Sensory — EO: unoccupied / low stimulation;  C+: behavior persists uninterrupted.');
  ws.addRow([]);

  addInstrHeading(ws, 'SYNTHESIZED CONDITIONS');
  addInstrBody(ws,
    'A synthesized session presents multiple EOs simultaneously, mirroring natural contexts where several ' +
    'motivating operations co-occur. EOs and consequences are recorded for all selected conditions in every interval.');
  ws.addRow([]);
  addInstrSeparator(ws);

  // ── SECTION 3: Data Collection Guidance ──────────────────────────────────────
  addInstrSectionHead(ws, '3  DATA COLLECTION GUIDANCE');

  addInstrHeading(ws, 'INTERVAL LENGTH');
  addInstrBullet(ws, '10-second intervals: standard for clinic settings (recommended starting point).');
  addInstrBullet(ws, '15-second intervals: common for classroom or community contexts.');
  addInstrBody(ws, 'Longer intervals capture more co-occurrences per session but introduce more temporal noise around event boundaries.');
  ws.addRow([]);

  addInstrHeading(ws, 'EO DENSITY');
  addInstrBody(ws, 'Aim for at least 20% EO-absent intervals per condition when possible.');
  addInstrBody(ws,
    'If nearly all intervals have the EO present, P(Bx|A−) is based on a very small denominator and the ACV estimate is unreliable. ' +
    'Check raw cell counts before interpreting.');
  ws.addRow([]);

  addInstrHeading(ws, 'LAG-1 CORRECTION');
  addInstrBullet(ws, 'Antecedent lag-1: EO present in interval n−1 is credited to interval n. Reduces false negatives when EO immediately precedes behavior.');
  addInstrBullet(ws, 'Consequence lag-1: consequence in interval n+1 is credited to interval n. Accounts for natural delay in consequence delivery.');
  addInstrBody(ws, 'Both are ON by default. Consider turning off for intervals longer than 15 s, where adjacent-interval credit covers too wide a time window.');
  ws.addRow([]);

  addInstrHeading(ws, 'COULD NOT SCORE (C)');
  addInstrBody(ws, 'Intervals marked C for behavior or a given condition are excluded from that condition\'s contingency table. They do not count toward any cell or denominator.');
  ws.addRow([]);
  addInstrSeparator(ws);

  // ── SECTION 4: Reading the Results ───────────────────────────────────────────
  addInstrSectionHead(ws, '4  READING THE RESULTS');
  addInstrBody(ws,
    'CV (Contingency Value) = P(Bx|C+) − P(Bx|C−). ' +
    'ACV (Antecedent CV) = P(Bx|A+) − P(Bx|A−). Both range from −1 to +1.');
  ws.addRow([]);

  addInstrHeading(ws, 'WHAT THE SIGN INDICATES');
  addInstrBullet(ws, 'Positive value → behavior was more frequent when the condition was present than when it was absent.');
  addInstrBullet(ws, 'Near zero → behavior occurred at similar rates regardless of the condition.');
  addInstrBullet(ws, 'Negative value → behavior was less frequent when the condition was present.');
  ws.addRow([]);

  addInstrHeading(ws, 'WHAT THE SIZE SUGGESTS');
  addInstrBody(ws, 'A larger absolute value reflects a stronger pattern in the data. There are no universal cut-offs; context matters.');
  addInstrBullet(ws, 'Small differences (e.g., 5–10%) may be meaningful with consistent raw counts or may reflect sampling variability with small denominators.');
  addInstrBullet(ws, 'Large differences (e.g., 30%+) with adequate denominator sizes generally warrant attention.');
  addInstrBody(ws, 'Always read CV/ACV alongside the raw cell counts. A 50% CV based on 2 intervals carries far less weight than one based on 40.');
  ws.addRow([]);

  addInstrHeading(ws, 'BASE RATE EFFECTS');
  addInstrBody(ws,
    'Very high or very low behavior base rates compress the range of possible differences. ' +
    'If Bx occurs in 90% of intervals overall, even a strong function may produce a modest-looking CV. ' +
    'Review the raw counts and overall Bx rate in the Conditional Probability sheet alongside the probabilities.');
  ws.addRow([]);

  addInstrHeading(ws, 'THESE ARE CORRELATIONAL MEASURES');
  addInstrBody(ws,
    'SDA does not manipulate antecedents or consequences. A high CV or ACV shows a pattern of co-occurrence, ' +
    'not a controlled demonstration of function. Results inform hypothesis generation and treatment design; ' +
    'they do not replace clinical judgment or, where indicated, experimental functional analysis.');
  ws.addRow([]);
}

function addInstrSectionHead(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow(['', text]);
  row.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
  row.height = 20;
  row.alignment = { vertical: 'middle' };
  ws.addRow([]);
}

function addInstrSeparator(ws: ExcelJS.Worksheet): void {
  const row = ws.addRow([]);
  row.getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  row.height = 8;
  ws.addRow([]);
}

function addInstrHeading(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow(['', text]);
  row.font = { bold: true, size: 10, color: { argb: 'FF1E3A5F' } };
  row.height = 17;
}

function addInstrBody(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow(['', text]);
  row.font = { size: 10 };
  row.getCell(2).alignment = { wrapText: true };
  row.height = 15;
}

function addInstrBullet(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow(['', `  •  ${text}`]);
  row.font = { size: 10, color: { argb: 'FF374151' } };
  row.getCell(2).alignment = { wrapText: true };
  row.height = 15;
}

// ─── Graphs sheet (embedded PNG charts, 2×2 layout) ──────────────────────────

function addGraphsSheet(
  wb:         ExcelJS.Workbook,
  assessment: Assessment,
  analysis:   import('../types').AssessmentAnalysis,
): void {
  type CA = import('../types').ConditionAnalysis;

  const ws = wb.addWorksheet('Graphs');

  // Two-column layout: left = consequence, right = antecedent
  ws.getColumn(1).width = 2;   // col A: narrow margin
  ws.getColumn(2).width = 65;  // col B: left chart
  ws.getColumn(3).width = 2;   // col C: gap
  ws.getColumn(4).width = 65;  // col D: right chart

  const hdrTitle = ws.addRow(['', `CPR Graphs — ${assessment.clientName}  |  ${assessment.date}`]);
  hdrTitle.font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
  hdrTitle.height = 22;
  ws.addRow(['', 'Charts are embedded as images. See "Instructions" sheet for graphing steps and interpretation guidance.'])
    .font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };
  ws.addRow([]);

  const CHART_W  = 480;
  const CHART_H  = 280;
  const ROW_H    = 20;
  const ROWS_PER = Math.ceil(CHART_H / ROW_H) + 1;

  /** Embed a consequence+antecedent pair side by side for one set of analyses. */
  function embedPair(groupLabel: string, analyses: CA[]): void {
    if (analyses.length === 0) return;

    // Group header row
    const grpRow = ws.addRow(['', `${groupLabel}: Consequence`, '', `${groupLabel}: Antecedent`]);
    grpRow.getCell(2).font = { bold: true, size: 11, color: { argb: 'FF1E3A5F' } };
    grpRow.getCell(4).font = { bold: true, size: 11, color: { argb: 'FF1E3A5F' } };
    grpRow.height = 18;

    const startRow = ws.rowCount; // 0-indexed anchor row

    // Left chart: Consequence
    const consCanvas = drawBarChartToCanvas({
      title: `${groupLabel}: Consequence`, analyses,
      getPlus:  (ca: CA) => ca.consequenceTable.pBxGivenCPlus,
      getMinus: (ca: CA) => ca.consequenceTable.pBxGivenCMinus,
      plusLabel: 'P(Bx|C+)', minusLabel: 'P(Bx|C−)',
      width: CHART_W, height: CHART_H,
    });
    ws.addImage(wb.addImage({ base64: canvasToPngBase64(consCanvas), extension: 'png' }), {
      tl: { col: 1, row: startRow } as ExcelJS.Anchor,
      ext: { width: CHART_W, height: CHART_H },
    });

    // Right chart: Antecedent
    const antCanvas = drawBarChartToCanvas({
      title: `${groupLabel}: Antecedent`, analyses,
      getPlus:  (ca: CA) => ca.antecedentTable.pBxGivenCPlus,
      getMinus: (ca: CA) => ca.antecedentTable.pBxGivenCMinus,
      plusLabel: 'P(Bx|A+)', minusLabel: 'P(Bx|A−)',
      width: CHART_W, height: CHART_H,
    });
    ws.addImage(wb.addImage({ base64: canvasToPngBase64(antCanvas), extension: 'png' }), {
      tl: { col: 3, row: startRow } as ExcelJS.Anchor,
      ext: { width: CHART_W, height: CHART_H },
    });

    // Reserve rows for the images then add a spacer
    for (let r = 0; r < ROWS_PER; r++) ws.addRow([]).height = ROW_H;
    ws.addRow([]);
  }

  // ── Separate conditions ──
  if (analysis.separateConditionAnalyses.length > 0) {
    embedPair('Separate Conditions', analysis.separateConditionAnalyses);
  }

  // ── Synthesized runs ──
  analysis.synthesizedAnalyses.forEach((runAnalyses, i) => {
    const numLabel = analysis.synthesizedAnalyses.length > 1 ? ` Run ${i + 1}` : '';
    embedPair(`Synthesized${numLabel}`, runAnalyses);
  });

  if (analysis.separateConditionAnalyses.length === 0 && analysis.synthesizedAnalyses.length === 0) {
    ws.addRow(['', 'No session data available yet. Export again after entering data.'])
      .font = { italic: true, color: { argb: 'FF9CA3AF' } };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeSheetHeader(
  ws: ExcelJS.Worksheet,
  assessment: Assessment,
  title: string,
  colCount = 6,
): void {
  const lastCol = String.fromCharCode(64 + colCount); // 6→F, 12→L

  // Title row — dark navy fill, white bold text
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 22;
  ws.mergeCells(`A1:${lastCol}1`);

  // Split combined startEndTime
  const rawTime   = assessment.startEndTime || '';
  const sepMatch  = rawTime.match(/^(.*?)\s*[–—\-]\s*(.*)$/);
  const startTime = sepMatch ? sepMatch[1].trim() : rawTime;
  const endTime   = sepMatch ? sepMatch[2].trim() : '';

  const metaItems: [string, string][] = [
    ['Client:', assessment.clientName],
    ['Observer:', assessment.observer || ''],
    ['Setting:', assessment.setting || ''],
    ['Target Behavior:', assessment.targetBehaviorName || ''],
    ['Definition:', assessment.targetBehaviorDefinition || ''],
    ['Date:', assessment.date],
    ['Start Time:', startTime],
    ['End Time:', endTime],
  ];

  const labelFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF5' } };

  for (let i = 0; i < metaItems.length; i++) {
    const [label, value] = metaItems[i];
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1E3A5F' } };
    row.getCell(1).fill = labelFill;
    row.getCell(2).font = { size: 10 };
    row.getCell(2).alignment = { wrapText: true };
    // Bottom border on the last metadata row
    if (i === metaItems.length - 1) {
      row.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFBFCBE0' } } };
      row.getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FFBFCBE0' } } };
    }
  }

  ws.addRow([]);
}

function styleHeaderRow(row: ExcelJS.Row, condition: ConditionType): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: condArgb(condition) };
  row.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  row.height = 30;
}


function applyIntervalRowStyle(row: ExcelJS.Row, iv: Interval): void {
  if (iv.behavior === 'could_not_score') {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  }
}

function addYNCValidation(ws: ExcelJS.Worksheet, rowNum: number, colNums: number[]): void {
  for (const col of colNums) {
    ws.getCell(rowNum, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Y,N,C"'],
      showErrorMessage: true,
      errorTitle: 'Invalid entry',
      error: 'Please enter Y, N, or C',
    };
  }
}

function twToCell(v: import('../types').ThreeWay): string | null {
  if (v === 'yes')            return 'Y';
  if (v === 'no')             return 'N';
  if (v === 'could_not_score') return 'C';
  return null;
}

function condArgb(condition: ConditionType): { argb: string } {
  return {
    attention: { argb: 'FF1D4ED8' }, // blue-700
    escape:    { argb: 'FF15803D' }, // green-700
    tangible:  { argb: 'FFC2410C' }, // orange-700
    sensory:   { argb: 'FF6D28D9' }, // purple-700
  }[condition];
}

// Allow storing metadata on worksheet for cross-sheet formula references
interface WorksheetWithMeta extends ExcelJS.Worksheet {
  _dataStartRow?: number;
  _dataEndRow?:   number;
  _condition?:    ConditionType;
  _runIndex?:     number;
}
