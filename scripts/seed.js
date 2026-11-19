// Carga datos de ejemplo: npm run seed
const { createDb } = require('../src/db');
const { today, addDays } = require('../src/app');

const db = createDb();
const ins = (t, o) => {
  const k = Object.keys(o);
  return Number(db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(o)).lastInsertRowid);
};
const hoy = today();

db.exec(`INSERT OR IGNORE INTO configuracion (clave, valor) VALUES
  ('nombre_clinica','Clínica Veterinaria Patitas'),('nit','901234567-8'),('direccion','Cra 7 # 45-10, Bogotá'),
  ('telefono','601 555 1234'),('email','contacto@patitas.co')`);

const ana = ins('propietarios', { nombre: 'Ana Gómez', documento: '1020304050', telefono: '3001234567', email: 'ana@correo.com', direccion: 'Cra 7 # 45-10, Bogotá' });
const luis = ins('propietarios', { nombre: 'Luis Pérez', documento: '79888777', telefono: '3109876543', direccion: 'Calle 80 # 20-30, Bogotá' });

const firu = ins('pacientes', { nombre: 'Firulais', especie: 'Canino', raza: 'Labrador', sexo: 'Macho', fecha_nacimiento: '2021-03-15', color: 'Dorado', peso: 28, microchip: '985112003456789', esterilizado: 'Sí', alergias: 'Alérgico a la penicilina', propietario_id: ana });
const mishi = ins('pacientes', { nombre: 'Mishi', especie: 'Felino', raza: 'Siamés', sexo: 'Hembra', fecha_nacimiento: '2022-07-01', peso: 4.2, esterilizado: 'No', propietario_id: luis });

ins('citas', { paciente_id: firu, fecha: hoy, hora: '09:00', tipo: 'Control', motivo: 'Control anual', veterinario: 'Dra. Ruiz', estado: 'En sala de espera', triage: 'Normal', hora_llegada: '08:50' });
ins('citas', { paciente_id: mishi, fecha: hoy, hora: '11:30', tipo: 'Vacunación', motivo: 'Vacunación', veterinario: 'Dr. Castro', estado: 'Confirmada', triage: 'Normal' });
ins('citas', { paciente_id: mishi, fecha: addDays(hoy, 1), hora: '10:00', tipo: 'Consulta', motivo: 'Revisión de piel', estado: 'Solicitada', triage: 'Normal' });
ins('consultas', { paciente_id: firu, fecha: addDays(hoy, -30), motivo: 'Cojera miembro posterior', anamnesis: 'Cojea desde hace 3 días tras jugar en el parque', temperatura: 38.6, peso: 28, frecuencia_cardiaca: 90, frecuencia_respiratoria: 24, examen_fisico: 'Dolor a la palpación de rodilla derecha', diagnostico: 'Esguince leve', tratamiento: 'Meloxicam 0.1 mg/kg c/24h x 5 días, reposo', veterinario: 'Dra. Ruiz' });
ins('recetas', { paciente_id: firu, fecha: addDays(hoy, -30), medicamentos: 'Meloxicam 1.5 mg/ml — 1.9 ml VO cada 24 h por 5 días\nOmeprazol 20 mg — 1 tableta VO cada 24 h por 5 días', indicaciones: 'Reposo, paseos cortos con correa. Control en 8 días.', veterinario: 'Dra. Ruiz', tarjeta_profesional: '12345' });
ins('vacunas', { paciente_id: firu, tipo: 'Vacuna', vacuna: 'Rabia', lote: 'RB-2291', fecha_aplicacion: addDays(hoy, -360), proxima_dosis: addDays(hoy, 5) });
ins('vacunas', { paciente_id: mishi, tipo: 'Desparasitación interna', vacuna: 'Milbemax', fecha_aplicacion: addDays(hoy, -100), proxima_dosis: addDays(hoy, -8) });
ins('cirugias', { paciente_id: mishi, fecha: addDays(hoy, 3), procedimiento: 'Ovariohisterectomía', estado: 'Programada', cirujano: 'Dr. Castro', anestesiologo: 'Dra. Ruiz', asa: 'ASA I', ayuno: 8, peso: 4.2 });
ins('guarderia', { paciente_id: firu, fecha_ingreso: addDays(hoy, 20), fecha_salida: addDays(hoy, 27), estado: 'Reservado', jaula: 'H-3', tarifa_dia: 45000, alimentacion: 'Concentrado propio, 2 veces al día' });
ins('peluqueria', { paciente_id: firu, fecha: addDays(hoy, -15), servicio: 'Baño y corte', estilista: 'Camila', precio: 55000 });

const prov = ins('proveedores', { nombre: 'Distribuidora Vet SAS', nit: '900123456-1', contacto: 'Jorge', telefono: '6017654321' });
const melox = ins('productos', { codigo: 'MED-001', nombre: 'Meloxicam 1.5mg/ml', categoria: 'Medicamento', stock: 3, stock_minimo: 5, precio: 38000, iva: '0', vencimiento: addDays(hoy, 20) });
ins('productos', { codigo: 'ALI-010', nombre: 'Concentrado adulto 15kg', categoria: 'Alimento', stock: 20, stock_minimo: 4, precio: 210000, iva: '5' });
const consulta = ins('productos', { codigo: 'SER-001', nombre: 'Consulta general', categoria: 'Servicio', stock: 0, stock_minimo: 0, precio: 60000, iva: '0' });
ins('compras', { proveedor_id: prov, producto_id: melox, fecha: addDays(hoy, -40), cantidad: 10, costo_unitario: 22000, factura_proveedor: 'DV-8891' });

const fac = (numero, propietario, paciente, metodo, items) => {
  const subtotal = items.reduce((s, i) => s + i[2] * i[3], 0);
  const id = ins('facturas', { numero, tipo: 'Factura', estado: metodo ? 'Pagada' : 'Pendiente', propietario_id: propietario, paciente_id: paciente, fecha: hoy, metodo_pago: metodo, subtotal, total: subtotal });
  for (const [prod, desc, cant, precio] of items) ins('factura_items', { factura_id: id, producto_id: prod, descripcion: desc, cantidad: cant, precio, total: cant * precio });
};
fac('FV-000001', ana, firu, 'Tarjeta', [[consulta, 'Consulta general', 1, 60000], [melox, 'Meloxicam 1.5mg/ml', 1, 38000]]);
fac('FV-000002', luis, mishi, null, [[null, 'Desparasitación', 1, 45000]]);

console.log('Datos de ejemplo cargados.');
