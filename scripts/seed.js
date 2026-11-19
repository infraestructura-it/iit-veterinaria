// Carga datos de ejemplo: npm run seed
const { createDb } = require('../src/db');
const { today, addDays } = require('../src/app');
const crypto = require('node:crypto');
const { initLabDb, armarResultados } = require('../src/laboratorio');

const db = createDb();
initLabDb(db);
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

// Laboratorio: un cuadro hemático validado (con QR) y un perfil renal pendiente
const examen = (codigo) => db.prepare('SELECT * FROM lab_examenes WHERE codigo = ?').get(codigo);
const hem = examen('HEM-01');
const valores = { Hematocrito: '34', Hemoglobina: '11.2', Eritrocitos: '5.1', VCM: '66', HCM: '21.9', CHCM: '33', Leucocitos: '18.4',
  'Neutrófilos segmentados': '13.1', 'Neutrófilos en banda': '0.2', Linfocitos: '3.6', Monocitos: '0.9', 'Eosinófilos': '0.6',
  Plaquetas: '245', 'Proteínas plasmáticas totales': '7.4', 'Hemoparásitos': 'No se observan', 'Morfología celular': 'Leve anisocitosis' };
const resultados = armarResultados(JSON.parse(hem.parametros), valores, 'Canino');
const lab1 = ins('lab_ordenes', { paciente_id: firu, examen_id: hem.id, fecha_solicitud: `${addDays(hoy, -1)} 09:10`, fecha_toma: `${addDays(hoy, -1)} 09:20`,
  solicitante: 'Dra. Ruiz', prioridad: 'Normal', estado: 'Validado', resultados: JSON.stringify(resultados),
  conclusion: 'Anemia leve normocítica normocrómica con leucocitosis por neutrofilia. Sugiere proceso inflamatorio; correlacionar con la clínica.',
  validado_por: 'Dra. Ruiz', fecha_validacion: `${addDays(hoy, -1)} 15:40`, token: crypto.randomBytes(18).toString('base64url') });
const lab2 = ins('lab_ordenes', { paciente_id: mishi, examen_id: examen('QS-02').id, fecha_solicitud: `${hoy} 08:30`, solicitante: 'Dr. Castro',
  prioridad: 'Urgente', estado: 'Solicitado', token: crypto.randomBytes(18).toString('base64url') });
for (const id of [lab1, lab2]) db.prepare('UPDATE lab_ordenes SET codigo = ? WHERE id = ?').run(`LAB-${hoy.slice(0, 4)}-${String(id).padStart(6, '0')}`, id);

console.log('Datos de ejemplo cargados.');
