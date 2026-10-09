/**
 * timeRange - splits the header's one "Start / End time" field.
 *
 * The Excel export writes it as two rows (Start Time, End Time) and the Excel
 * import turns it into the observation window behind "Observation time was
 * estimated". Both used to carry their own regex, and the 4 Aug 2026 dash
 * sweep (162f99e1) replaced the literal en and em dashes inside both with
 * spaces: the export wrote Start "9:00" and End "AM - 9:30 AM", and the import
 * split on every space, so "9:00 AM - 9:30 AM" came back as 900 minutes.
 *
 * The dashes are written as \u escapes so a sweep cannot touch them again:
 * U+2010 to U+2015 (hyphen, non-breaking hyphen, figure dash, en dash, em dash,
 * horizontal bar), U+2212 (minus sign) and the ASCII hyphen-minus.
 */

const RANGE = /^(.*?)\s*[\u2010-\u2015\u2212-]\s*(.*)$/;

export interface StartEnd { start: string; end: string; }

/** "9:00 AM - 9:30 AM" -> { start: "9:00 AM", end: "9:30 AM" }. No dash: all start. */
export function splitStartEnd(raw: string): StartEnd {
  const text = (raw || '').trim();
  const m = RANGE.exec(text);
  if (!m) return { start: text, end: '' };
  return { start: m[1].trim(), end: m[2].trim() };
}

/** Seconds from midnight for "9:00 AM", "21:00" or "9:00:30 PM"; null when it is not a clock time. */
export function parseClockTime(raw: string): number | null {
  const t = raw.replace(/\s*:\s*/g, ':').trim();
  const amPm = /([AaPp][Mm])$/.exec(t);
  const suffix = amPm ? amPm[1].toUpperCase() : null;
  const timePart = suffix ? t.slice(0, t.length - suffix.length).trim() : t;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(timePart)) return null;
  const [h0, m = 0, sec = 0] = timePart.split(':').map(Number);
  let h = h0;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix === 'PM' && h !== 12) h += 12;
    if (suffix === 'AM' && h === 12) h = 0;
  }
  if (h > 23 || m > 59 || sec > 59) return null;
  return h * 3600 + m * 60 + sec;
}

const SECONDS_PER_DAY = 86400;

/**
 * The start and end of the field as seconds from midnight, or null when either
 * half is missing or is not a clock time. An end before the start is taken as
 * the next day, so a session that crosses midnight runs forward.
 */
export function parseStartEndSeconds(raw: string): { startSec: number; endSec: number } | null {
  const { start, end } = splitStartEnd(raw);
  if (!start || !end) return null;
  const startSec = parseClockTime(start);
  const endSec = parseClockTime(end);
  if (startSec === null || endSec === null) return null;
  return { startSec, endSec: endSec < startSec ? endSec + SECONDS_PER_DAY : endSec };
}
