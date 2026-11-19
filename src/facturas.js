// Facturación con ítems: facturas y presupuestos, descuento/reintegro de inventario.
const { tx } = require('./db');
const { requireRole } = require('./auth');

const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi', 'Daviplata'];
const round = (n) => Math.round(n * 100) / 100;

function httpError(status, errors) {
  const e = new Error(errors.join(', '));
  e.status = status;
  e.errors = errors;
  return e;
}

function registerFacturas(app, db) {
  const selectFactura = `SELECT f.*, p.nombre AS propietario_nombre, p.documento AS propietario_documento,
      p.telefono AS propietario_telefono, p.direccion AS propietario_direccion, pa.nombre AS paciente_nombre
    FROM facturas f JOIN propietarios p ON p.id = f.propietario_id LEFT JOIN pacientes pa ON pa.id = f.paciente_id`;

  const getFactura = (id) => {
    const f = db.prepare(`${selectFactura} WHERE f.id = ?`).get(id);
    if (f) f.items = db.prepare('SELECT * FROM factura_items WHERE factura_id = ? ORDER BY id').all(id);
    return f;
  };

  /** Normaliza y valida los ítems; completa descripción/precio/IVA desde el producto. */
  function prepararItems(items) {
    if (!Array.isArray(items) || !items.length) throw httpError(400, ['Agregue al menos un ítem']);
    return items.map((it, i) => {
      const n = i + 1;
      let prod = null;
      if (it.producto_id) {
        prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(it.producto_id));
        if (!prod) throw httpError(400, [`Ítem ${n}: producto inexistente`]);
      }
      const cantidad = Number(it.cantidad);
      const precio = it.precio === undefined || it.precio === '' ? prod?.precio : Number(it.precio);
      const iva = it.iva === undefined || it.iva === '' ? Number(prod?.iva || 0) : Number(it.iva);
      const descripcion = (it.descripcion || prod?.nombre || '').trim();
      if (!descripcion) throw httpError(400, [`Ítem ${n}: descripción obligatoria`]);
      if (!(cantidad > 0)) throw httpError(400, [`Ítem ${n}: cantidad debe ser mayor a 0`]);
      if (!(precio >= 0)) throw httpError(400, [`Ítem ${n}: precio inválido`]);
      if (!(iva >= 0 && iva <= 100)) throw httpError(400, [`Ítem ${n}: IVA inválido`]);
      return { producto_id: prod?.id ?? null, descripcion, cantidad, precio, iva, total: round(cantidad * precio), prod };
    });
  }

  function descontarStock(items) {
    const porProducto = new Map();
    for (const it of items) {
      if (it.producto_id && it.prod?.categoria !== 'Servicio') {
        porProducto.set(it.producto_id, (porProducto.get(it.producto_id) || 0) + it.cantidad);
      }
    }
    for (const [id, cant] of porProducto) {
      const p = db.prepare('SELECT nombre, stock FROM productos WHERE id = ?').get(id);
      if (p.stock < cant) throw httpError(400, [`Stock insuficiente de ${p.nombre} (disponible: ${p.stock})`]);
    }
    for (const [id, cant] of porProducto) db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(cant, id);
  }

  function crear({ tipo, propietario_id, paciente_id, fecha, metodo_pago, descuento, notas, items }, usuarioId) {
    const errors = [];
    if (!['Factura', 'Presupuesto'].includes(tipo)) errors.push('Tipo inválido');
    if (!propietario_id) errors.push('Cliente es obligatorio');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) errors.push('Fecha inválida');
    if (metodo_pago && !METODOS.includes(metodo_pago)) errors.push('Método de pago inválido');
    if (errors.length) throw httpError(400, errors);
    if (!db.prepare('SELECT id FROM propietarios WHERE id = ?').get(Number(propietario_id))) throw httpError(400, ['Cliente inexistente']);
    if (paciente_id) {
      const pa = db.prepare('SELECT propietario_id FROM pacientes WHERE id = ?').get(Number(paciente_id));
      if (!pa) throw httpError(400, ['Paciente inexistente']);
      if (pa.propietario_id !== Number(propietario_id)) throw httpError(400, ['El paciente no pertenece a ese cliente']);
    }
    const lineas = prepararItems(items);
    const subtotal = round(lineas.reduce((s, l) => s + l.total, 0));
    const impuestos = round(lineas.reduce((s, l) => s + (l.total * l.iva) / 100, 0));
    const desc = round(Number(descuento) || 0);
    if (desc < 0 || desc > subtotal) throw httpError(400, ['Descuento inválido']);
    const total = round(subtotal - desc + impuestos);
    const estado = tipo === 'Presupuesto' ? 'Borrador' : metodo_pago ? 'Pagada' : 'Pendiente';

    return tx(db, () => {
      if (tipo === 'Factura') descontarStock(lineas);
      const info = db.prepare(`INSERT INTO facturas (tipo, estado, propietario_id, paciente_id, fecha, metodo_pago,
          subtotal, descuento, impuestos, total, notas, usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(tipo, estado, Number(propietario_id), paciente_id ? Number(paciente_id) : null, fecha,
          metodo_pago || null, subtotal, desc, impuestos, total, notas || null, usuarioId);
      const id = Number(info.lastInsertRowid);
      const consecutivo = db.prepare('SELECT COUNT(*) c FROM facturas WHERE tipo = ?').get(tipo).c;
      db.prepare('UPDATE facturas SET numero = ? WHERE id = ?').run(`${tipo === 'Factura' ? 'FV' : 'COT'}-${String(consecutivo).padStart(6, '0')}`, id);
      const ins = db.prepare('INSERT INTO factura_items (factura_id, producto_id, descripcion, cantidad, precio, iva, total) VALUES (?,?,?,?,?,?,?)');
      for (const l of lineas) ins.run(id, l.producto_id, l.descripcion, l.cantidad, l.precio, l.iva, l.total);
      return id;
    });
  }

  const handle = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ errors: e.errors });
      throw e;
    }
  };

  app.get('/api/facturas', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.q) { where.push('(f.numero LIKE ? OR p.nombre LIKE ? OR p.documento LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
    if (req.query.tipo) { where.push('f.tipo = ?'); params.push(req.query.tipo); }
    if (req.query.estado) { where.push('f.estado = ?'); params.push(req.query.estado); }
    if (req.query.propietario_id) { where.push('f.propietario_id = ?'); params.push(req.query.propietario_id); }
    res.json(db.prepare(`${selectFactura} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.id DESC LIMIT 500`).all(...params));
  });

  app.get('/api/facturas/:id', (req, res) => {
    const f = getFactura(req.params.id);
    if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(f);
  });

  app.post('/api/facturas', handle((req, res) => {
    const id = crear(req.body || {}, req.user.id);
    res.status(201).json(getFactura(id));
  }));

  app.post('/api/facturas/:id/pagar', handle((req, res) => {
    const f = getFactura(req.params.id);
    if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
    if (f.tipo !== 'Factura' || f.estado !== 'Pendiente') throw httpError(400, ['Solo se pueden pagar facturas pendientes']);
    const metodo = (req.body || {}).metodo_pago;
    if (!METODOS.includes(metodo)) throw httpError(400, ['Método de pago inválido']);
    db.prepare("UPDATE facturas SET estado = 'Pagada', metodo_pago = ? WHERE id = ?").run(metodo, f.id);
    res.json(getFactura(f.id));
  }));

  app.post('/api/facturas/:id/convertir', handle((req, res) => {
    const p = getFactura(req.params.id);
    if (!p) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    if (p.tipo !== 'Presupuesto' || p.estado !== 'Borrador') throw httpError(400, ['Solo se pueden facturar presupuestos en borrador']);
    const body = req.body || {};
    const id = crear({
      tipo: 'Factura', propietario_id: p.propietario_id, paciente_id: p.paciente_id,
      fecha: body.fecha || p.fecha, metodo_pago: body.metodo_pago, descuento: p.descuento,
      notas: `Desde presupuesto ${p.numero}${p.notas ? '. ' + p.notas : ''}`,
      items: p.items.map(({ producto_id, descripcion, cantidad, precio, iva }) => ({ producto_id, descripcion, cantidad, precio, iva })),
    }, req.user.id);
    db.prepare("UPDATE facturas SET estado = 'Facturado' WHERE id = ?").run(p.id);
    res.status(201).json(getFactura(id));
  }));

  app.post('/api/facturas/:id/anular', requireRole('admin'), handle((req, res) => {
    const f = getFactura(req.params.id);
    if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
    if (f.estado === 'Anulada') throw httpError(400, ['La factura ya está anulada']);
    tx(db, () => {
      if (f.tipo === 'Factura') {
        for (const it of f.items) {
          if (!it.producto_id) continue;
          const prod = db.prepare('SELECT categoria FROM productos WHERE id = ?').get(it.producto_id);
          if (prod && prod.categoria !== 'Servicio') db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(it.cantidad, it.producto_id);
        }
      }
      db.prepare("UPDATE facturas SET estado = 'Anulada' WHERE id = ?").run(f.id);
    });
    res.json(getFactura(f.id));
  }));
}

module.exports = { registerFacturas, METODOS };
