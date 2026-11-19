const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { validate, today } = require('../src/app');
const resources = require('../src/resources');
const { setup } = require('./helpers');

describe('CRUD de módulos clínicos', () => {
  let admin;
  let propietario;
  let paciente;

  before(async () => { ({ admin } = await setup()); });

  test('GET /api/meta devuelve todos los módulos', async () => {
    const res = await admin.get('/api/meta').expect(200);
    for (const m of ['propietarios', 'pacientes', 'citas', 'consultas', 'recetas', 'vacunas', 'cirugias', 'hospitalizaciones',
      'guarderia', 'peluqueria', 'consentimientos', 'productos', 'proveedores', 'compras']) {
      assert.ok(res.body[m], `falta módulo ${m}`);
    }
  });

  test('crea un propietario', async () => {
    const res = await admin.post('/api/propietarios')
      .send({ nombre: 'Ana Gómez', documento: '1020304050', telefono: '3001234567', email: 'ana@correo.com' }).expect(201);
    propietario = res.body;
    assert.equal(propietario.nombre, 'Ana Gómez');
  });

  test('rechaza propietario sin campos obligatorios', async () => {
    const res = await admin.post('/api/propietarios').send({ nombre: 'X' }).expect(400);
    assert.ok(res.body.errors.some((e) => e.includes('Documento')));
    assert.ok(res.body.errors.some((e) => e.includes('Teléfono')));
  });

  test('rechaza correo inválido', async () => {
    const res = await admin.post('/api/propietarios').send({ nombre: 'B', documento: '1', telefono: '2', email: 'no-es-correo' }).expect(400);
    assert.match(res.body.errors[0], /correo/i);
  });

  test('crea un paciente con microchip y alergias', async () => {
    const res = await admin.post('/api/pacientes').send({
      nombre: 'Firulais', especie: 'Canino', raza: 'Criollo', sexo: 'Macho', peso: '12.5',
      microchip: '985112003456789', alergias: 'Penicilina', propietario_id: propietario.id,
    }).expect(201);
    paciente = res.body;
    assert.equal(paciente.peso, 12.5);
    assert.equal(paciente.propietario_id_label, 'Ana Gómez');
    assert.equal(paciente.alergias, 'Penicilina');
  });

  test('busca pacientes por microchip', async () => {
    const res = await admin.get('/api/pacientes?q=985112').expect(200);
    assert.equal(res.body.length, 1);
  });

  test('rechaza especie fuera de la lista y propietario inexistente', async () => {
    await admin.post('/api/pacientes').send({ nombre: 'Z', especie: 'Dragón', propietario_id: propietario.id }).expect(400);
    await admin.post('/api/pacientes').send({ nombre: 'Z', especie: 'Felino', propietario_id: 9999 }).expect(400);
  });

  test('cita con valores por defecto de estado, tipo y triage', async () => {
    const res = await admin.post('/api/citas').send({ paciente_id: paciente.id, fecha: today(), hora: '09:30', motivo: 'Control' }).expect(201);
    assert.equal(res.body.estado, 'Programada');
    assert.equal(res.body.tipo, 'Consulta');
    assert.equal(res.body.triage, 'Normal');
  });

  test('rechaza hora y fecha inválidas', async () => {
    const r1 = await admin.post('/api/citas').send({ paciente_id: paciente.id, fecha: today(), hora: '25:00', motivo: 'X' }).expect(400);
    assert.match(r1.body.errors[0], /hora/i);
    const r2 = await admin.post('/api/consultas').send({ paciente_id: paciente.id, fecha: '18/11/2026', motivo: 'Vómito' }).expect(400);
    assert.match(r2.body.errors[0], /fecha/i);
  });

  test('historia clínica incluye todos los módulos', async () => {
    await admin.post('/api/consultas').send({ paciente_id: paciente.id, fecha: '2026-11-10', motivo: 'Vómito', diagnostico: 'Gastroenteritis' }).expect(201);
    await admin.post('/api/recetas').send({ paciente_id: paciente.id, fecha: '2026-11-10', medicamentos: 'Omeprazol 1 mg/kg c/24h x 5 días', veterinario: 'Dra. Ruiz' }).expect(201);
    await admin.post('/api/vacunas').send({ paciente_id: paciente.id, vacuna: 'Rabia', fecha_aplicacion: '2026-11-01', proxima_dosis: '2027-11-01' }).expect(201);
    await admin.post('/api/cirugias').send({ paciente_id: paciente.id, fecha: '2026-11-12', procedimiento: 'Orquiectomía', asa: 'ASA I' }).expect(201);
    await admin.post('/api/guarderia').send({ paciente_id: paciente.id, fecha_ingreso: '2026-12-20', fecha_salida: '2026-12-27', tarifa_dia: 40000 }).expect(201);

    const res = await admin.get(`/api/pacientes/${paciente.id}/historia`).expect(200);
    assert.equal(res.body.consultas.length, 1);
    assert.equal(res.body.recetas.length, 1);
    assert.equal(res.body.cirugias[0].estado, 'Programada');
    assert.equal(res.body.guarderia[0].estado, 'Reservado');
    assert.equal(res.body.vacunas[0].tipo, 'Vacuna');
  });

  test('cirugía valida la clasificación ASA', async () => {
    await admin.post('/api/cirugias').send({ paciente_id: paciente.id, fecha: '2026-11-12', procedimiento: 'X', asa: 'ASA VI' }).expect(400);
  });

  test('historia de paciente inexistente devuelve 404', async () => {
    await admin.get('/api/pacientes/9999/historia').expect(404);
  });

  test('actualiza con PUT parcial y 404 si no existe', async () => {
    const res = await admin.put(`/api/pacientes/${paciente.id}`).send({ peso: 13 }).expect(200);
    assert.equal(res.body.peso, 13);
    assert.equal(res.body.nombre, 'Firulais');
    await admin.put('/api/pacientes/9999').send({ peso: 1 }).expect(404);
  });

  test('no permite eliminar un propietario con pacientes', async () => {
    const res = await admin.delete(`/api/propietarios/${propietario.id}`).expect(409);
    assert.match(res.body.errors[0], /dependencias/);
  });

  test('exporta CSV con BOM, separador ; y nombres de referencias', async () => {
    const res = await admin.get('/api/pacientes/export').expect(200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.ok(res.text.startsWith('﻿'));
    const [header, row] = res.text.slice(1).split('\r\n');
    assert.match(header, /^ID;Nombre;Especie/);
    assert.match(row, /Firulais;Canino/);
    assert.match(row, /Ana Gómez/);
  });

  test('filtra por rango de fechas', async () => {
    const res = await admin.get('/api/consultas?desde=2026-11-01&hasta=2026-11-30').expect(200);
    assert.equal(res.body.length, 1);
    const none = await admin.get('/api/consultas?desde=2020-01-01&hasta=2020-01-31').expect(200);
    assert.equal(none.body.length, 0);
  });

  test('sirve la interfaz web y la página de reservas', async () => {
    assert.match((await admin.get('/').expect(200)).text, /IIT Veterinaria/);
    assert.match((await admin.get('/reservar.html').expect(200)).text, /Reserva/);
  });

  test('los archivos de la interfaz se sirven sin caché para que las actualizaciones se vean al recargar', async () => {
    const js = await admin.get('/app.js').expect(200);
    assert.equal(js.headers['cache-control'], 'no-cache');
    assert.match(js.text, /🧪 Laboratorio/);
  });

  test('ruta API inexistente devuelve 404 JSON', async () => {
    const res = await admin.get('/api/no-existe').expect(404);
    assert.ok(res.body.error);
  });
});

describe('validate()', () => {
  test('convierte números y aplica defaults', () => {
    const { errors, data } = validate(resources.productos, { nombre: 'X', categoria: 'Insumo', precio: '1000' });
    assert.deepEqual(errors, []);
    assert.equal(data.precio, 1000);
    assert.equal(data.stock, 0);
    assert.equal(data.iva, '0');
  });

  test('modo parcial no exige obligatorios', () => {
    assert.deepEqual(validate(resources.productos, { precio: '5' }, true).errors, []);
  });

  test('detecta números inválidos y mínimos', () => {
    assert.match(validate(resources.productos, { nombre: 'X', categoria: 'Insumo', precio: 'abc' }).errors[0], /numérico/);
    assert.match(validate(resources.compras, { proveedor_id: 1, producto_id: 1, fecha: '2026-01-01', cantidad: 0, costo_unitario: 1 }).errors[0], /al menos 1/);
  });

  test('valida firmas como imagen PNG en base64', () => {
    const base = { paciente_id: 1, fecha: '2026-01-01', tipo: 'Cirugía', texto: 't', firmante: 'f', documento_firmante: '1' };
    assert.match(validate(resources.consentimientos, { ...base, firma: 'javascript:alert(1)' }).errors[0], /firma/i);
  });
});
