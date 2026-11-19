const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { interpretar, referencia, toNumber, armarResultados } = require('../src/laboratorio');
const { setup, loginAs, crearBase } = require('./helpers');

describe('Funciones de interpretación de resultados', () => {
  test('toNumber acepta coma decimal y rechaza texto', () => {
    assert.equal(toNumber('12,5'), 12.5);
    assert.equal(toNumber(' 7 '), 7);
    assert.equal(toNumber('abc'), null);
    assert.equal(toNumber(''), null);
  });

  test('referencia según especie', () => {
    const p = { nombre: 'Hto', can: [37, 55], fel: [30, 45] };
    assert.deepEqual(referencia(p, 'Canino'), [37, 55]);
    assert.deepEqual(referencia(p, 'Felino'), [30, 45]);
    assert.equal(referencia(p, 'Ave'), null);
    assert.equal(referencia({ nombre: 'Color', tipo: 'texto' }, 'Canino'), null);
  });

  test('interpretar marca Alto, Bajo y Normal incluyendo los límites', () => {
    assert.equal(interpretar('60', [37, 55]), 'Alto');
    assert.equal(interpretar('30', [37, 55]), 'Bajo');
    assert.equal(interpretar('37', [37, 55]), 'Normal');
    assert.equal(interpretar('55', [37, 55]), 'Normal');
    assert.equal(interpretar('', [37, 55]), null);
    assert.equal(interpretar('40', null), null);
  });

  test('armarResultados usa el intervalo de la especie del paciente', () => {
    const params = [{ nombre: 'Hematocrito', unidad: '%', can: [37, 55], fel: [30, 45] }, { nombre: 'Hemoparásitos', tipo: 'texto', normal: 'No se observan' }];
    const felino = armarResultados(params, { Hematocrito: '35', 'Hemoparásitos': 'No se observan' }, 'Felino');
    assert.equal(felino[0].interpretacion, 'Normal');
    assert.equal(felino[0].ref_min, 30);
    const canino = armarResultados(params, { Hematocrito: '35' }, 'Canino');
    assert.equal(canino[0].interpretacion, 'Bajo');
    assert.equal(canino[1].tipo, 'texto');
    assert.equal(canino[1].normal, 'No se observan');
  });
});

