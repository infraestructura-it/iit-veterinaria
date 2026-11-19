// Usa el SQLite integrado en Node.js (node:sqlite, Node >= 22.13):
// sin dependencias nativas ni compilación (no requiere Visual Studio en Windows).
const { DatabaseSync } = require('node:sqlite');
const resources = require('./resources');

const SQL_TYPES = { number: 'REAL', ref: 'INTEGER' };

function createDb(file = process.env.DB_FILE || 'veterinaria.db') {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

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
