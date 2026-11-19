const request = require('supertest');
const { createApp } = require('../src/app');

const ADMIN_PASSWORD = 'admin-test-123';
// Firma PNG válida mínima para pruebas (data URL con más de 100 caracteres base64)
const FIRMA = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='.padEnd(140, 'A');

async function setup() {
  const app = createApp({ dbFile: ':memory:', adminPassword: ADMIN_PASSWORD });
  const admin = request.agent(app);
  await admin.post('/api/login').send({ usuario: 'admin', password: ADMIN_PASSWORD }).expect(200);
  return { app, admin };
}

async function loginAs(app, admin, rol) {
  const usuario = `${rol}1`;
  await admin.post('/api/usuarios').send({ nombre: `Usuario ${rol}`, usuario, password: 'clave-segura-1', rol }).expect(201);
  const agent = request.agent(app);
  await agent.post('/api/login').send({ usuario, password: 'clave-segura-1' }).expect(200);
  return agent;
}

async function crearBase(admin) {
  const prop = (await admin.post('/api/propietarios').send({ nombre: 'Ana Gómez', documento: '1020304050', telefono: '3001234567' }).expect(201)).body;
  const pac = (await admin.post('/api/pacientes').send({ nombre: 'Firulais', especie: 'Canino', propietario_id: prop.id }).expect(201)).body;
  return { prop, pac };
}

module.exports = { setup, loginAs, crearBase, ADMIN_PASSWORD, FIRMA };
