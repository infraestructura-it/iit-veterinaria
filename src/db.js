const Database = require('better-sqlite3');
const resources = require('./resources');

const SQL_TYPES = { number: 'REAL', ref: 'INTEGER' };

function createDb(file = process.env.DB_FILE || 'veterinaria.db') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  for (const [table, def] of Object.entries(resources)) {
    const cols = def.fields.map((f) => {
      let col = `${f.name} ${SQL_TYPES[f.type] || 'TEXT'}`;
      if (f.required) col += ' NOT NULL';
      if (f.type === 'ref') col += ` REFERENCES ${f.ref}(id) ON DELETE RESTRICT`;
      return col;
    });
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${cols.join(',\n      ')},
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`);
  }
  return db;
}

module.exports = { createDb };
