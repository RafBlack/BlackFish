import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_beta.sql', import.meta.url), 'utf8'));
  function prepare(sql) {
    let params = [];
    const execute = () => {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...params), meta: { changes: 0 }, success: true };
      const result = statement.run(...params);
      return { results: [], meta: { changes: Number(result.changes) }, success: true };
    };
    return { bind(...values) { params = values; return this; }, async first() { return execute().results[0] || null; }, async all() { return execute(); }, async run() { return execute(); }, execute };
  }
  return { sqlite, prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
