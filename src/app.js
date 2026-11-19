const express = require('express');
const path = require('path');
const resources = require('./resources');
const { createDb, tx } = require('./db');
const { registerAuth, requireRole, ensureAdmin } = require('./auth');
const { registerFacturas } = require('./facturas');

function today() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CONFIG_DEFAULTS = {
  nombre_clinica: 'IIT Veterinaria',
  nit: '',
  direccion: '',
  telefono: '',
  email: '',
  hora_apertura: '08:00',
  hora_cierre: '18:00',
  duracion_cita: '30',
};

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
      if (f.min !== undefined && n < f.min) { errors.push(`${f.label} debe ser al menos ${f.min}`); continue; }
      v = n;
    }
    if (v !== null && f.type === 'select' && !f.options.includes(String(v))) {
      errors.push(`${f.label}: valor no válido`); continue;
    }
    if (v !== null && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errors.push(`${f.label}: fecha inválida (AAAA-MM-DD)`); continue;
    }
    if (v !== null && f.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      errors.push(`${f.label}: hora inválida (HH:MM)`); continue;
    }
    if (v !== null && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      errors.push(`${f.label}: correo inválido`); continue;
    }
    if (v !== null && f.type === 'signature' && !/^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(v)) {
      errors.push(`${f.label}: firma inválida`); continue;
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

function friendly(e) {
  if (/FOREIGN KEY/.test(e.message)) return 'Registro relacionado inexistente o con dependencias (no se puede eliminar)';
  return e.message;
}

/** Normaliza un celular colombiano para enlaces de WhatsApp (wa.me). */
function whatsappNumber(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  return d.length >= 11 ? d : null;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function createApp({ dbFile, adminPassword } = {}) {
  const db = createDb(dbFile);
  const generated = ensureAdmin(db, adminPassword ?? process.env.ADMIN_PASSWORD);
  if (generated) {
    console.log(`\n  Usuario inicial creado → usuario: admin  contraseña: ${generated}\n  Cámbiela al ingresar (menú Usuarios).\n`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.locals.db = db;

  const getConfig = () => {
    const cfg = { ...CONFIG_DEFAULTS };
    for (const r of db.prepare('SELECT clave, valor FROM configuracion').all()) cfg[r.clave] = r.valor;
    return cfg;
  };

  /* ---------------- Público (sin sesión): reserva de citas en línea ---------------- */
  const slots = (fecha) => {
    const cfg = getConfig();
    const toMin = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
    const paso = Math.max(10, Number(cfg.duracion_cita) || 30);
    const ocupadas = new Set(db.prepare(
      "SELECT hora FROM citas WHERE fecha = ? AND estado NOT IN ('Cancelada','No asistió')"
    ).all(fecha).map((r) => r.hora));
    const ahora = new Date();
    const minAhora = fecha === today() ? ahora.getHours() * 60 + ahora.getMinutes() : -1;
    const out = [];
    for (let m = toMin(cfg.hora_apertura); m + paso <= toMin(cfg.hora_cierre); m += paso) {
      const h = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if (!ocupadas.has(h) && m > minAhora) out.push(h);
    }
    return out;
  };

  app.get('/api/publico/clinica', (_req, res) => {
    const { nombre_clinica, direccion, telefono, email } = getConfig();
    res.json({ nombre_clinica, direccion, telefono, email });
  });

  app.get('/api/publico/disponibilidad', (req, res) => {
    const fecha = String(req.query.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < today()) return res.status(400).json({ errors: ['Fecha inválida'] });
    res.json({ fecha, horas: slots(fecha) });
  });

  app.post('/api/publico/reservar', (req, res) => {
    const b = req.body || {};
    const s = (k, max = 120) => String(b[k] ?? '').trim().slice(0, max);
    const d = {
      nombre: s('nombre'), documento: s('documento', 30), telefono: s('telefono', 30), email: s('email'),
      mascota: s('mascota', 60), especie: s('especie', 30), fecha: s('fecha', 10), hora: s('hora', 5), motivo: s('motivo', 300),
    };
    const errors = [];
    for (const k of ['nombre', 'documento', 'telefono', 'mascota', 'especie', 'fecha', 'hora', 'motivo']) if (!d[k]) errors.push(`${k} es obligatorio`);
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.push('correo inválido');
    if (d.especie && !resources.pacientes.fields.find((f) => f.name === 'especie').options.includes(d.especie)) errors.push('especie inválida');
    if (d.fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha) || d.fecha < today())) errors.push('fecha inválida');
    if (!errors.length && !slots(d.fecha).includes(d.hora)) errors.push('Ese horario ya no está disponible');
    if (errors.length) return res.status(400).json({ errors });

    const result = tx(db, () => {
      let prop = db.prepare('SELECT * FROM propietarios WHERE documento = ?').get(d.documento);
      if (!prop) {
        const id = db.prepare('INSERT INTO propietarios (nombre, documento, telefono, email) VALUES (?,?,?,?)')
          .run(d.nombre, d.documento, d.telefono, d.email || null).lastInsertRowid;
        prop = { id: Number(id) };
      }
      const pendientes = db.prepare("SELECT COUNT(*) c FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE p.propietario_id = ? AND c.estado = 'Solicitada' AND c.fecha >= ?").get(prop.id, today()).c;
      if (pendientes >= 3) return { error: 'Ya tiene varias solicitudes pendientes; la clínica se comunicará con usted' };
      let pac = db.prepare('SELECT id FROM pacientes WHERE propietario_id = ? AND lower(nombre) = lower(?)').get(prop.id, d.mascota);
      if (!pac) {
        pac = { id: Number(db.prepare('INSERT INTO pacientes (nombre, especie, propietario_id) VALUES (?,?,?)').run(d.mascota, d.especie, prop.id).lastInsertRowid) };
      }
      db.prepare("INSERT INTO citas (paciente_id, fecha, hora, tipo, motivo, estado, triage) VALUES (?,?,?,'Consulta',?,'Solicitada','Normal')")
        .run(pac.id, d.fecha, d.hora, d.motivo);
      return { ok: true };
    });
    if (result.error) return res.status(429).json({ errors: [result.error] });
    res.status(201).json({ mensaje: `Solicitud recibida para el ${d.fecha} a las ${d.hora}. La clínica confirmará su cita.` });
  });

  /* ---------------- Autenticación (a partir de aquí /api requiere sesión) ---------------- */
  registerAuth(app, db);

  app.get('/api/meta', (_req, res) => res.json(resources));

  app.get('/api/configuracion', (_req, res) => res.json(getConfig()));
  app.put('/api/configuracion', requireRole('admin'), (req, res) => {
    const up = db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
    for (const k of Object.keys(CONFIG_DEFAULTS)) {
      if (req.body?.[k] !== undefined) {
        const v = String(req.body[k]).slice(0, 200);
        if (['hora_apertura', 'hora_cierre'].includes(k) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return res.status(400).json({ errors: [`${k}: hora inválida`] });
        up.run(k, v);
      }
    }
    res.json(getConfig());
  });

  /* ---------------- Tablero ---------------- */
  app.get('/api/dashboard', (_req, res) => {
    const hoy = today();
    const count = (t, where = '1=1', ...p) => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${where}`).get(...p).c;
    res.json({
      fecha: hoy,
      totales: {
        propietarios: count('propietarios'),
        pacientes: count('pacientes'),
        citas_hoy: count('citas', "fecha = ? AND estado NOT IN ('Cancelada')", hoy),
        en_espera: count('citas', "fecha = ? AND estado = 'En sala de espera'", hoy),
        solicitudes: count('citas', "estado = 'Solicitada' AND fecha >= ?", hoy),
        hospitalizados: count('hospitalizaciones', "estado IN ('Hospitalizado','En observación')"),
        en_guarderia: count('guarderia', "estado = 'Hospedado'"),
        cirugias_hoy: count('cirugias', "fecha = ? AND estado != 'Cancelada'", hoy),
      },
      citas_hoy: db.prepare(`${selectSql('citas', resources.citas)} WHERE fecha = ? AND estado != 'Cancelada' ORDER BY hora`).all(hoy),
      vacunas_pendientes: db.prepare(
        `${selectSql('vacunas', resources.vacunas)} WHERE proxima_dosis IS NOT NULL AND proxima_dosis <= ? ORDER BY proxima_dosis LIMIT 20`
      ).all(addDays(hoy, 15)),
      stock_bajo: db.prepare("SELECT * FROM productos WHERE categoria != 'Servicio' AND stock <= stock_minimo ORDER BY stock").all(),
      por_vencer: db.prepare('SELECT * FROM productos WHERE vencimiento IS NOT NULL AND vencimiento <= ? ORDER BY vencimiento').all(addDays(hoy, 30)),
      ventas_mes: db.prepare("SELECT COALESCE(SUM(total),0) s FROM facturas WHERE tipo='Factura' AND estado IN ('Pagada','Pendiente') AND substr(fecha,1,7) = substr(?,1,7)").get(hoy).s,
      por_cobrar: db.prepare("SELECT COALESCE(SUM(total),0) s FROM facturas WHERE tipo='Factura' AND estado = 'Pendiente'").get().s,
    });
  });

  /* ---------------- Sala de espera ---------------- */
  app.get('/api/sala-espera', (req, res) => {
    const fecha = req.query.fecha || today();
    const orden = "CASE triage WHEN 'Urgente' THEN 0 WHEN 'Prioritario' THEN 1 ELSE 2 END, COALESCE(hora_llegada, hora)";
    res.json(db.prepare(`${selectSql('citas', resources.citas)} WHERE fecha = ? AND estado NOT IN ('Cancelada','Solicitada') ORDER BY ${orden}`).all(fecha));
  });

  /* ---------------- Recordatorios ---------------- */
  app.get('/api/recordatorios', (req, res) => {
    const hoy = today();
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 7));
    const { nombre_clinica, telefono } = getConfig();
    const firma = `${nombre_clinica}${telefono ? ' · Tel ' + telefono : ''}`;
    const link = (tel, msg) => { const n = whatsappNumber(tel); return n ? `https://wa.me/${n}?text=${encodeURIComponent(msg)}` : null; };

    const vacunas = db.prepare(`SELECT v.*, pa.nombre paciente, pr.nombre propietario, pr.telefono FROM vacunas v
      JOIN pacientes pa ON pa.id = v.paciente_id JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE v.proxima_dosis IS NOT NULL AND v.proxima_dosis <= ?
        AND NOT EXISTS (SELECT 1 FROM vacunas v2 WHERE v2.paciente_id = v.paciente_id AND v2.vacuna = v.vacuna AND v2.fecha_aplicacion > v.fecha_aplicacion)
      ORDER BY v.proxima_dosis`).all(addDays(hoy, dias)).map((v) => {
      const vencida = v.proxima_dosis < hoy;
      const msg = `Hola ${v.propietario}, le recordamos que ${v.paciente} ${vencida ? 'tiene pendiente' : 'tiene programada'} su ${v.tipo.toLowerCase()} (${v.vacuna}) para el ${v.proxima_dosis}. Agende su cita. ${firma}`;
      return { tipo: 'Vacuna', fecha: v.proxima_dosis, vencida, paciente: v.paciente, propietario: v.propietario, telefono: v.telefono, detalle: `${v.tipo}: ${v.vacuna}`, mensaje: msg, whatsapp: link(v.telefono, msg) };
    });

    const citas = db.prepare(`SELECT c.*, pa.nombre paciente, pr.nombre propietario, pr.telefono FROM citas c
      JOIN pacientes pa ON pa.id = c.paciente_id JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE c.fecha BETWEEN ? AND ? AND c.estado IN ('Programada','Confirmada','Solicitada') ORDER BY c.fecha, c.hora`)
      .all(hoy, addDays(hoy, Math.min(dias, 2))).map((c) => {
        const msg = `Hola ${c.propietario}, le recordamos la cita de ${c.paciente} el ${c.fecha} a las ${c.hora} (${c.motivo}). Por favor confirme su asistencia. ${firma}`;
        return { tipo: 'Cita', fecha: c.fecha, hora: c.hora, vencida: false, paciente: c.paciente, propietario: c.propietario, telefono: c.telefono, detalle: c.motivo, mensaje: msg, whatsapp: link(c.telefono, msg) };
      });
    res.json([...citas, ...vacunas]);
  });

  /* ---------------- Reportes / KPIs ---------------- */
  app.get('/api/reportes', (req, res) => {
    const hoy = today();
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : `${hoy.slice(0, 7)}-01`;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : hoy;
    const valida = "f.tipo = 'Factura' AND f.estado IN ('Pagada','Pendiente')";
    const fac = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM facturas f WHERE ${valida} AND f.fecha BETWEEN ? AND ?`).get(desde, hasta);
    const citas = db.prepare('SELECT estado, COUNT(*) n FROM citas WHERE fecha BETWEEN ? AND ? GROUP BY estado').all(desde, hasta);
    const c = Object.fromEntries(citas.map((r) => [r.estado, r.n]));
    const atendidas = c['Atendida'] || 0;
    const noAsistio = c['No asistió'] || 0;
    res.json({
      desde,
      hasta,
      kpis: {
        ingresos: fac.total,
        facturas: fac.n,
        ticket_promedio: fac.n ? Math.round(fac.total / fac.n) : 0,
        por_cobrar: db.prepare("SELECT COALESCE(SUM(total),0) s FROM facturas WHERE tipo='Factura' AND estado='Pendiente'").get().s,
        clientes_nuevos: db.prepare('SELECT COUNT(*) n FROM propietarios WHERE substr(creado_en,1,10) BETWEEN ? AND ?').get(desde, hasta).n,
        consultas: db.prepare('SELECT COUNT(*) n FROM consultas WHERE fecha BETWEEN ? AND ?').get(desde, hasta).n,
        cirugias: db.prepare("SELECT COUNT(*) n FROM cirugias WHERE fecha BETWEEN ? AND ? AND estado = 'Finalizada'").get(desde, hasta).n,
        citas_atendidas: atendidas,
        citas_no_asistio: noAsistio,
        citas_canceladas: c['Cancelada'] || 0,
        tasa_asistencia: atendidas + noAsistio ? Math.round((atendidas / (atendidas + noAsistio)) * 100) : null,
      },
      por_mes: db.prepare(`SELECT substr(fecha,1,7) mes, SUM(total) total, COUNT(*) cantidad FROM facturas f WHERE ${valida} AND f.fecha >= ? GROUP BY mes ORDER BY mes`).all(addDays(hoy, -365)),
      por_metodo: db.prepare(`SELECT COALESCE(metodo_pago,'Pendiente') metodo_pago, SUM(total) total FROM facturas f WHERE ${valida} AND f.fecha BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`).all(desde, hasta),
      top_productos: db.prepare(`SELECT i.descripcion, SUM(i.cantidad) cantidad, SUM(i.total) total FROM factura_items i JOIN facturas f ON f.id = i.factura_id
        WHERE ${valida} AND f.fecha BETWEEN ? AND ? GROUP BY i.descripcion ORDER BY total DESC LIMIT 10`).all(desde, hasta),
      por_especie: db.prepare('SELECT especie, COUNT(*) cantidad FROM pacientes GROUP BY especie ORDER BY cantidad DESC').all(),
      diagnosticos: db.prepare(`SELECT diagnostico, COUNT(*) cantidad FROM consultas WHERE fecha BETWEEN ? AND ? AND diagnostico IS NOT NULL AND diagnostico != ''
        GROUP BY lower(diagnostico) ORDER BY cantidad DESC LIMIT 10`).all(desde, hasta),
    });
  });

  /* ---------------- Historia clínica ---------------- */
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
      recetas: q('recetas', 'fecha DESC'),
      vacunas: q('vacunas', 'fecha_aplicacion DESC'),
      cirugias: q('cirugias', 'fecha DESC'),
      hospitalizaciones: q('hospitalizaciones', 'fecha_ingreso DESC'),
      guarderia: q('guarderia', 'fecha_ingreso DESC'),
      peluqueria: q('peluqueria', 'fecha DESC'),
      consentimientos: db.prepare('SELECT id, fecha, tipo, firmante FROM consentimientos WHERE paciente_id = ? ORDER BY fecha DESC').all(id),
      citas: q('citas', 'fecha DESC, hora DESC'),
    });
  });

  registerFacturas(app, db);

  /* ---------------- CRUD genérico por recurso ---------------- */
  for (const [table, def] of Object.entries(resources)) {
    const base = `/api/${table}`;
    const order = def.order || 'id DESC';
    const canWrite = def.write ? requireRole(def.write) : (_req, _res, next) => next();

    const listQuery = (query, limit) => {
      const where = [];
      const params = [];
      if (query.q) {
        where.push('(' + def.search.map((c) => `t.${c} LIKE ?`).join(' OR ') + ')');
        def.search.forEach(() => params.push(`%${query.q}%`));
      }
      for (const f of def.fields) {
        if (query[f.name] !== undefined && query[f.name] !== '') {
          where.push(`t.${f.name} = ?`);
          params.push(query[f.name]);
        }
      }
      if (query.desde && query.hasta) {
        const fecha = def.fields.find((f) => f.type === 'date');
        if (fecha) { where.push(`t.${fecha.name} BETWEEN ? AND ?`); params.push(query.desde, query.hasta); }
      }
      const sql = `${selectSql(table, def)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}${limit ? ` LIMIT ${limit}` : ''}`;
      return db.prepare(sql).all(...params);
    };

    app.get(base, (req, res) => res.json(listQuery(req.query, 500)));

    app.get(`${base}/export`, (req, res) => {
      const rows = listQuery(req.query);
      const cols = def.fields;
      const lines = [['ID', ...cols.map((f) => f.label), 'Creado'].map(csvCell).join(';')];
      for (const r of rows) {
        lines.push([r.id, ...cols.map((f) => (f.type === 'ref' ? r[`${f.name}_label`] : f.type === 'signature' ? (r[f.name] ? 'Firmado' : '') : r[f.name])), r.creado_en].map(csvCell).join(';'));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${table}-${today()}.csv"`);
      res.send('﻿' + lines.join('\r\n'));
    });

    app.get(`${base}/:id`, (req, res) => {
      const row = db.prepare(`${selectSql(table, def)} WHERE t.id = ?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: `${def.singular} no encontrado` });
      res.json(row);
    });

    app.post(base, canWrite, (req, res) => {
      const { errors, data } = validate(def, req.body || {});
      if (errors.length) return res.status(400).json({ errors });
      const cols = Object.keys(data);
      try {
        const id = tx(db, () => {
          const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...cols.map((c) => data[c]));
          const newId = Number(info.lastInsertRowid);
          if (def.onCreate) def.onCreate(db, { id: newId, ...data });
          return newId;
        });
        res.status(201).json(db.prepare(`${selectSql(table, def)} WHERE t.id = ?`).get(id));
      } catch (e) {
        res.status(400).json({ errors: [friendly(e)] });
      }
    });

    app.put(`${base}/:id`, canWrite, (req, res) => {
      const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!current) return res.status(404).json({ error: `${def.singular} no encontrado` });
      const { errors, data } = validate(def, req.body || {}, true);
      for (const k of def.immutable || []) {
        if (k in data && data[k] !== current[k]) {
          errors.push(`${def.fields.find((f) => f.name === k).label} no se puede modificar; elimine y registre de nuevo`);
        }
      }
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

    app.delete(`${base}/:id`, canWrite, (req, res) => {
      const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!current) return res.status(404).json({ error: `${def.singular} no encontrado` });
      try {
        tx(db, () => {
          db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
          if (def.onDelete) def.onDelete(db, current);
        });
        res.status(204).end();
      } catch (e) {
        res.status(409).json({ errors: [friendly(e)] });
      }
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['JSON inválido'] });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp, validate, today, addDays, whatsappNumber };
