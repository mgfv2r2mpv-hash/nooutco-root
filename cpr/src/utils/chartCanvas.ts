/**
 * chartCanvas — renders CPR bar charts to an HTMLCanvasElement.
 * Used by excelExport to embed PNG chart images in the .xlsx file.
 */
import type { ConditionAnalysis } from '../types';
import { CONDITION_META } from '../types';

const CONDITION_COLORS: Record<string, string> = {
  attention: '#1D4ED8',
  escape:    '#15803D',
  tangible:  '#C2410C',
  sensory:   '#6D28D9',
};

interface BarChartOptions {
  title:     string;
  analyses:  ConditionAnalysis[];
  getPlus:   (ca: ConditionAnalysis) => number | null;
  getMinus:  (ca: ConditionAnalysis) => number | null;
  plusLabel: string;
  minusLabel: string;
  width?:    number;
  height?:   number;
}

export function drawBarChartToCanvas(opts: BarChartOptions): HTMLCanvasElement {
  const {
    title, analyses, getPlus, getMinus, plusLabel, minusLabel,
    width = 480, height = 260,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Layout constants
  const PAD_TOP    = 48;
  const PAD_BOTTOM = 52;
  const PAD_LEFT   = 52;
  const PAD_RIGHT  = 16;
  const chartW = width  - PAD_LEFT - PAD_RIGHT;
  const chartH = height - PAD_TOP  - PAD_BOTTOM;

  const BAR_W    = Math.min(28, Math.floor(chartW / (analyses.length * 2.8)));
  const GAP      = Math.round(BAR_W * 0.3);
  const GROUP_W  = BAR_W * 2 + GAP;
  const GROUP_GAP = Math.round(BAR_W * 1.2);
  const totalGroupsW = analyses.length * GROUP_W + Math.max(0, analyses.length - 1) * GROUP_GAP;
  const startX = PAD_LEFT + (chartW - totalGroupsW) / 2;

  // Title
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 22);

  // Y-axis gridlines + labels
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right';
  for (const tick of [0, 25, 50, 75, 100]) {
    const y = PAD_TOP + chartH - (tick / 100) * chartH;
    ctx.fillText(`${tick}%`, PAD_LEFT - 6, y + 3);
    ctx.strokeStyle = tick === 0 ? '#d1d5db' : '#e5e7eb';
    ctx.lineWidth = tick === 0 ? 1.5 : 0.75;
    ctx.setLineDash(tick === 0 ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, y);
    ctx.lineTo(PAD_LEFT + chartW, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Bars
  analyses.forEach((ca, i) => {
    const meta  = CONDITION_META[ca.condition];
    const color = CONDITION_COLORS[ca.condition] ?? '#6b7280';
    const x     = startX + i * (GROUP_W + GROUP_GAP);
    const baseY = PAD_TOP + chartH;

    const plus  = getPlus(ca);
    const minus = getMinus(ca);
    const plusH  = plus  !== null ? Math.round(plus  * chartH) : 0;
    const minusH = minus !== null ? Math.round(minus * chartH) : 0;

    // Plus bar (condition color)
    ctx.fillStyle = color;
    ctx.fillRect(x, baseY - plusH, BAR_W, Math.max(plusH, 1));

    // Plus bar value label (above bar, or inside at top if 100%)
    if (plus !== null) {
      const isFullPlus = plus >= 1;
      ctx.fillStyle = isFullPlus ? '#ffffff' : '#1f2937';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${(plus * 100).toFixed(0)}%`, x + BAR_W / 2, isFullPlus ? baseY - plusH + 10 : baseY - plusH - 2);
    }

    // Minus bar (muted red)
    ctx.fillStyle = '#f87171';
    ctx.fillRect(x + BAR_W + GAP, baseY - minusH, BAR_W, Math.max(minusH, 1));

    // Minus bar value label (above bar, or inside at top if 100%)
    if (minus !== null) {
      const isFullMinus = minus >= 1;
      ctx.fillStyle = isFullMinus ? '#ffffff' : '#1f2937';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${(minus * 100).toFixed(0)}%`, x + BAR_W + GAP + BAR_W / 2, isFullMinus ? baseY - minusH + 10 : baseY - minusH - 2);
    }

    // Condition label below
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(meta.label, x + GROUP_W / 2, baseY + 16);
  });

  // Legend
  const legendY = height - 16;
  const legendItems = [
    { color: '#3b82f6', label: plusLabel },
    { color: '#f87171', label: minusLabel },
  ];
  const legendTotalW = legendItems.reduce((acc, it) => acc + 14 + ctx.measureText(it.label).width + 16, 0);
  let lx = (width - legendTotalW) / 2;
  for (const { color, label } of legendItems) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY - 9, 10, 10);
    ctx.fillStyle = '#4b5563';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 14, legendY);
    lx += 14 + ctx.measureText(label).width + 16;
  }

  return canvas;
}

export function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  // Strip the "data:image/png;base64," prefix — ExcelJS wants raw base64
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
