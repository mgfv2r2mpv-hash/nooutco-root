/* A D1 binding over real SQLite, for tests that need the store's own SQL to run.
 *
 * WHY NOT A MOCK. The write path is read, fold, write with ON CONFLICT upserts,
 * and a mock would test my idea of what those statements do. node:sqlite runs
 * schema.sql and every statement exactly as written, and D1 is SQLite.
 *
 * WHY NOT wrangler dev. The live tests beside this file do use it, and they
 * spend seconds starting a server on a port another session might hold. This
 * runs in process, so a Playwright spec can put the real Pages worker and the
 * real profile Worker in one chain without a second dev server.
 *
 * WHAT IT ALSO DOES: every statement bound is kept in `bound` as {sql, values},
 * so a test can ask what a request actually tried to write, not only what
 * landed.
 *
 * Only the surface this codebase uses: prepare, bind, first, all, run, batch.
 *
 * The caller hands in the text of schema.sql. Playwright compiles a spec and
 * what it imports to CommonJS, where import.meta does not exist, so this file
 * does not locate the schema itself.
 */
import { DatabaseSync } from "node:sqlite";

export function d1Sqlite(schema) {
  if (typeof schema !== "string" || !/CREATE TABLE/i.test(schema)) throw new Error("d1Sqlite needs the text of schema.sql");
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const bound = [];

  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => {
      bound.push({ sql, values });
      return statement(sql, values);
    },
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true };
    },
  });

  return {
    bound,
    sqlite: db,
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        for (const s of list) db.prepare(s.sql).run(...s.params);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return list.map(() => ({ success: true }));
    },
  };
}