describe('Módulo de laboratorio clínico', () => {
  let app;
  let admin;
  let pac;
  let hemograma;
  let coprologico;
  let orden;

  before(async () => {
    ({ app, admin } = await setup());
    ({ pac } = await crearBase(admin)); // Firulais, Canino
    const cat = (await admin.get('/api/lab/catalogo').expect(200)).body;
    hemograma = cat.find((e) => e.codigo === 'HEM-01');
    coprologico = cat.find((e) => e.codigo === 'PAR-01');
  });

  test('catálogo inicial con las 12 categorías de un laboratorio veterinario', async () => {
    const cats = (await admin.get('/api/lab/categorias').expect(200)).body;
    assert.equal(cats.length, 12);
    const cat = (await admin.get('/api/lab/catalogo').expect(200)).body;
    assert.ok(cat.length >= 12);
    assert.ok(hemograma.parametros.some((p) => p.nombre === 'Hematocrito' && p.unidad === '%'));
    assert.ok(hemograma.muestra.includes('EDTA'));
  });

  test('solo admin edita el catálogo y se validan los intervalos', async () => {
    const vet = await loginAs(app, admin, 'veterinario');
    const nuevo = { codigo: 'QS-99', nombre: 'Lipasa', categoria: 'Química sanguínea', precio: 40000, parametros: [{ nombre: 'Lipasa', unidad: 'U/L', can: [200, 1800], fel: [0, 200] }] };
    await vet.post('/api/lab/catalogo').send(nuevo).expect(403);
    await admin.post('/api/lab/catalogo').send({ ...nuevo, parametros: [{ nombre: 'Lipasa', can: [10, 5] }] }).expect(400);
    await admin.post('/api/lab/catalogo').send({ ...nuevo, categoria: 'Magia' }).expect(400);
    const e = (await admin.post('/api/lab/catalogo').send(nuevo).expect(201)).body;
    assert.equal(e.parametros[0].fel[1], 200);
    await admin.post('/api/lab/catalogo').send(nuevo).expect(400); // código repetido
    const off = (await admin.put(`/api/lab/catalogo/${e.id}`).send({ activo: false }).expect(200)).body;
    assert.equal(off.activo, false);
    const activos = (await admin.get('/api/lab/catalogo?activos=1').expect(200)).body;
    assert.ok(!activos.some((x) => x.id === e.id));
    const r = await admin.post('/api/lab/ordenes').send({ paciente_id: pac.id, examen_ids: [e.id] }).expect(400);
    assert.match(r.body.errors[0], /inactivo/);
  });

  test('crea varias órdenes a la vez con código y token únicos', async () => {
    const res = await admin.post('/api/lab/ordenes').send({
      paciente_id: pac.id, examen_ids: [hemograma.id, coprologico.id], solicitante: 'Dra. Ruiz', prioridad: 'Urgente',
    }).expect(201);
    assert.equal(res.body.length, 2);
    [orden] = res.body;
    assert.match(orden.codigo, /^LAB-\d{4}-\d{6}$/);
    assert.equal(orden.estado, 'Solicitado');
    assert.equal(orden.prioridad, 'Urgente');
    assert.notEqual(res.body[0].token, res.body[1].token);
    assert.ok(orden.token.length >= 20);
    assert.match(orden.url_verificacion, new RegExp(`/resultado\\.html\\?t=${orden.token}$`));
  });

  test('valida datos de la orden', async () => {
    await admin.post('/api/lab/ordenes').send({ paciente_id: 9999, examen_ids: [hemograma.id] }).expect(400);
    await admin.post('/api/lab/ordenes').send({ paciente_id: pac.id, examen_ids: [] }).expect(400);
    await admin.post('/api/lab/ordenes').send({ paciente_id: pac.id, examen_ids: [hemograma.id], prioridad: 'Ya' }).expect(400);
  });

  test('el listado no expone el token de verificación', async () => {
    const list = (await admin.get('/api/lab/ordenes?pendientes=1').expect(200)).body;
    assert.ok(list.length >= 2);
    assert.ok(list.every((o) => o.token === undefined));
    assert.equal(list[0].prioridad, 'Urgente');
  });

  test('registrar toma de muestra', async () => {
    const o = (await admin.post(`/api/lab/ordenes/${orden.id}/muestra`).send({ fecha_toma: '2026-11-18T09:15' }).expect(200)).body;
    assert.equal(o.estado, 'Muestra tomada');
    assert.equal(o.fecha_toma, '2026-11-18 09:15');
    await admin.post(`/api/lab/ordenes/${orden.id}/muestra`).send({}).expect(400);
  });

  test('recepción no puede registrar ni validar resultados', async () => {
    const recep = await loginAs(app, admin, 'recepcion');
    await recep.put(`/api/lab/ordenes/${orden.id}/resultados`).send({ valores: { Hematocrito: '40' } }).expect(403);
    await recep.post(`/api/lab/ordenes/${orden.id}/validar`).expect(403);
  });

  test('registra resultados, calcula interpretación y rechaza datos inválidos', async () => {
    await admin.put(`/api/lab/ordenes/${orden.id}/resultados`).send({ valores: { Inventado: '1' } }).expect(400);
    await admin.put(`/api/lab/ordenes/${orden.id}/resultados`).send({ valores: { Hematocrito: 'alto' } }).expect(400);
    const o = (await admin.put(`/api/lab/ordenes/${orden.id}/resultados`).send({
      valores: { Hematocrito: '32', Hemoglobina: '13,5', Leucocitos: '21' }, conclusion: 'Anemia leve con leucocitosis',
    }).expect(200)).body;
    assert.equal(o.estado, 'En proceso');
    const r = Object.fromEntries(o.resultados.map((x) => [x.parametro, x]));
    assert.equal(r.Hematocrito.interpretacion, 'Bajo');
    assert.equal(r.Hemoglobina.interpretacion, 'Normal');
    assert.equal(r.Leucocitos.interpretacion, 'Alto');
    assert.equal(r.Leucocitos.ref_max, 17);
  });

  test('no valida si faltan parámetros numéricos', async () => {
    const r = await admin.post(`/api/lab/ordenes/${orden.id}/validar`).expect(400);
    assert.match(r.body.errors[0], /Faltan resultados/);
  });

  test('antes de validar, la verificación pública no muestra el resultado', async () => {
    await request(app).get(`/api/publico/resultado/${orden.token}`).expect(404);
  });

  test('valida el resultado y genera código QR y enlace de WhatsApp', async () => {
    const valores = Object.fromEntries(hemograma.parametros.filter((p) => p.tipo !== 'texto').map((p) => [p.nombre, String(p.can[0])]));
    valores.Hematocrito = '32';
    valores['Hemoparásitos'] = 'No se observan';
    await admin.put(`/api/lab/ordenes/${orden.id}/resultados`).send({ valores, conclusion: 'Anemia leve' }).expect(200);
    const o = (await admin.post(`/api/lab/ordenes/${orden.id}/validar`).expect(200)).body;
    assert.equal(o.estado, 'Validado');
    assert.equal(o.validado_por, 'Administrador');
    assert.ok(o.fecha_validacion);
    assert.match(o.whatsapp, /^https:\/\/wa\.me\/573001234567\?text=/);
    assert.match(decodeURIComponent(o.whatsapp), /resultado\.html\?t=/);

    const qr = await admin.get(`/api/lab/ordenes/${orden.id}/qr.svg`).expect(200);
    assert.match(qr.headers['content-type'], /image\/svg\+xml/);
    assert.match(String(qr.body), /<svg/);
    await request(app).get(`/api/lab/ordenes/${orden.id}/qr.svg`).expect(401);
  });

  test('resultado validado no se puede modificar', async () => {
    await admin.put(`/api/lab/ordenes/${orden.id}/resultados`).send({ valores: { Hematocrito: '50' } }).expect(400);
  });

  test('verificación pública por token muestra datos mínimos', async () => {
    const r = (await request(app).get(`/api/publico/resultado/${orden.token}`).expect(200)).body;
    assert.equal(r.codigo, orden.codigo);
    assert.equal(r.paciente, 'Firulais');
    assert.equal(r.examen, 'Cuadro hemático completo');
    assert.equal(r.propietario, 'Ana G.', 'oculta el apellido');
    assert.equal(r.validado_por, 'Administrador');
    assert.equal(r.resultados.find((x) => x.parametro === 'Hematocrito').interpretacion, 'Bajo');
    assert.equal(r.propietario_telefono, undefined);
    assert.equal(r.token, undefined);
    await request(app).get('/api/publico/resultado/token-falso-que-no-existe-123').expect(404);
    await request(app).get('/api/publico/resultado/x').expect(404);
  });

  test('entrega, reapertura (solo admin) y anulación', async () => {
    const vet = (await admin.get('/api/usuarios').expect(200)).body.find((u) => u.rol === 'veterinario');
    assert.ok(vet);
    const o = (await admin.post(`/api/lab/ordenes/${orden.id}/entregar`).expect(200)).body;
    assert.equal(o.estado, 'Entregado');
    await request(app).get(`/api/publico/resultado/${orden.token}`).expect(200);

    const reabierta = (await admin.post(`/api/lab/ordenes/${orden.id}/reabrir`).expect(200)).body;
    assert.equal(reabierta.estado, 'En proceso');
    assert.equal(reabierta.validado_por, null);
    await request(app).get(`/api/publico/resultado/${orden.token}`).expect(404);

    const otra = (await admin.get('/api/lab/ordenes').expect(200)).body.find((x) => x.examen_codigo === 'PAR-01');
    const anulada = (await admin.post(`/api/lab/ordenes/${otra.id}/anular`).expect(200)).body;
    assert.equal(anulada.estado, 'Anulado');
    await admin.post(`/api/lab/ordenes/${otra.id}/anular`).expect(400);
  });

  test('aparece en la historia clínica y en el tablero', async () => {
    const h = (await admin.get(`/api/pacientes/${pac.id}/historia`).expect(200)).body;
    assert.equal(h.laboratorio.length, 1, 'excluye anuladas');
    assert.equal(h.laboratorio[0].examen, 'Cuadro hemático completo');
    const d = (await admin.get('/api/dashboard').expect(200)).body;
    assert.equal(d.totales.lab_pendientes, 1);
  });

  test('URL pública configurable para el QR', async () => {
    await admin.put('/api/configuracion').send({ url_publica: 'ftp://malo' }).expect(400);
    await admin.put('/api/configuracion').send({ url_publica: 'https://vet.infraestructura-it.com/' }).expect(200);
    const o = (await admin.get(`/api/lab/ordenes/${orden.id}`).expect(200)).body;
    assert.equal(o.url_verificacion, `https://vet.infraestructura-it.com/resultado.html?t=${orden.token}`);
  });
});
