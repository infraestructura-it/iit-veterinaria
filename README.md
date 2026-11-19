# IIT Veterinaria 🐾

Software de gestión para clínicas veterinarias, desarrollado por **Infraestructura-IT**.
Los menús se inspiran en OkVet. Las funciones se compararon con QVET, GVET, GestorVet, Vetzilla, Smart Vet, ezyVet, Provet Cloud, Digitail y Shepherd.

## Módulos

| Menú | Descripción |
|---|---|
| 📊 Inicio | Citas del día, sala de espera, solicitudes en línea, cirugías, hospitalizados, guardería, ventas, cartera, stock bajo y productos por vencer |
| 🪑 Sala de espera | Flujo del día: llegada → en espera → en consulta → atendida, con **triage** (Normal / Prioritario / Urgente) y actualización automática |
| 📅 Agenda | Citas por tipo, veterinario, estado y triage; recibe las **reservas en línea** con estado *Solicitada* |
| 🔔 Recordatorios | Vacunas y desparasitaciones próximas o vencidas, y citas cercanas, con botón **WhatsApp** y mensaje listo |
| 🐶 Pacientes | Ficha con microchip, esterilización y **alertas/alergias**; **historia clínica** en línea de tiempo, imprimible |
| 👤 Propietarios | Datos de contacto de los tutores |
| 🩺 Consultas | Formato SOAP: anamnesis, signos vitales, examen físico, diagnóstico y plan |
| 🧪 Laboratorio | Laboratorio clínico al estilo de un laboratorio veterinario (12 categorías: hematología, coagulación, química sanguínea, minerales, hormonas, uroanálisis, dermatología, citología, parasitología, microbiología, histopatología y pruebas específicas). Órdenes con prioridad y manejo de muestras, resultados con **intervalos de referencia por especie** y marcación automática Alto/Bajo, validación por el profesional, informe imprimible con **código QR de verificación** y envío del enlace por WhatsApp |
| 💊 Recetas | Fórmula médica imprimible con tarjeta profesional |
| 💉 Vacunación | Vacunas y desparasitaciones con próxima dosis |
| 🔪 Cirugías | Registro quirúrgico y **hoja de anestesia** (ASA, ayuno, premedicación, inducción, mantenimiento, monitoreo), imprimible |
| 🏥 Hospitalización | Ingreso, jaula, estado, evolución y alta |
| 🏠 Guardería | Estadías / hotel: fechas, habitación, tarifa, alimentación y medicación |
| ✂️ Peluquería | Baños, cortes y servicios estéticos |
| ✍️ Consentimientos | Consentimiento informado con **firma digital en pantalla** (mouse o dedo), imprimible |
| 🧾 Facturación | Facturas y **presupuestos** con ítems, IVA y descuento. Descuenta inventario, se puede pagar después, el presupuesto se convierte en factura y la **anulación devuelve el stock** |
| 📦 Inventario | Productos y servicios, stock mínimo, IVA y fecha de vencimiento |
| 🚚 Proveedores / 🛒 Compras | Las compras **suman stock**; al eliminar una compra se revierte |
| 📈 Reportes | KPIs por rango de fechas: ingresos, ticket promedio, cartera, clientes nuevos, tasa de asistencia; ingresos por mes y por método de pago, más vendidos, diagnósticos frecuentes |
| 👥 Usuarios | Roles **admin**, **veterinario** y **recepción** con permisos por módulo |
| ⚙️ Configuración | Datos de la clínica (salen en documentos y mensajes), horario y duración de citas para la reserva en línea |

Todos los listados tienen **Exportar CSV**, que abre directo en Excel (UTF-8 con BOM y separador `;`).

### Laboratorio y código QR
Flujo de una orden: **Solicitado → Muestra tomada → En proceso → Validado → Entregado** (o Anulado).

- Una orden puede incluir varios exámenes; se crea una orden por examen, con código `LAB-AAAA-000123`.
- Al registrar los resultados, cada valor se compara con el intervalo de la especie del paciente (canino o felino) y se marca **Alto**, **Bajo** o **Normal**.
- Solo el administrador y los veterinarios registran y validan. Un resultado validado queda bloqueado; solo el administrador puede reabrirlo.
- El informe validado lleva un **código QR** que abre `/resultado.html?t=<token>`. Esa página pública confirma que el resultado es auténtico y muestra los datos mínimos, con el apellido del propietario oculto. El token es aleatorio de 144 bits. Si el resultado se reabre o se anula, el QR muestra que no es válido.
- Para que el QR funcione fuera de la red local, configure la **URL pública** del sistema en Configuración (por ejemplo `https://vet.su-dominio.com`).
- Los intervalos de referencia del catálogo inicial son **orientativos**. Cada laboratorio debe validarlos con su metodología en *Laboratorio → Catálogo*, donde se editan exámenes, precios, tipo de muestra, indicaciones y parámetros.

