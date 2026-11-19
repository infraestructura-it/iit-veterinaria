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
    // Migración simple: agrega columnas nuevas a tablas existentes.
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const f of def.fields) {
      if (!existing.has(f.name)) {
        const ref = f.type === 'ref' ? ` REFERENCES ${f.ref}(id)` : '';
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.name} ${SQL_TYPES[f.type] || 'TEXT'}${ref}`);
      }
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin','veterinario','recepcion')),
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expira INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS facturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT,
      tipo TEXT NOT NULL CHECK (tipo IN ('Factura','Presupuesto')),
      estado TEXT NOT NULL,
      propietario_id INTEGER NOT NULL REFERENCES propietarios(id) ON DELETE RESTRICT,
      paciente_id INTEGER REFERENCES pacientes(id) ON DELETE RESTRICT,
      fecha TEXT NOT NULL,
      metodo_pago TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      descuento REAL NOT NULL DEFAULT 0,
      impuestos REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      notas TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS factura_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id) ON DELETE RESTRICT,
      descripcion TEXT NOT NULL,
      cantidad REAL NOT NULL,
      precio REAL NOT NULL,
      iva REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );
  `);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { createDb, tx };
