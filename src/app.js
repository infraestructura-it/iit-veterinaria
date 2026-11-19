const express = require('express');
const path = require('path');
const resources = require('./resources');
const { createDb } = require('./db');

function today() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function validate(def, body, partial = false) {
  const errors = [];
  const data = {};
  for (const f of def.fields) {
    let v = body[f.name];
    if (v === undefined || v === '') {
      if (!partial && f.default !== undefined) v = f.default;
      else if (!partial && f.required) { errors.push(`${f.label} es obligatorio`); continue; }
      else if (v === '') v = null;
      else continue;
    }
    if (v !== null && (f.type === 'number' || f.type === 'ref')) {
      const n = Number(v);
      if (Number.isNaN(n)) { errors.push(`${f.label} debe ser numérico`); continue; }
      v = n;
    }
    if (v !== null && f.type === 'select' && !f.options.includes(v)) {
      errors.push(`${f.label}: valor no válido`); continue;
    }
    if (v !== null && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errors.push(`${f.label}: fecha inválida (AAAA-MM-DD)`); continue;
    }
    if (v !== null && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      errors.push(`${f.label}: correo inválido`); continue;
    }
    if (v === null && f.required) { errors.push(`${f.label} es obligatorio`); continue; }
    data[f.name] = v;
  }
  return { errors, data };
}

function selectSql(table, def) {
  const extra = def.fields
    .filter((f) => f.type === 'ref')
    .map((f) => `(SELECT ${resources[f.ref].display} FROM ${f.ref} WHERE id = t.${f.name}) AS ${f.name}_label`);
  return `SELECT t.*${extra.length ? ', ' + extra.join(', ') : ''} FROM ${table} t`;
}

function createApp({ dbFile } = {}) {
  const db = createDb(dbFile);
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.locals.db = db;

  app.get('/api/meta', (_req, res) => res.json(resources));

  app.get('/api/dashboard', (_req, res) => {
    const hoy = today();
    const count = (t, where = '1=1', ...p) => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${where}`).get(...p).c;
    res.json({
      fecha: hoy,
      totales: {
        propietarios: count('propietarios'),
        pacientes: count('pacientes'),
        citas_hoy: count('citas', 'fecha = ?', hoy),
        hospitalizados: count('hospitalizaciones', "estado IN ('Hospitalizado','En observación')"),
      },
      citas_hoy: db.prepare(`${selectSql('citas', resources.citas)} WHERE fecha = ? ORDER BY hora`).all(hoy),
      vacunas_pendientes: db.prepare(
        `${selectSql('vacunas', resources.vacunas)} WHERE proxima_dosis IS NOT NULL AND proxima_dosis <= date(?, '+15 days') ORDER BY proxima_dosis LIMIT 20`
      ).all(hoy),
      stock_bajo: db.prepare('SELECT * FROM productos WHERE stock <= stock_minimo ORDER BY stock').all(),
      ventas_mes: db.prepare("SELECT COALESCE(SUM(total),0) s FROM ventas WHERE substr(fecha,1,7) = substr(?,1,7)").get(hoy).s,
    });
  });

  app.get('/api/reportes/ventas', (_req, res) => {
    res.json({
      por_mes: db.prepare("SELECT substr(fecha,1,7) mes, SUM(total) total, COUNT(*) cantidad FROM ventas GROUP BY mes ORDER BY mes").all(),
      por_metodo: db.prepare('SELECT metodo_pago, SUM(total) total FROM ventas GROUP BY metodo_pago ORDER BY total DESC').all(),
      por_especie: db.prepare('SELECT especie, COUNT(*) cantidad FROM pacientes GROUP BY especie ORDER BY cantidad DESC').all(),
    });
  });

  app.get('/api/pacientes/:id/historia', (req, res) => {
    const id = Number(req.params.id);
    const paciente = db.prepare(`${selectSql('pacientes', resources.pacientes)} WHERE t.id = ?`).get(id);
    if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });
    const propietario = db.prepare('SELECT * FROM propietarios WHERE id = ?').get(paciente.propietario_id);
    const q = (t, order) => db.prepare(`SELECT * FROM ${t} WHERE paciente_id = ? ORDER BY ${order}`).all(id);
    res.json({
      paciente,
      propietario,
      consultas: q('consultas', 'fecha DESC'),
      vacunas: q('vacunas', 'fecha_aplicacion DESC'),
      hospitalizaciones: q('hospitalizaciones', 'fecha_ingreso DESC'),
      peluqueria: q('peluqueria', 'fecha DESC'),
      citas: q('citas', 'fecha DESC, hora DESC'),
    });
  });

  for (const [table, def] of Object.entries(resources)) {
    const base = `/api/${table}`;
    const order = def.order || 'id DESC';

    app.get(base, (req, res) => {
      const where = [];
      const params = [];
      if (req.query.q) {
        where.push('(' + def.search.map((c) => `t.${c} LIKE ?`).join(' OR ') + ')');
        def.search.forEach(() => params.push(`%${req.query.q}%`));
      }
      for (const f of def.fields) {
        if (req.query[f.name] !== undefined && req.query[f.name] !== '') {
          where.push(`t.${f.name} = ?`);
          params.push(req.query[f.name]);
        }
      }
      const sql = `${selectSql(table, def)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`;
      res.json(db.prepare(sql).all(...params));
    });

    app.get(`${base}/:id`, (req, res) => {
      const row = db.prepare(`${selectSql(table, def)} WHERE t.id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: `${def.singular} no encontrado` });
      res.json(row);
    });

    app.post(base, (req, res) => {
      const { errors, data } = validate(def, req.body || {});
      if (errors.length) return res.status(400).json({ errors });
      const cols = Object.keys(data);
      try {
        const info = db.prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        ).run(...cols.map((c) => data[c]));
        res.status(201).json(db.prepare(`${selectSql(table, def)} WHERE t.id = ?`).get(info.lastInsertRowid));
      } catch (e) {
        res.status(400).json({ errors: [friendly(e)] });
      }
    });

    app.put(`${base}/:id`, (req, res) => {
      if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(req.params.id)) {
        return res.status(404).json({ error: `${def.singular} no encontrado` });
      }
      const { errors, data } = validate(def, req.body || {}, true);
      if (errors.length) return res.status(400).json({ errors });
      const cols = Object.keys(data);
      if (!cols.length) return res.status(400).json({ errors: ['Nada para actualizar'] });
      try {
        db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
          .run(...cols.map((c) => data[c]), req.params.id);
        res.json(db.prepare(`${selectSql(table, def)} WHERE t.id = ?`).get(req.params.id));
      } catch (e) {
        res.status(400).json({ errors: [friendly(e)] });
      }
    });

    app.delete(`${base}/:id`, (req, res) => {
      try {
        const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
        if (!info.changes) return res.status(404).json({ error: `${def.singular} no encontrado` });
        res.status(204).end();
      } catch (e) {
        res.status(409).json({ errors: [friendly(e)] });
      }
    });
  }

  return app;
}

function friendly(e) {
  if (/FOREIGN KEY/.test(e.message) || String(e.code).includes('FOREIGNKEY')) {
    return 'Registro relacionado inexistente o con dependencias (no se puede eliminar)';
  }
  return e.message;
}

module.exports = { createApp, validate, today };
