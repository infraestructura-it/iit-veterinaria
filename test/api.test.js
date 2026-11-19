const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp, validate, today } = require('../src/app');
const resources = require('../src/resources');

describe('API IIT Veterinaria', () => {
  let app;
  let propietario;
  let paciente;

  before(() => {
    app = createApp({ dbFile: ':memory:' });
  });

  test('GET /api/meta devuelve todos los módulos', async () => {
    const res = await request(app).get('/api/meta').expect(200);
    for (const m of ['propietarios', 'pacientes', 'citas', 'consultas', 'vacunas', 'hospitalizaciones', 'peluqueria', 'productos', 'ventas']) {
      assert.ok(res.body[m], `falta módulo ${m}`);
    }
  });

  test('crea un propietario', async () => {
    const res = await request(app).post('/api/propietarios')
      .send({ nombre: 'Ana Gómez', documento: '1020304050', telefono: '3001234567', email: 'ana@correo.com' })
      .expect(201);
    propietario = res.body;
    assert.equal(propietario.nombre, 'Ana Gómez');
    assert.ok(propietario.id);
  });

  test('rechaza propietario sin campos obligatorios', async () => {
    const res = await request(app).post('/api/propietarios').send({ nombre: 'X' }).expect(400);
    assert.ok(res.body.errors.some((e) => e.includes('Documento')));
    assert.ok(res.body.errors.some((e) => e.includes('Teléfono')));
  });

  test('rechaza correo inválido', async () => {
    const res = await request(app).post('/api/propietarios')
      .send({ nombre: 'B', documento: '1', telefono: '2', email: 'no-es-correo' }).expect(400);
    assert.match(res.body.errors[0], /correo/i);
  });

  test('crea un paciente ligado al propietario', async () => {
    const res = await request(app).post('/api/pacientes')
      .send({ nombre: 'Firulais', especie: 'Canino', raza: 'Criollo', sexo: 'Macho', peso: '12.5', propietario_id: propietario.id })
      .expect(201);
    paciente = res.body;
    assert.equal(paciente.peso, 12.5);
    assert.equal(paciente.propietario_id_label, 'Ana Gómez');
  });

  test('rechaza especie fuera de la lista', async () => {
    await request(app).post('/api/pacientes')
      .send({ nombre: 'Z', especie: 'Dragón', propietario_id: propietario.id }).expect(400);
  });

  test('rechaza paciente con propietario inexistente', async () => {
    await request(app).post('/api/pacientes')
      .send({ nombre: 'Z', especie: 'Felino', propietario_id: 9999 }).expect(400);
  });

  test('busca pacientes con ?q=', async () => {
    const res = await request(app).get('/api/pacientes?q=firu').expect(200);
    assert.equal(res.body.length, 1);
    const none = await request(app).get('/api/pacientes?q=michi').expect(200);
    assert.equal(none.body.length, 0);
  });

  test('aplica valor por defecto al estado de la cita', async () => {
    const hoy = today();
    const res = await request(app).post('/api/citas')
      .send({ paciente_id: paciente.id, fecha: hoy, hora: '09:30', motivo: 'Control' }).expect(201);
    assert.equal(res.body.estado, 'Programada');
  });

  test('rechaza fecha inválida', async () => {
    const res = await request(app).post('/api/consultas')
      .send({ paciente_id: paciente.id, fecha: '18/11/2026', motivo: 'Vómito' }).expect(400);
    assert.match(res.body.errors[0], /fecha/i);
  });

  test('registra consulta, vacuna y hospitalización y arma la historia clínica', async () => {
    await request(app).post('/api/consultas').send({
      paciente_id: paciente.id, fecha: '2026-11-10', motivo: 'Vómito', temperatura: 39.2,
      diagnostico: 'Gastroenteritis', tratamiento: 'Dieta blanda', veterinario: 'Dra. Ruiz',
    }).expect(201);
    await request(app).post('/api/vacunas').send({
      paciente_id: paciente.id, vacuna: 'Rabia', fecha_aplicacion: '2026-11-01', proxima_dosis: '2026-11-20',
    }).expect(201);
    await request(app).post('/api/hospitalizaciones').send({
      paciente_id: paciente.id, fecha_ingreso: '2026-11-10', motivo: 'Deshidratación',
    }).expect(201);

    const res = await request(app).get(`/api/pacientes/${paciente.id}/historia`).expect(200);
    assert.equal(res.body.paciente.nombre, 'Firulais');
    assert.equal(res.body.propietario.nombre, 'Ana Gómez');
    assert.equal(res.body.consultas.length, 1);
    assert.equal(res.body.vacunas[0].tipo, 'Vacuna');
    assert.equal(res.body.hospitalizaciones[0].estado, 'Hospitalizado');
  });

  test('historia de paciente inexistente devuelve 404', async () => {
    await request(app).get('/api/pacientes/9999/historia').expect(404);
  });

  test('filtra consultas por paciente_id', async () => {
    const res = await request(app).get(`/api/consultas?paciente_id=${paciente.id}`).expect(200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].paciente_id_label, 'Firulais');
  });

  test('actualiza un registro con PUT parcial', async () => {
    const res = await request(app).put(`/api/pacientes/${paciente.id}`).send({ peso: 13 }).expect(200);
    assert.equal(res.body.peso, 13);
    assert.equal(res.body.nombre, 'Firulais');
  });

  test('PUT a registro inexistente devuelve 404', async () => {
    await request(app).put('/api/pacientes/9999').send({ peso: 1 }).expect(404);
  });

  test('no permite eliminar un propietario con pacientes', async () => {
    const res = await request(app).delete(`/api/propietarios/${propietario.id}`).expect(409);
    assert.match(res.body.errors[0], /dependencias/);
  });

  test('dashboard reporta totales, stock bajo y ventas del mes', async () => {
    await request(app).post('/api/productos')
      .send({ nombre: 'Antipulgas', categoria: 'Medicamento', stock: 2, stock_minimo: 5, precio: 45000 }).expect(201);
    const hoy = today();
    await request(app).post('/api/ventas')
      .send({ propietario_id: propietario.id, fecha: hoy, concepto: 'Consulta', total: 60000 }).expect(201);

    const res = await request(app).get('/api/dashboard').expect(200);
    assert.equal(res.body.totales.pacientes, 1);
    assert.equal(res.body.totales.hospitalizados, 1);
    assert.equal(res.body.stock_bajo.length, 1);
    assert.equal(res.body.ventas_mes, 60000);
  });

  test('reportes agrupan ventas y especies', async () => {
    const res = await request(app).get('/api/reportes/ventas').expect(200);
    assert.equal(res.body.por_metodo[0].metodo_pago, 'Efectivo');
    assert.equal(res.body.por_especie[0].especie, 'Canino');
  });

  test('elimina un producto', async () => {
    const list = await request(app).get('/api/productos').expect(200);
    await request(app).delete(`/api/productos/${list.body[0].id}`).expect(204);
    await request(app).get(`/api/productos/${list.body[0].id}`).expect(404);
  });

  test('sirve la interfaz web', async () => {
    const res = await request(app).get('/').expect(200);
    assert.match(res.text, /IIT Veterinaria/);
  });
});

describe('validate()', () => {
  test('convierte números y aplica defaults', () => {
    const { errors, data } = validate(resources.productos, { nombre: 'X', categoria: 'Insumo', precio: '1000' });
    assert.deepEqual(errors, []);
    assert.equal(data.precio, 1000);
    assert.equal(data.stock, 0);
  });

  test('modo parcial no exige obligatorios', () => {
    const { errors } = validate(resources.productos, { precio: '5' }, true);
    assert.deepEqual(errors, []);
  });

  test('detecta números inválidos', () => {
    const { errors } = validate(resources.productos, { nombre: 'X', categoria: 'Insumo', precio: 'abc' });
    assert.match(errors[0], /numérico/);
  });
});
