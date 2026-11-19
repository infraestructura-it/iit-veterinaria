// Módulo de laboratorio clínico: catálogo de exámenes, órdenes, resultados con
// intervalos de referencia por especie, validación y verificación pública por código QR.
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { requireRole } = require('./auth');
const { tx } = require('./db');
const { CATEGORIAS, EXAMENES } = require('./lab-catalogo');

const ESTADOS = ['Solicitado', 'Muestra tomada', 'En proceso', 'Validado', 'Entregado', 'Anulado'];
const CERRADOS = ['Validado', 'Entregado', 'Anulado'];
const CLINICOS = ['admin', 'veterinario'];

function initLabDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_examenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL,
      muestra TEXT,
      indicaciones TEXT,
      precio REAL NOT NULL DEFAULT 0,
      tiempo_entrega INTEGER,
      parametros TEXT NOT NULL DEFAULT '[]',
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS lab_ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT,
      examen_id INTEGER NOT NULL REFERENCES lab_examenes(id) ON DELETE RESTRICT,
      fecha_solicitud TEXT NOT NULL,
      fecha_toma TEXT,
      solicitante TEXT,
      prioridad TEXT NOT NULL DEFAULT 'Normal',
      estado TEXT NOT NULL DEFAULT 'Solicitado',
      observaciones TEXT,
      resultados TEXT NOT NULL DEFAULT '[]',
      conclusion TEXT,
      validado_por TEXT,
      fecha_validacion TEXT,
      token TEXT NOT NULL UNIQUE,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  if (db.prepare('SELECT COUNT(*) c FROM lab_examenes').get().c === 0) {
    const ins = db.prepare(`INSERT INTO lab_examenes (codigo, nombre, categoria, muestra, indicaciones, precio, tiempo_entrega, parametros)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const e of EXAMENES) ins.run(e.codigo, e.nombre, e.categoria, e.muestra, e.indicaciones, e.precio, e.tiempo_entrega, JSON.stringify(e.parametros));
  }
}

const now = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
};

/** Convierte "12,5" → 12.5; devuelve null si no es numérico. */
function toNumber(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Intervalo de referencia del parámetro para la especie del paciente. */
function referencia(param, especie) {
  if (param.tipo === 'texto') return null;
  const r = especie === 'Canino' ? param.can : especie === 'Felino' ? param.fel : param.otro;
  return Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number') ? r : null;
}

/** Interpretación de un valor numérico frente a su intervalo: Alto / Bajo / Normal. */
function interpretar(valor, ref) {
  const n = toNumber(valor);
  if (n === null || !ref) return null;
  if (n < ref[0]) return 'Bajo';
  if (n > ref[1]) return 'Alto';
  return 'Normal';
}

/** Une los parámetros del examen con los valores registrados y calcula referencia e interpretación. */
function armarResultados(parametros, valores, especie) {
  return parametros.map((p) => {
    const valor = valores[p.nombre] === undefined || valores[p.nombre] === null ? '' : String(valores[p.nombre]).trim().slice(0, 500);
    const ref = referencia(p, especie);
    return {
      parametro: p.nombre,
      tipo: p.tipo === 'texto' ? 'texto' : 'numero',
      valor,
      unidad: p.unidad || '',
      ref_min: ref ? ref[0] : null,
      ref_max: ref ? ref[1] : null,
      normal: p.tipo === 'texto' ? p.normal || '' : null,
      interpretacion: p.tipo === 'texto' ? null : interpretar(valor, ref),
    };
  });
}

function validarParametros(parametros) {
  if (!Array.isArray(parametros) || !parametros.length) return 'Defina al menos un parámetro';
  const nombres = new Set();
  for (const p of parametros) {
    if (!p || !String(p.nombre || '').trim()) return 'Todos los parámetros necesitan nombre';
    if (nombres.has(p.nombre)) return `Parámetro repetido: ${p.nombre}`;
    nombres.add(p.nombre);
    for (const k of ['can', 'fel', 'otro']) {
      const r = p[k];
      if (r !== undefined && r !== null && !(Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x)) && r[0] <= r[1])) {
        return `Intervalo inválido en ${p.nombre}`;
      }
    }
  }
  return null;
}

function baseUrl(req, cfg) {
  const configured = String(cfg.url_publica || '').trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

function registerLabPublic(app, db, getConfig) {
  // Verificación pública del resultado (destino del código QR). Solo resultados validados.
  app.get('/api/publico/resultado/:token', (req, res) => {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: 'Resultado no encontrado' });
    const o = db.prepare(`SELECT o.*, e.nombre examen, e.categoria, e.muestra, pa.nombre paciente, pa.especie, pa.raza, pa.sexo,
        pr.nombre propietario FROM lab_ordenes o JOIN lab_examenes e ON e.id = o.examen_id
        JOIN pacientes pa ON pa.id = o.paciente_id JOIN propietarios pr ON pr.id = pa.propietario_id WHERE o.token = ?`).get(token);
    if (!o || !['Validado', 'Entregado'].includes(o.estado)) return res.status(404).json({ error: 'Resultado no encontrado o aún no validado' });
    const { nombre_clinica, nit, direccion, telefono } = getConfig();
    // Datos mínimos: se oculta el apellido del propietario
    const [nombre, ...resto] = String(o.propietario).split(/\s+/);
    res.json({
      clinica: { nombre_clinica, nit, direccion, telefono },
      codigo: o.codigo, examen: o.examen, categoria: o.categoria, muestra: o.muestra,
      paciente: o.paciente, especie: o.especie, raza: o.raza, sexo: o.sexo,
      propietario: `${nombre}${resto.length ? ' ' + resto.map((r) => r[0] + '.').join(' ') : ''}`,
      fecha_toma: o.fecha_toma, fecha_validacion: o.fecha_validacion, validado_por: o.validado_por,
      resultados: JSON.parse(o.resultados), conclusion: o.conclusion, estado: o.estado,
    });
  });
}

function registerLab(app, db, getConfig) {
  const parseExamen = (e) => e && { ...e, parametros: JSON.parse(e.parametros), activo: !!e.activo };
  const getExamen = (id) => parseExamen(db.prepare('SELECT * FROM lab_examenes WHERE id = ?').get(id));

  const selectOrden = `SELECT o.*, e.nombre examen, e.codigo examen_codigo, e.categoria, e.muestra, e.precio,
      pa.nombre paciente, pa.especie, pa.raza, pa.sexo, pa.fecha_nacimiento, pa.peso, pa.propietario_id,
      pr.nombre propietario, pr.documento propietario_documento, pr.telefono propietario_telefono
    FROM lab_ordenes o JOIN lab_examenes e ON e.id = o.examen_id JOIN pacientes pa ON pa.id = o.paciente_id
    JOIN propietarios pr ON pr.id = pa.propietario_id`;

  const getOrden = (id, req) => {
    const o = db.prepare(`${selectOrden} WHERE o.id = ?`).get(id);
    if (!o) return null;
    o.resultados = JSON.parse(o.resultados);
    o.parametros = getExamen(o.examen_id).parametros;
    if (req) {
      o.url_verificacion = `${baseUrl(req, getConfig())}/resultado.html?t=${o.token}`;
      const d = String(o.propietario_telefono || '').replace(/\D/g, '');
      const tel = d.length === 10 && d.startsWith('3') ? `57${d}` : d.length >= 11 ? d : null;
      if (tel && ['Validado', 'Entregado'].includes(o.estado)) {
        const msg = `Hola ${o.propietario}, ya está listo el resultado de ${o.examen} de ${o.paciente} (${o.codigo}). Puede consultarlo aquí: ${o.url_verificacion} — ${getConfig().nombre_clinica}`;
        o.whatsapp = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
      }
    }
    return o;
  };

  const bad = (res, ...errors) => res.status(400).json({ errors });

  /* ---------- Catálogo ---------- */
  app.get('/api/lab/categorias', (_req, res) => res.json(CATEGORIAS));

  app.get('/api/lab/catalogo', (req, res) => {
    const where = req.query.activos ? 'WHERE activo = 1' : '';
    res.json(db.prepare(`SELECT * FROM lab_examenes ${where} ORDER BY categoria, nombre`).all().map(parseExamen));
  });

  app.get('/api/lab/catalogo/:id', (req, res) => {
    const e = getExamen(req.params.id);
    if (!e) return res.status(404).json({ error: 'Examen no encontrado' });
    res.json(e);
  });

  const guardarExamen = (req, res, existente) => {
    const b = req.body || {};
    const d = {
      codigo: String(b.codigo ?? existente?.codigo ?? '').trim(),
      nombre: String(b.nombre ?? existente?.nombre ?? '').trim(),
      categoria: b.categoria ?? existente?.categoria,
      muestra: b.muestra ?? existente?.muestra ?? null,
      indicaciones: b.indicaciones ?? existente?.indicaciones ?? null,
      precio: toNumber(b.precio ?? existente?.precio ?? 0),
      tiempo_entrega: b.tiempo_entrega === '' ? null : toNumber(b.tiempo_entrega ?? existente?.tiempo_entrega),
      parametros: b.parametros ?? existente?.parametros,
      activo: b.activo === undefined ? (existente ? existente.activo : true) : !!b.activo,
    };
    const errors = [];
    if (!d.codigo) errors.push('Código es obligatorio');
    if (!d.nombre) errors.push('Nombre es obligatorio');
    if (!CATEGORIAS.includes(d.categoria)) errors.push('Categoría inválida');
    if (d.precio === null || d.precio < 0) errors.push('Precio inválido');
    const errP = validarParametros(d.parametros);
    if (errP) errors.push(errP);
    if (errors.length) return bad(res, ...errors);
    const vals = [d.codigo, d.nombre, d.categoria, d.muestra, d.indicaciones, d.precio, d.tiempo_entrega, JSON.stringify(d.parametros), d.activo ? 1 : 0];
    try {
      if (existente) {
        db.prepare(`UPDATE lab_examenes SET codigo=?, nombre=?, categoria=?, muestra=?, indicaciones=?, precio=?, tiempo_entrega=?, parametros=?, activo=? WHERE id=?`).run(...vals, existente.id);
        return res.json(getExamen(existente.id));
      }
      const id = db.prepare(`INSERT INTO lab_examenes (codigo, nombre, categoria, muestra, indicaciones, precio, tiempo_entrega, parametros, activo) VALUES (?,?,?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid;
      return res.status(201).json(getExamen(id));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return bad(res, 'Ya existe un examen con ese código');
      throw e;
    }
  };

  app.post('/api/lab/catalogo', requireRole('admin'), (req, res) => guardarExamen(req, res, null));
  app.put('/api/lab/catalogo/:id', requireRole('admin'), (req, res) => {
    const e = getExamen(req.params.id);
    if (!e) return res.status(404).json({ error: 'Examen no encontrado' });
    guardarExamen(req, res, e);
  });

  /* ---------- Órdenes ---------- */
  app.get('/api/lab/ordenes', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.q) {
      where.push('(o.codigo LIKE ? OR pa.nombre LIKE ? OR pr.nombre LIKE ? OR e.nombre LIKE ?)');
      params.push(...Array(4).fill(`%${req.query.q}%`));
    }
    for (const k of ['estado', 'paciente_id', 'examen_id', 'prioridad']) {
      if (req.query[k]) { where.push(`o.${k} = ?`); params.push(req.query[k]); }
    }
    if (req.query.pendientes) where.push("o.estado IN ('Solicitado','Muestra tomada','En proceso')");
    const sql = `${selectOrden} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE o.prioridad WHEN 'Urgente' THEN 0 ELSE 1 END, o.id DESC LIMIT 500`;
    res.json(db.prepare(sql).all(...params).map((o) => ({ ...o, resultados: undefined, token: undefined })));
  });

  app.get('/api/lab/ordenes/:id', (req, res) => {
    const o = getOrden(req.params.id, req);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(o);
  });

  app.post('/api/lab/ordenes', (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.examen_ids) ? b.examen_ids : [b.examen_id]).filter(Boolean).map(Number))];
    const errors = [];
    const pac = db.prepare('SELECT id FROM pacientes WHERE id = ?').get(Number(b.paciente_id));
    if (!pac) errors.push('Paciente inexistente');
    if (!ids.length) errors.push('Seleccione al menos un examen');
    for (const id of ids) {
      const e = db.prepare('SELECT activo FROM lab_examenes WHERE id = ?').get(id);
      if (!e) errors.push(`Examen ${id} inexistente`);
      else if (!e.activo) errors.push(`El examen ${id} está inactivo`);
    }
    if (b.fecha_toma && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(b.fecha_toma).replace('T', ' '))) errors.push('Fecha de toma inválida');
    if (b.prioridad && !['Normal', 'Urgente'].includes(b.prioridad)) errors.push('Prioridad inválida');
    if (errors.length) return bad(res, ...errors);

    const creadas = tx(db, () => ids.map((examenId) => {
      const fechaToma = b.fecha_toma ? String(b.fecha_toma).replace('T', ' ') : null;
      const id = Number(db.prepare(`INSERT INTO lab_ordenes (paciente_id, examen_id, fecha_solicitud, fecha_toma, solicitante, prioridad, estado, observaciones, token)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(pac.id, examenId, now(), fechaToma, b.solicitante || req.user.nombre, b.prioridad || 'Normal',
        fechaToma ? 'Muestra tomada' : 'Solicitado', b.observaciones || null, crypto.randomBytes(18).toString('base64url')).lastInsertRowid);
      db.prepare('UPDATE lab_ordenes SET codigo = ? WHERE id = ?').run(`LAB-${now().slice(0, 4)}-${String(id).padStart(6, '0')}`, id);
      return id;
    }));
    res.status(201).json(creadas.map((id) => getOrden(id, req)));
  });

  app.post('/api/lab/ordenes/:id/muestra', (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (o.estado !== 'Solicitado') return bad(res, 'La muestra ya fue registrada');
    const fecha = String((req.body || {}).fecha_toma || now()).replace('T', ' ');
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(fecha)) return bad(res, 'Fecha de toma inválida');
    db.prepare("UPDATE lab_ordenes SET estado = 'Muestra tomada', fecha_toma = ? WHERE id = ?").run(fecha, o.id);
    res.json(getOrden(o.id, req));
  });

  app.put('/api/lab/ordenes/:id/resultados', requireRole(CLINICOS), (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (CERRADOS.includes(o.estado)) return bad(res, `No se pueden modificar resultados de una orden ${o.estado.toLowerCase()}`);
    const { valores = {}, conclusion } = req.body || {};
    if (typeof valores !== 'object' || Array.isArray(valores)) return bad(res, 'Formato de valores inválido');
    const desconocidos = Object.keys(valores).filter((k) => !o.parametros.some((p) => p.nombre === k));
    if (desconocidos.length) return bad(res, `Parámetros desconocidos: ${desconocidos.join(', ')}`);
    const malos = o.parametros.filter((p) => p.tipo !== 'texto' && String(valores[p.nombre] ?? '').trim() !== '' && toNumber(valores[p.nombre]) === null);
    if (malos.length) return bad(res, ...malos.map((p) => `${p.nombre} debe ser numérico`));
    const resultados = armarResultados(o.parametros, valores, o.especie);
    db.prepare("UPDATE lab_ordenes SET resultados = ?, conclusion = ?, estado = 'En proceso', fecha_toma = COALESCE(fecha_toma, ?) WHERE id = ?")
      .run(JSON.stringify(resultados), conclusion ? String(conclusion).slice(0, 4000) : null, now(), o.id);
    res.json(getOrden(o.id, req));
  });

  app.post('/api/lab/ordenes/:id/validar', requireRole(CLINICOS), (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (o.estado !== 'En proceso') return bad(res, 'Solo se validan órdenes con resultados en proceso');
    const faltan = o.parametros.filter((p) => p.tipo !== 'texto' && !o.resultados.some((r) => r.parametro === p.nombre && r.valor !== ''));
    if (faltan.length) return bad(res, `Faltan resultados: ${faltan.map((p) => p.nombre).join(', ')}`);
    db.prepare("UPDATE lab_ordenes SET estado = 'Validado', validado_por = ?, fecha_validacion = ? WHERE id = ?").run(req.user.nombre, now(), o.id);
    res.json(getOrden(o.id, req));
  });

  app.post('/api/lab/ordenes/:id/entregar', (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (o.estado !== 'Validado') return bad(res, 'Solo se entregan resultados validados');
    db.prepare("UPDATE lab_ordenes SET estado = 'Entregado' WHERE id = ?").run(o.id);
    res.json(getOrden(o.id, req));
  });

  app.post('/api/lab/ordenes/:id/reabrir', requireRole('admin'), (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (!['Validado', 'Entregado'].includes(o.estado)) return bad(res, 'Solo se reabren resultados validados o entregados');
    db.prepare("UPDATE lab_ordenes SET estado = 'En proceso', validado_por = NULL, fecha_validacion = NULL WHERE id = ?").run(o.id);
    res.json(getOrden(o.id, req));
  });

  app.post('/api/lab/ordenes/:id/anular', (req, res) => {
    const o = getOrden(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    if (o.estado === 'Anulado') return bad(res, 'La orden ya está anulada');
    if (['Validado', 'Entregado'].includes(o.estado) && req.user.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede anular resultados validados' });
    }
    db.prepare("UPDATE lab_ordenes SET estado = 'Anulado' WHERE id = ?").run(o.id);
    res.json(getOrden(o.id, req));
  });

  // Código QR que apunta a la página pública de verificación del resultado
  app.get('/api/lab/ordenes/:id/qr.svg', async (req, res) => {
    const o = getOrden(req.params.id, req);
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
    const svg = await QRCode.toString(o.url_verificacion, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d47a1', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(svg);
  });
}

module.exports = { initLabDb, registerLab, registerLabPublic, armarResultados, interpretar, referencia, toNumber, ESTADOS };