### Reserva de citas en línea
`/reservar.html` es una página pública para los clientes. Muestra los horarios libres según el horario configurado y crea la cita como *Solicitada*. Si el propietario o la mascota no existen, también los crea. Comparta el enlace desde **Configuración**.

### Permisos por rol
| | Admin | Veterinario | Recepción |
|---|:-:|:-:|:-:|
| Consultas, recetas, vacunas, cirugías, hospitalización | ✅ | ✅ | solo lectura |
| Agenda, propietarios, pacientes, guardería, peluquería, consentimientos, facturar | ✅ | ✅ | ✅ |
| Inventario, proveedores, compras | ✅ | solo lectura | ✅ |
| Registrar y validar resultados de laboratorio | ✅ | ✅ | — |
| Crear órdenes de laboratorio, registrar muestras, entregar | ✅ | ✅ | ✅ |
| Anular facturas, reabrir resultados, catálogo de laboratorio, usuarios, configuración | ✅ | — | — |

## Stack

- **Backend:** Node.js + Express + SQLite integrado de Node.js (`node:sqlite`, requiere Node 22.13 o superior; no necesita compilar nada)
- **Seguridad:** contraseñas con `scrypt` y sesiones en cookie HttpOnly guardadas en la base de datos
- **Frontend:** HTML/CSS/JS sin dependencias (SPA con rutas por hash)
- **Código QR:** librería `qrcode` (JavaScript puro, sin compilación)
- **Pruebas:** `node:test` + supertest (76 pruebas)

La mayoría de los módulos se definen en `src/resources.js`. Esa definición genera la tabla, la API REST, la validación, los permisos, la exportación CSV y el formulario. Para agregar un campo basta con añadirlo ahí: las bases de datos existentes reciben la columna nueva automáticamente al iniciar.

## Uso

```bash
npm install
npm run seed     # opcional: datos de ejemplo
npm start        # http://localhost:3000
npm test
```

**Primer ingreso:** si no hay usuarios, se crea `admin` con una contraseña aleatoria que se imprime en la consola. También puede fijarla con la variable `ADMIN_PASSWORD` en el primer arranque. Cámbiela desde el botón 🔑.

Variables de entorno: `PORT` (por defecto 3000), `DB_FILE` (por defecto `veterinaria.db`) y `ADMIN_PASSWORD` (solo en el primer arranque).

## API (resumen)

- CRUD de cada módulo: `GET/POST /api/<modulo>`, `GET/PUT/DELETE /api/<modulo>/:id`, `GET /api/<modulo>/export` (CSV). Filtros: `?q=`, `?campo=valor`, `?desde=&hasta=`
- Facturación: `GET/POST /api/facturas`, `GET /api/facturas/:id`, `POST /api/facturas/:id/pagar | convertir | anular`
- `GET /api/dashboard`, `/api/sala-espera`, `/api/recordatorios?dias=7`, `/api/reportes?desde=&hasta=`, `/api/pacientes/:id/historia`
- Sesión: `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PUT /api/me/password`; usuarios: `/api/usuarios` (admin)
- Laboratorio: `GET/POST /api/lab/catalogo`, `PUT /api/lab/catalogo/:id`, `GET/POST /api/lab/ordenes`, `GET /api/lab/ordenes/:id`, `POST /api/lab/ordenes/:id/muestra | validar | entregar | reabrir | anular`, `PUT /api/lab/ordenes/:id/resultados`, `GET /api/lab/ordenes/:id/qr.svg`
- Público (sin sesión): `GET /api/publico/resultado/:token`, `GET /api/publico/clinica`, `GET /api/publico/disponibilidad?fecha=`, `POST /api/publico/reservar`

## Pendiente (siguientes fases)

- Facturación electrónica DIAN (vía proveedor tecnológico)
- Envío automático de recordatorios (API de WhatsApp Business / correo)
- Portal / app para el tutor con el carnet de vacunas
- Adjuntos (radiografías, laboratorios) en la historia clínica
- Calendario visual semanal en Agenda y multi-sede
