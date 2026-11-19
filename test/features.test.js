const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { today, addDays, whatsappNumber } = require('../src/app');
const { setup, crearBase, FIRMA } = require('./helpers');

describe('Sala de espera, recordatorios, consentimientos y reservas en línea', () => {
  let app;
  let admin;
  let prop;
  let pac;
  const manana = addDays(today(), 1);

  before(async () => {
    ({ app, admin } = await setup());
    ({ prop, pac } = await crearBase(admin));
  });

  test('whatsappNumber normaliza celulares colombianos', () => {
    assert.equal(whatsappNumber('300 123 4567'), '573001234567');
    assert.equal(whatsappNumber('+57 300-123-4567'), '573001234567');
    assert.equal(whatsappNumber('601234'), null);
  });

  test('addDays suma días en fechas ISO', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  test('sala de espera ordena por triage y luego por llegada', async () => {
    const hoy = today();
    const mk = (hora, extra) => admin.post('/api/citas').send({ paciente_id: pac.id, fecha: hoy, hora, motivo: `m${hora}`, ...extra }).expect(201);
    await mk('08:00', { estado: 'En sala de espera', hora_llegada: '07:50' });
    await mk('08:30', { estado: 'En sala de espera', hora_llegada: '08:10', triage: 'Urgente' });
    await mk('09:00', { estado: 'Solicitada' });
    await mk('09:30', { estado: 'Cancelada' });
    const res = (await admin.get('/api/sala-espera').expect(200)).body;
    assert.equal(res.length, 2, 'excluye solicitadas y canceladas');
    assert.equal(res[0].triage, 'Urgente');
    assert.equal(res[0].paciente_id_label, 'Firulais');
    const dash = (await admin.get('/api/dashboard').expect(200)).body;
    assert.equal(dash.totales.en_espera, 2);
    assert.equal(dash.totales.solicitudes, 1);
  });

  test('recordatorios de vacunas y citas con enlace de WhatsApp', async () => {
    await admin.post('/api/vacunas').send({ paciente_id: pac.id, vacuna: 'Rabia', fecha_aplicacion: '2025-11-20', proxima_dosis: addDays(today(), 3) }).expect(201);
    await admin.post('/api/vacunas').send({ paciente_id: pac.id, vacuna: 'Parvovirus', fecha_aplicacion: '2025-10-01', proxima_dosis: addDays(today(), -5) }).expect(201);
    // Parvovirus ya fue re-aplicada: no debe recordarse
    await admin.post('/api/vacunas').send({ paciente_id: pac.id, vacuna: 'Parvovirus', fecha_aplicacion: today(), proxima_dosis: addDays(today(), 365) }).expect(201);
    await admin.post('/api/citas').send({ paciente_id: pac.id, fecha: manana, hora: '10:00', motivo: 'Control post', estado: 'Confirmada' }).expect(201);

    const rec = (await admin.get('/api/recordatorios').expect(200)).body;
    const vac = rec.filter((r) => r.tipo === 'Vacuna');
    assert.equal(vac.length, 1);
    assert.equal(vac[0].detalle, 'Vacuna: Rabia');
    assert.match(vac[0].whatsapp, /^https:\/\/wa\.me\/573001234567\?text=/);
    assert.match(decodeURIComponent(vac[0].whatsapp), /Firulais/);
    const cita = rec.find((r) => r.tipo === 'Cita' && r.fecha === manana);
    assert.ok(cita);
    assert.match(cita.mensaje, /10:00/);
  });

  test('consentimiento exige firma y no la expone en el CSV', async () => {
    const base = { paciente_id: pac.id, fecha: today(), tipo: 'Cirugía', texto: 'Autorizo el procedimiento...', firmante: 'Ana Gómez', documento_firmante: '1020304050' };
    await admin.post('/api/consentimientos').send(base).expect(400);
    const c = (await admin.post('/api/consentimientos').send({ ...base, firma: FIRMA }).expect(201)).body;
    assert.ok(c.firma.startsWith('data:image/png;base64,'));
    const csv = (await admin.get('/api/consentimientos/export').expect(200)).text;
    assert.match(csv, /;Firmado;/);
    assert.doesNotMatch(csv, /base64/);
    const hist = (await admin.get(`/api/pacientes/${pac.id}/historia`).expect(200)).body;
    assert.equal(hist.consentimientos.length, 1);
    assert.equal(hist.consentimientos[0].firma, undefined, 'la historia no carga la imagen de la firma');
  });

  test('productos por vencer aparecen en el tablero', async () => {
    await admin.post('/api/productos').send({ nombre: 'Vacuna triple', categoria: 'Vacuna', stock: 5, precio: 40000, vencimiento: addDays(today(), 10) }).expect(201);
    const dash = (await admin.get('/api/dashboard').expect(200)).body;
    assert.equal(dash.por_vencer[0].nombre, 'Vacuna triple');
  });

  describe('Reserva pública de citas', () => {
    const publico = () => request(app);

    test('datos de la clínica y disponibilidad sin sesión', async () => {
      await admin.put('/api/configuracion').send({ hora_apertura: '08:00', hora_cierre: '12:00', duracion_cita: '60' }).expect(200);
      const info = (await publico().get('/api/publico/clinica').expect(200)).body;
      assert.ok(info.nombre_clinica);
      assert.equal(info.nit, undefined, 'no expone datos internos');
      const disp = (await publico().get(`/api/publico/disponibilidad?fecha=${manana}`).expect(200)).body;
      // 08, 09, 10, 11 menos las 10:00 ocupadas por la cita confirmada
      assert.deepEqual(disp.horas, ['08:00', '09:00', '11:00']);
      await publico().get('/api/publico/disponibilidad?fecha=2020-01-01').expect(400);
    });

    test('reserva crea propietario, paciente y cita "Solicitada"', async () => {
      const res = await publico().post('/api/publico/reservar').send({
        nombre: 'Carlos Ruiz', documento: '80111222', telefono: '3157778888', mascota: 'Luna', especie: 'Felino',
        fecha: manana, hora: '09:00', motivo: 'Vacunación',
      }).expect(201);
      assert.match(res.body.mensaje, /Solicitud recibida/);
      const citas = (await admin.get(`/api/citas?fecha=${manana}&estado=Solicitada`).expect(200)).body;
      assert.equal(citas.length, 1);
      assert.equal(citas[0].paciente_id_label, 'Luna');
      const disp = (await publico().get(`/api/publico/disponibilidad?fecha=${manana}`).expect(200)).body;
      assert.ok(!disp.horas.includes('09:00'), 'el horario reservado ya no está disponible');
    });

    test('reutiliza propietario y mascota existentes por documento', async () => {
      await publico().post('/api/publico/reservar').send({
        nombre: 'Ana', documento: prop.documento, telefono: '3001234567', mascota: 'firulais', especie: 'Canino',
        fecha: manana, hora: '08:00', motivo: 'Control',
      }).expect(201);
      const pacientes = (await admin.get(`/api/pacientes?propietario_id=${prop.id}`).expect(200)).body;
      assert.equal(pacientes.length, 1);
    });

    test('rechaza horario ocupado, datos incompletos y especie inválida', async () => {
      const base = { nombre: 'X', documento: '1', telefono: '3', mascota: 'Y', especie: 'Canino', fecha: manana, hora: '09:00', motivo: 'Z' };
      const r = await publico().post('/api/publico/reservar').send(base).expect(400);
      assert.match(r.body.errors[0], /no está disponible/);
      await publico().post('/api/publico/reservar').send({ ...base, nombre: '' }).expect(400);
      await publico().post('/api/publico/reservar').send({ ...base, hora: '11:00', especie: 'Dragón' }).expect(400);
    });

    test('las rutas públicas no dan acceso al resto de la API', async () => {
      const trav = await publico().get('/api/publico/../pacientes');
      assert.notEqual(trav.status, 200);
      assert.ok(!Array.isArray(trav.body));
      await publico().get('/api/citas').expect(401);
    });
  });
});
