const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { hashPassword, verifyPassword } = require('../src/auth');
const { setup, loginAs, crearBase, ADMIN_PASSWORD } = require('./helpers');

describe('Autenticación y roles', () => {
  let app;
  let admin;

  before(async () => { ({ app, admin } = await setup()); });

  test('hash y verificación de contraseñas', () => {
    const h = hashPassword('secreto123');
    assert.ok(verifyPassword('secreto123', h));
    assert.ok(!verifyPassword('otro', h));
    assert.ok(!verifyPassword('x', 'basura'));
  });

  test('sin sesión la API responde 401', async () => {
    await request(app).get('/api/pacientes').expect(401);
    await request(app).get('/api/dashboard').expect(401);
  });

  test('login con credenciales incorrectas responde 401', async () => {
    await request(app).post('/api/login').send({ usuario: 'admin', password: 'mala' }).expect(401);
    await request(app).post('/api/login').send({ usuario: 'nadie', password: 'x' }).expect(401);
  });

  test('login correcto entrega cookie HttpOnly y /api/me', async () => {
    const res = await request(app).post('/api/login').send({ usuario: 'admin', password: ADMIN_PASSWORD }).expect(200);
    assert.match(res.headers['set-cookie'][0], /HttpOnly/);
    assert.equal(res.body.rol, 'admin');
    assert.equal(res.body.password_hash, undefined);
    const me = await admin.get('/api/me').expect(200);
    assert.equal(me.body.usuario, 'admin');
  });

  test('logout invalida la sesión', async () => {
    const agent = request.agent(app);
    await agent.post('/api/login').send({ usuario: 'admin', password: ADMIN_PASSWORD }).expect(200);
    await agent.post('/api/logout').expect(204);
    await agent.get('/api/me').expect(401);
  });

  test('admin crea usuarios; valida datos y duplicados', async () => {
    await admin.post('/api/usuarios').send({ nombre: 'X', usuario: 'ab', password: '123', rol: 'jefe' }).expect(400);
    await admin.post('/api/usuarios').send({ nombre: 'Dra Ruiz', usuario: 'druiz', password: 'clave-segura-1', rol: 'veterinario' }).expect(201);
    const dup = await admin.post('/api/usuarios').send({ nombre: 'Otra', usuario: 'DRUIZ', password: 'clave-segura-1', rol: 'recepcion' }).expect(400);
    assert.match(dup.body.errors[0], /ya existe/);
    const list = await admin.get('/api/usuarios').expect(200);
    assert.ok(list.body.every((u) => u.password_hash === undefined));
  });

  test('recepción no puede crear consultas clínicas ni gestionar usuarios', async () => {
    const recep = await loginAs(app, admin, 'recepcion');
    const { pac } = await crearBase(admin);
    const r = await recep.post('/api/consultas').send({ paciente_id: pac.id, fecha: '2026-11-18', motivo: 'X' }).expect(403);
    assert.match(r.body.error, /permiso/);
    await recep.get('/api/usuarios').expect(403);
    // Pero sí puede leer consultas y agendar citas
    await recep.get('/api/consultas').expect(200);
    await recep.post('/api/citas').send({ paciente_id: pac.id, fecha: '2026-11-20', hora: '10:00', motivo: 'Control' }).expect(201);
  });

  test('veterinario no puede modificar inventario pero sí registrar consultas', async () => {
    const vet = await loginAs(app, admin, 'veterinario');
    await vet.post('/api/productos').send({ nombre: 'X', categoria: 'Insumo', precio: 1 }).expect(403);
    const pac = (await admin.get('/api/pacientes').expect(200)).body[0];
    await vet.post('/api/consultas').send({ paciente_id: pac.id, fecha: '2026-11-18', motivo: 'Tos' }).expect(201);
  });

  test('usuario desactivado pierde la sesión', async () => {
    const u = (await admin.post('/api/usuarios').send({ nombre: 'Temp', usuario: 'temp1', password: 'clave-segura-1', rol: 'recepcion' }).expect(201)).body;
    const agent = request.agent(app);
    await agent.post('/api/login').send({ usuario: 'temp1', password: 'clave-segura-1' }).expect(200);
    await admin.put(`/api/usuarios/${u.id}`).send({ activo: false }).expect(200);
    await agent.get('/api/me').expect(401);
    await request(app).post('/api/login').send({ usuario: 'temp1', password: 'clave-segura-1' }).expect(401);
  });

  test('no se puede quitar el último administrador', async () => {
    const me = (await admin.get('/api/me')).body;
    const res = await admin.put(`/api/usuarios/${me.id}`).send({ rol: 'recepcion' }).expect(400);
    assert.match(res.body.errors[0], /administrador/);
  });

  test('cambio de contraseña propia', async () => {
    const agent = await loginAs(app, admin, 'admin');
    await agent.put('/api/me/password').send({ actual: 'mala', nueva: 'nueva-clave-99' }).expect(400);
    await agent.put('/api/me/password').send({ actual: 'clave-segura-1', nueva: 'corta' }).expect(400);
    await agent.put('/api/me/password').send({ actual: 'clave-segura-1', nueva: 'nueva-clave-99' }).expect(204);
    await request(app).post('/api/login').send({ usuario: 'admin1', password: 'nueva-clave-99' }).expect(200);
  });

  test('solo admin cambia la configuración', async () => {
    const recep = request.agent(app);
    await recep.post('/api/login').send({ usuario: 'recepcion1', password: 'clave-segura-1' }).expect(200);
    await recep.put('/api/configuracion').send({ nombre_clinica: 'Hack' }).expect(403);
    await admin.put('/api/configuracion').send({ hora_apertura: '99:00' }).expect(400);
    const res = await admin.put('/api/configuracion').send({ nombre_clinica: 'Clínica Patitas', telefono: '6011234567' }).expect(200);
    assert.equal(res.body.nombre_clinica, 'Clínica Patitas');
  });
});
