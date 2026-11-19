# IIT Veterinaria 🐾

Software de gestión para clínicas veterinarias, desarrollado por **Infraestructura-IT**.
La organización de los menús se inspira en plataformas como OkVet.

## Módulos

| Menú | Descripción |
|---|---|
| 📊 Inicio | Tablero con citas del día, vacunas próximas/vencidas, stock bajo y ventas del mes |
| 📅 Agenda | Citas por paciente, hora, veterinario y estado |
| 🩺 Consultas | Anamnesis, signos vitales, examen físico, diagnóstico y tratamiento |
| 🐶 Pacientes | Ficha del paciente y **historia clínica** en línea de tiempo |
| 👤 Propietarios | Datos de contacto de los tutores |
| 💉 Vacunación | Vacunas y desparasitaciones, con fecha de próxima dosis |
| 🏥 Hospitalización | Ingreso, jaula, estado, evolución y alta |
| ✂️ Peluquería | Baños, cortes y otros servicios estéticos |
| 📦 Inventario | Productos con stock mínimo |
| 💵 Ventas | Registro de ventas y método de pago |
| 📈 Reportes | Ventas por mes y método de pago, pacientes por especie |

## Stack

- **Backend:** Node.js + Express + SQLite integrado de Node.js (`node:sqlite`, requiere Node 22.13 o superior; no necesita compilar nada)
- **Frontend:** HTML/CSS/JS sin dependencias (SPA con rutas por hash)
- **Pruebas:** `node:test` + supertest

Todos los módulos se definen en `src/resources.js`. Esa definición genera la tabla, la API REST, la validación y el formulario. Para agregar un campo o un módulo nuevo basta con editar ese archivo.

## Uso

```bash
npm install
npm run seed     # opcional: carga datos de ejemplo
npm start        # http://localhost:3000
npm test
```

Variables de entorno: `PORT` (por defecto 3000) y `DB_FILE` (por defecto `veterinaria.db`).

## API

Para cada módulo (`propietarios`, `pacientes`, `citas`, `consultas`, `vacunas`, `hospitalizaciones`, `peluqueria`, `productos`, `ventas`):

- `GET /api/<modulo>?q=texto&campo=valor` lista con búsqueda y filtros
- `GET /api/<modulo>/:id`
- `POST /api/<modulo>`
- `PUT /api/<modulo>/:id` (actualización parcial)
- `DELETE /api/<modulo>/:id`

Endpoints adicionales: `GET /api/dashboard`, `GET /api/reportes/ventas`, `GET /api/pacientes/:id/historia`, `GET /api/meta`.

## Pendiente (siguientes fases)

- Usuarios, roles e inicio de sesión
- Facturación con detalle de ítems y descuento automático de inventario
- Recordatorios por WhatsApp/correo de vacunas y citas
- Impresión de historia clínica y fórmula médica en PDF
- Calendario visual semanal en Agenda
