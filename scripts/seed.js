// Carga datos de ejemplo: node scripts/seed.js
const { createDb } = require('../src/db');

const db = createDb();
const ins = (t, o) => {
  const k = Object.keys(o);
  return db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(o)).lastInsertRowid;
};
const hoy = require('../src/app').today();

const ana = ins('propietarios', { nombre: 'Ana Gómez', documento: '1020304050', telefono: '3001234567', email: 'ana@correo.com', direccion: 'Cra 7 # 45-10, Bogotá' });
const luis = ins('propietarios', { nombre: 'Luis Pérez', documento: '79888777', telefono: '3109876543', direccion: 'Calle 80 # 20-30, Bogotá' });

const firu = ins('pacientes', { nombre: 'Firulais', especie: 'Canino', raza: 'Labrador', sexo: 'Macho', fecha_nacimiento: '2021-03-15', color: 'Dorado', peso: 28, propietario_id: ana });
const mishi = ins('pacientes', { nombre: 'Mishi', especie: 'Felino', raza: 'Siamés', sexo: 'Hembra', fecha_nacimiento: '2022-07-01', peso: 4.2, propietario_id: luis });

ins('citas', { paciente_id: firu, fecha: hoy, hora: '09:00', motivo: 'Control anual', veterinario: 'Dra. Ruiz', estado: 'Confirmada' });
ins('citas', { paciente_id: mishi, fecha: hoy, hora: '11:30', motivo: 'Vacunación', veterinario: 'Dr. Castro', estado: 'Programada' });
ins('consultas', { paciente_id: firu, fecha: '2026-10-02', motivo: 'Cojera miembro posterior', temperatura: 38.6, peso: 28, frecuencia_cardiaca: 90, diagnostico: 'Esguince leve', tratamiento: 'Meloxicam 0.1 mg/kg c/24h x 5 días, reposo', veterinario: 'Dra. Ruiz' });
ins('vacunas', { paciente_id: firu, tipo: 'Vacuna', vacuna: 'Rabia', lote: 'RB-2291', fecha_aplicacion: '2025-11-20', proxima_dosis: '2026-11-20' });
ins('vacunas', { paciente_id: mishi, tipo: 'Desparasitación interna', vacuna: 'Milbemax', fecha_aplicacion: '2026-08-10', proxima_dosis: '2026-11-10' });
ins('peluqueria', { paciente_id: firu, fecha: '2026-11-01', servicio: 'Baño y corte', estilista: 'Camila', precio: 55000 });
ins('productos', { codigo: 'MED-001', nombre: 'Meloxicam 1.5mg/ml', categoria: 'Medicamento', stock: 3, stock_minimo: 5, precio: 38000 });
ins('productos', { codigo: 'ALI-010', nombre: 'Concentrado adulto 15kg', categoria: 'Alimento', stock: 20, stock_minimo: 4, precio: 210000 });
ins('ventas', { propietario_id: ana, fecha: hoy, concepto: 'Consulta + Meloxicam', total: 98000, metodo_pago: 'Tarjeta' });
ins('ventas', { propietario_id: luis, fecha: hoy, concepto: 'Desparasitación', total: 45000, metodo_pago: 'Nequi' });

console.log('Datos de ejemplo cargados.');
