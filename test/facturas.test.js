const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { setup, loginAs, crearBase } = require('./helpers');

describe('Facturación, presupuestos e inventario', () => {
  let app;
  let admin;
  let prop;
  let pac;
  let antipulgas;
  let consulta;
  let proveedor;

  const stock = async (id) => (await admin.get(`/api/productos/${id}`).expect(200)).body.stock;

  before(async () => {
    ({ app, admin } = await setup());
    ({ prop, pac } = await crearBase(admin));
    antipulgas = (await admin.post('/api/productos').send({ nombre: 'Antipulgas', categoria: 'Medicamento', stock: 10, stock_minimo: 2, precio: 50000, iva: '19' }).expect(201)).body;
    consulta = (await admin.post('/api/productos').send({ nombre: 'Consulta general', categoria: 'Servicio', stock: 0, precio: 60000 }).expect(201)).body;
    proveedor = (await admin.post('/api/proveedores').send({ nombre: 'Distribuidora Vet SAS', nit: '900123456-1' }).expect(201)).body;
  });

  test('crea factura pagada: calcula IVA, descuento, numeración y descuenta stock', async () => {
    const res = await admin.post('/api/facturas').send({
      tipo: 'Factura', propietario_id: prop.id, paciente_id: pac.id, fecha: '2026-11-18', metodo_pago: 'Efectivo', descuento: 10000,
      items: [{ producto_id: antipulgas.id, cantidad: 2 }, { producto_id: consulta.id, cantidad: 1 }],
    }).expect(201);
    const f = res.body;
    assert.equal(f.numero, 'FV-000001');
    assert.equal(f.estado, 'Pagada');
    assert.equal(f.subtotal, 160000);
    assert.equal(f.impuestos, 19000); // 19% de 100.000 (antipulgas)
    assert.equal(f.total, 169000);
    assert.equal(f.items.length, 2);
    assert.equal(f.items[0].descripcion, 'Antipulgas');
    assert.equal(await stock(antipulgas.id), 8);
    assert.equal(await stock(consulta.id), 0, 'los servicios no descuentan stock');
  });

  test('rechaza factura con stock insuficiente sin modificar nada', async () => {
    const res = await admin.post('/api/facturas').send({
      tipo: 'Factura', propietario_id: prop.id, fecha: '2026-11-18', items: [{ producto_id: antipulgas.id, cantidad: 50 }],
    }).expect(400);
    assert.match(res.body.errors[0], /Stock insuficiente/);
    assert.equal(await stock(antipulgas.id), 8);
  });

  test('valida ítems, descuento y paciente del cliente', async () => {
    const base = { tipo: 'Factura', propietario_id: prop.id, fecha: '2026-11-18' };
    await admin.post('/api/facturas').send({ ...base, items: [] }).expect(400);
    await admin.post('/api/facturas').send({ ...base, items: [{ descripcion: 'X', cantidad: 0, precio: 1 }] }).expect(400);
    await admin.post('/api/facturas').send({ ...base, descuento: 999999, items: [{ descripcion: 'X', cantidad: 1, precio: 1 }] }).expect(400);
    const otro = (await admin.post('/api/propietarios').send({ nombre: 'Luis', documento: '79', telefono: '3100000000' }).expect(201)).body;
    const r = await admin.post('/api/facturas').send({ ...base, propietario_id: otro.id, paciente_id: pac.id, items: [{ descripcion: 'X', cantidad: 1, precio: 1 }] }).expect(400);
    assert.match(r.body.errors[0], /no pertenece/);
  });

  test('factura pendiente se puede pagar después', async () => {
    const f = (await admin.post('/api/facturas').send({
      tipo: 'Factura', propietario_id: prop.id, fecha: '2026-11-18', items: [{ descripcion: 'Baño', cantidad: 1, precio: 35000 }],
    }).expect(201)).body;
    assert.equal(f.estado, 'Pendiente');
    const dash = (await admin.get('/api/dashboard').expect(200)).body;
    assert.equal(dash.por_cobrar, 35000);
    await admin.post(`/api/facturas/${f.id}/pagar`).send({ metodo_pago: 'Bitcoin' }).expect(400);
    const pagada = (await admin.post(`/api/facturas/${f.id}/pagar`).send({ metodo_pago: 'Nequi' }).expect(200)).body;
    assert.equal(pagada.estado, 'Pagada');
    await admin.post(`/api/facturas/${f.id}/pagar`).send({ metodo_pago: 'Nequi' }).expect(400);
  });

  test('presupuesto no descuenta stock y se convierte en factura', async () => {
    const p = (await admin.post('/api/facturas').send({
      tipo: 'Presupuesto', propietario_id: prop.id, paciente_id: pac.id, fecha: '2026-11-18',
      items: [{ producto_id: antipulgas.id, cantidad: 3 }],
    }).expect(201)).body;
    assert.equal(p.numero, 'COT-000001');
    assert.equal(p.estado, 'Borrador');
    assert.equal(await stock(antipulgas.id), 8);

    const f = (await admin.post(`/api/facturas/${p.id}/convertir`).send({ metodo_pago: 'Tarjeta' }).expect(201)).body;
    assert.equal(f.tipo, 'Factura');
    assert.equal(f.estado, 'Pagada');
    assert.match(f.notas, /COT-000001/);
    assert.equal(await stock(antipulgas.id), 5);
    const original = (await admin.get(`/api/facturas/${p.id}`).expect(200)).body;
    assert.equal(original.estado, 'Facturado');
    await admin.post(`/api/facturas/${p.id}/convertir`).send({}).expect(400);
  });

  test('anular factura devuelve el stock; solo admin puede anular', async () => {
    const f = (await admin.post('/api/facturas').send({
      tipo: 'Factura', propietario_id: prop.id, fecha: '2026-11-18', metodo_pago: 'Efectivo', items: [{ producto_id: antipulgas.id, cantidad: 2 }],
    }).expect(201)).body;
    assert.equal(await stock(antipulgas.id), 3);
    const recep = await loginAs(app, admin, 'recepcion');
    await recep.post(`/api/facturas/${f.id}/anular`).expect(403);
    const anulada = (await admin.post(`/api/facturas/${f.id}/anular`).expect(200)).body;
    assert.equal(anulada.estado, 'Anulada');
    assert.equal(await stock(antipulgas.id), 5);
    await admin.post(`/api/facturas/${f.id}/anular`).expect(400);
  });

  test('lista y busca facturas', async () => {
    const all = (await admin.get('/api/facturas').expect(200)).body;
    assert.ok(all.length >= 4);
    const presup = (await admin.get('/api/facturas?tipo=Presupuesto').expect(200)).body;
    assert.equal(presup.length, 1);
    const q = (await admin.get('/api/facturas?q=FV-000001').expect(200)).body;
    assert.equal(q[0].propietario_nombre, 'Ana Gómez');
    await admin.get('/api/facturas/9999').expect(404);
  });

  test('compras suman stock; no se edita la cantidad; eliminar revierte', async () => {
    const c = (await admin.post('/api/compras').send({
      proveedor_id: proveedor.id, producto_id: antipulgas.id, fecha: '2026-11-18', cantidad: 20, costo_unitario: 30000, factura_proveedor: 'A-123',
    }).expect(201)).body;
    assert.equal(await stock(antipulgas.id), 25);
    const r = await admin.put(`/api/compras/${c.id}`).send({ cantidad: 50 }).expect(400);
    assert.match(r.body.errors[0], /no se puede modificar/);
    await admin.put(`/api/compras/${c.id}`).send({ factura_proveedor: 'A-124' }).expect(200);
    await admin.delete(`/api/compras/${c.id}`).expect(204);
    assert.equal(await stock(antipulgas.id), 5);
  });

  test('no permite eliminar una compra si el stock ya se vendió', async () => {
    const c = (await admin.post('/api/compras').send({
      proveedor_id: proveedor.id, producto_id: consulta.id, fecha: '2026-11-18', cantidad: 2, costo_unitario: 1,
    }).expect(201)).body;
    await admin.put(`/api/productos/${consulta.id}`).send({ stock: 0 }).expect(200);
    const res = await admin.delete(`/api/compras/${c.id}`).expect(409);
    assert.match(res.body.errors[0], /solo tiene/);
  });

  test('reportes calculan KPIs desde las facturas válidas', async () => {
    const r = (await admin.get('/api/reportes?desde=2026-11-01&hasta=2026-11-30').expect(200)).body;
    // Válidas: 169.000 + 35.000 + factura del presupuesto (150.000 + 28.500 IVA)
    assert.equal(r.kpis.facturas, 3);
    assert.equal(r.kpis.ingresos, 169000 + 35000 + 178500);
    assert.equal(r.kpis.ticket_promedio, Math.round((169000 + 35000 + 178500) / 3));
    assert.equal(r.top_productos[0].descripcion, 'Antipulgas');
    assert.ok(r.por_metodo.some((m) => m.metodo_pago === 'Nequi'));
  });
});
