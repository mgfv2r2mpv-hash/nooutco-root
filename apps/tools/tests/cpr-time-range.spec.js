import { test, expect } from '@playwright/test';
import { splitStartEnd, parseStartEndSeconds } from '../cpr/src/utils/timeRange.ts';

// The CPR header holds one "Start / End time" field, and two places split it:
// the Excel export (Start Time and End Time rows) and the Excel import (the
// observation window behind "Observation time was estimated").
//
// The 4 Aug 2026 dash sweep (162f99e1) replaced the literal en and em dashes
// inside both splitting regexes with spaces. After it, the export wrote Start
// "9:00" and End "AM - 9:30 AM", and the import split on every space, so
// "9:00 AM - 9:30 AM" came back as a 900-minute window. The dashes below are
// escapes so a sweep cannot rewrite this spec either.

const DASHES = {
  'hyphen-minus': '-',
  'hyphen U+2010': '\u2010',
  'non-breaking hyphen U+2011': '\u2011',
  'figure dash U+2012': '\u2012',
  'en dash U+2013': '\u2013',
  'em dash U+2014': '\u2014',
  'horizontal bar U+2015': '\u2015',
  'minus sign U+2212': '\u2212',
};

for (const [name, dash] of Object.entries(DASHES)) {
  test(`a dash written as ${name} between two 12-hour times splits into start and end`, () => {
    expect(splitStartEnd(`9:00 AM ${dash} 9:30 AM`)).toEqual({ start: '9:00 AM', end: '9:30 AM' });
    expect(splitStartEnd(`9:00 AM${dash}9:30 AM`)).toEqual({ start: '9:00 AM', end: '9:30 AM' });
  });

  test(`a window written with ${name} imports as 30 minutes, not 900`, () => {
    const spaced = parseStartEndSeconds(`9:00 AM ${dash} 9:30 AM`);
    expect(spaced).not.toBeNull();
    expect(spaced.endSec - spaced.startSec).toBe(30 * 60);
    const tight = parseStartEndSeconds(`09:00${dash}09:30`);
    expect(tight.endSec - tight.startSec).toBe(30 * 60);
  });
}

test('a time with no dash is all start and no end', () => {
  expect(splitStartEnd('9:00 AM')).toEqual({ start: '9:00 AM', end: '' });
  expect(parseStartEndSeconds('9:00 AM')).toBeNull();
});

test('an empty field splits to two empty halves and no window', () => {
  expect(splitStartEnd('')).toEqual({ start: '', end: '' });
  expect(parseStartEndSeconds('')).toBeNull();
});

test('a window that crosses midnight runs forward, not backward', () => {
  const w = parseStartEndSeconds('11:45 PM - 12:15 AM');
  expect(w.endSec - w.startSec).toBe(30 * 60);
});

test('PM times read as afternoon', () => {
  const w = parseStartEndSeconds('1:00 PM - 2:30 PM');
  expect(w.startSec).toBe(13 * 3600);
  expect(w.endSec - w.startSec).toBe(90 * 60);
});
