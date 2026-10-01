import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* notes/bcba/goal-order.js: which category a goal row is in, the default order of
 * the categories, and how a drag teaches a new order. A browser IIFE, run here
 * in a bare vm with an in-memory localStorage. Names are invented. */

const SRC = readFileSync(join(__dirname, '..', 'notes/bcba/goal-order.js'), 'utf8');
function load(stored) {
  const store = new Map(stored ? [['nome_goal_category_order_v1', stored]] : []);
  const sandbox = {
    window: {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    },
  };
  vm.runInNewContext(SRC, sandbox);
  return { GO: sandbox.window.GoalOrder, store };
}

const { GO } = load();
const cat = (r) => GO.categoryOf(r.goal, r.red);
const r = (goal, red) => ({ goal, red: !!red });

test.describe('goal order: categories', () => {
  test('the default order is reduction and safety, communication, play, other', () => {
    expect(GO.CATEGORIES).toEqual(['reduction', 'communication', 'play', 'other']);
  });

  test('a reduction target is reduction whatever its name says', () => {
    expect(GO.categoryOf('Play with a peer', true)).toBe('reduction');
  });

  test('communication, play and other come from the words in the name', () => {
    expect(GO.categoryOf('Mand for help')).toBe('communication');
    expect(GO.categoryOf('Tact common objects')).toBe('communication');
    expect(GO.categoryOf('Play with a peer')).toBe('play');
    expect(GO.categoryOf('Turn taking in a game')).toBe('play');
    expect(GO.categoryOf('Sort colors')).toBe('other');
  });
});

test.describe('goal order: sorting', () => {
  const rows = [r('Sort colors'), r('Play with a peer'), r('Mand for help'), r('Elopement', true), r('Zip a coat')];

  test('rows sort by category, keeping their order inside a category', () => {
    const out = GO.sortRows(rows, GO.CATEGORIES, cat).map((x) => x.goal);
    expect(out).toEqual(['Elopement', 'Mand for help', 'Play with a peer', 'Sort colors', 'Zip a coat']);
  });

  test('a learned order moves whole categories', () => {
    const out = GO.sortRows(rows, ['reduction', 'play', 'communication', 'other'], cat).map((x) => x.goal);
    expect(out).toEqual(['Elopement', 'Play with a peer', 'Mand for help', 'Sort colors', 'Zip a coat']);
  });

  test('sorting returns a new array and leaves the rows alone', () => {
    const copy = rows.slice();
    const out = GO.sortRows(rows, GO.CATEGORIES, cat);
    expect(out).not.toBe(rows);
    expect(rows).toEqual(copy);
  });
});

test.describe('goal order: learning from a drop', () => {
  test('a row dropped above another category moves its category above that one', () => {
    const after = [r('Elopement', true), r('Play with a peer'), r('Mand for help'), r('Sort colors')];
    expect(GO.learn(GO.CATEGORIES, after, 1, cat)).toEqual(['reduction', 'play', 'communication', 'other']);
  });

  test('a row dropped at the end moves its category below the one above it', () => {
    const after = [r('Elopement', true), r('Mand for help'), r('Sort colors'), r('Play with a peer')];
    expect(GO.learn(GO.CATEGORIES, after, 3, cat)).toEqual(['reduction', 'communication', 'other', 'play']);
  });

  test('a drop among its own category teaches nothing', () => {
    const after = [r('Mand for help'), r('Tact objects'), r('Play with a peer')];
    expect(GO.learn(GO.CATEGORIES, after, 1, cat)).toEqual(GO.CATEGORIES);
  });

  test('learning returns a new array', () => {
    const order = GO.CATEGORIES.slice();
    const out = GO.learn(order, [r('Play with a peer'), r('Mand for help')], 0, cat);
    expect(out).not.toBe(order);
    expect(order).toEqual(GO.CATEGORIES);
  });
});

test.describe('goal order: storage holds category names only', () => {
  test('an order that is not the default is saved, and loaded back', () => {
    const { GO: g, store } = load();
    g.save(['reduction', 'play', 'communication', 'other']);
    expect(JSON.parse(store.get(g.KEY))).toEqual(['reduction', 'play', 'communication', 'other']);
    expect(g.load()).toEqual(['reduction', 'play', 'communication', 'other']);
  });

  test('the default order stores nothing', () => {
    const { GO: g, store } = load();
    g.save(['reduction', 'play', 'communication', 'other']);
    g.save(g.CATEGORIES);
    expect(store.has(g.KEY)).toBe(false);
  });

  test('a stored value that is not an order of the four names is repaired, never trusted', () => {
    const { GO: g } = load(JSON.stringify(['play', 'play', 'Jordan Smith', 'reduction']));
    expect(g.load()).toEqual(['play', 'reduction', 'communication', 'other']);
    const { GO: h } = load('not json');
    expect(h.load()).toEqual(h.CATEGORIES);
  });

  test('reset clears the stored order', () => {
    const { GO: g, store } = load();
    g.save(['reduction', 'play', 'communication', 'other']);
    expect(g.reset()).toEqual(g.CATEGORIES);
    expect(store.has(g.KEY)).toBe(false);
  });
});
