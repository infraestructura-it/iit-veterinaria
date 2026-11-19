/* IIT Veterinaria — interfaz SPA sin dependencias */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
let META = {};
let USER = null;
let CONFIG = {};
let refreshTimer = null;
const refCache = {};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const ahoraHM = () => new Date().toTimeString().slice(0, 5);
const errText = (e) => (e && (e.errors || [e.error]).filter(Boolean).join(' · ')) || 'Error inesperado';

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  if (res.status === 401 && !url.endsWith('/api/login')) { showLogin(); throw { error: 'Sesión expirada' }; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });

function toast(msg, ok = false) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:20px;right:20px;background:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:99;color:${ok ? 'var(--ok)' : 'var(--danger)'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

const BADGES = {
  ok: ['Validado', 'Entregado', 'Normal', 'Atendida', 'Dado de alta', 'Confirmada', 'Pagada', 'Finalizada', 'Finalizado', 'Facturado', 'Hospedado', 'Activo'],
  bad: ['Anulado', 'Alto', 'Bajo', 'Cancelada', 'Cancelado', 'No asistió', 'Fallecido', 'Anulada', 'Urgente', 'Vencida', 'Vencido', 'Inactivo'],
  warn: ['Solicitado', 'Muestra tomada', 'En proceso', 'Hospitalizado', 'En observación', 'Pendiente', 'Solicitada', 'En sala de espera', 'En consulta', 'En curso', 'Prioritario', 'Borrador', 'Por vencer'],
};
function badge(v) {
  const cls = Object.keys(BADGES).find((k) => BADGES[k].includes(v)) || '';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

const canWrite = (name) => { const w = META[name]?.write; return !w || w.includes(USER.rol); };

/* ---------- Menú ---------- */
const MENU = [
  ['Principal', [['dashboard', '📊 Inicio'], ['sala', '🪑 Sala de espera'], ['citas', '📅 Agenda'], ['recordatorios', '🔔 Recordatorios']]],
  ['Clínica', [['pacientes', '🐶 Pacientes'], ['propietarios', '👤 Propietarios'], ['consultas', '🩺 Consultas'], ['recetas', '💊 Recetas'],
    ['laboratorio', '🧪 Laboratorio'], ['vacunas', '💉 Vacunación'], ['cirugias', '🔪 Cirugías'], ['hospitalizaciones', '🏥 Hospitalización'], ['guarderia', '🏠 Guardería'],
    ['peluqueria', '✂️ Peluquería'], ['consentimientos', '✍️ Consentimientos']]],
  ['Administración', [['facturas', '🧾 Facturación'], ['productos', '📦 Inventario'], ['proveedores', '🚚 Proveedores'], ['compras', '🛒 Compras'], ['reportes', '📈 Reportes']]],
  ['Sistema', [['usuarios', '👥 Usuarios'], ['configuracion', '⚙️ Configuración']], ['admin']],
];

function renderMenu() {
  $('#menu').innerHTML = MENU.filter(([, , roles]) => !roles || roles.includes(USER.rol))
    .map(([title, items]) => `<p class="menu-title">${title}</p>${items.map(([v, l]) => `<a data-view="${v}" href="#${v}">${l}</a>`).join('')}`).join('');
}

/* ---------- Sesión ---------- */
function showLogin() {
  USER = null;
  $('#shell').classList.add('hidden');
  $('#login').classList.remove('hidden');
  clearInterval(refreshTimer);
}

async function startApp(user) {
  USER = user;
  [META, CONFIG] = await Promise.all([api('/api/meta'), api('/api/configuracion')]);
  $('#brand-name').textContent = CONFIG.nombre_clinica || 'IIT Veterinaria';
  $('#user-name').innerHTML = `${esc(USER.nombre)} <span class="rol">${esc(USER.rol)}</span>`;
  renderMenu();
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  route();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try { await startApp(await post('/api/login', Object.fromEntries(new FormData(e.target)))); e.target.reset(); }
  catch (err) { $('#login-error').textContent = errText(err); }
};
$('#btn-logout').onclick = async () => { await post('/api/logout').catch(() => {}); location.hash = ''; showLogin(); };
$('#btn-password').onclick = () => openCustomForm('Cambiar contraseña', [
  { name: 'actual', label: 'Contraseña actual', type: 'password', required: true },
  { name: 'nueva', label: 'Nueva contraseña (mín. 8)', type: 'password', required: true },
], {}, async (body) => { await api('/api/me/password', { method: 'PUT', body: JSON.stringify(body) }); toast('Contraseña actualizada', true); });

/* ---------- Router ---------- */
const views = {
  dashboard: renderDashboard, sala: renderSala, recordatorios: renderRecordatorios, reportes: renderReportes,
  historia: renderHistoria, facturas: renderFacturas, laboratorio: renderLaboratorio, usuarios: renderUsuarios, configuracion: renderConfig, imprimir: renderImprimir,
};

async function route() {
  if (!USER) return;
  clearInterval(refreshTimer);
  const [name, ...params] = (location.hash.slice(1) || 'dashboard').split('/');
  const active = { historia: 'pacientes', imprimir: { factura: 'facturas', historia: 'pacientes', lab: 'laboratorio' }[params[0]] || params[0] };
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.view === (active[name] || name)));
  $('#sidebar').classList.remove('open');
  try {
    if (views[name]) await views[name](...params);
    else if (META[name]) await renderList(name);
    else view.innerHTML = '<p class="empty">Módulo no encontrado</p>';
  } catch (e) {
    view.innerHTML = `<p class="errors">Error: ${esc(errText(e))}</p>`;
  }
}

/* ---------- Dashboard ---------- */
async function renderDashboard() {
  $('#title').textContent = 'Inicio';
  const d = await api('/api/dashboard');
  const rows = (list, fn) => (list.length ? list.map(fn).join('') : '<tr><td class="empty">Sin registros</td></tr>');
  const card = (n, l, href) => `<a class="card" href="${href}" style="text-decoration:none"><div class="num">${n}</div><div class="lbl">${l}</div></a>`;
  view.innerHTML = `
    <div class="cards">
      ${card(d.totales.citas_hoy, 'Citas hoy', '#citas')}
      ${card(d.totales.en_espera, 'En sala de espera', '#sala')}
      ${card(d.totales.solicitudes, 'Solicitudes en línea', '#citas')}
      ${card(d.totales.cirugias_hoy, 'Cirugías hoy', '#cirugias')}
      ${card(d.totales.lab_pendientes, 'Exámenes pendientes', '#laboratorio')}
      ${card(d.totales.hospitalizados, 'Hospitalizados', '#hospitalizaciones')}
      ${card(d.totales.en_guarderia, 'En guardería', '#guarderia')}
      ${card(money(d.ventas_mes), 'Ventas del mes', '#facturas')}
      ${card(money(d.por_cobrar), 'Por cobrar', '#facturas')}
    </div>
    <div class="panels">
      <div class="panel"><h3>📅 Agenda de hoy (${esc(d.fecha)})</h3><table>${rows(d.citas_hoy, (c) => `<tr><td>${esc(c.hora)}</td><td>${esc(c.paciente_id_label)}</td><td>${esc(c.motivo)}</td><td>${badge(c.estado)}</td></tr>`)}</table></div>
      <div class="panel"><h3>💉 Vacunas próximas / vencidas</h3><table>${rows(d.vacunas_pendientes, (v) => `<tr><td>${esc(v.proxima_dosis)}</td><td>${esc(v.paciente_id_label)}</td><td>${esc(v.vacuna)}</td></tr>`)}</table></div>
      <div class="panel"><h3>📦 Stock bajo</h3><table>${rows(d.stock_bajo, (p) => `<tr><td>${esc(p.nombre)}</td><td><span class="badge bad">${p.stock} / mín ${p.stock_minimo}</span></td></tr>`)}</table></div>
      <div class="panel"><h3>⏳ Productos por vencer (30 días)</h3><table>${rows(d.por_vencer, (p) => `<tr><td>${esc(p.nombre)}</td><td>${badge(p.vencimiento < d.fecha ? 'Vencido' : 'Por vencer')} ${esc(p.vencimiento)}</td></tr>`)}</table></div>
    </div>`;
}

/* ---------- Listado genérico ---------- */
async function renderList(name) {
  const def = META[name];
  $('#title').textContent = def.label;
  const cols = def.fields.filter((f) => !['textarea', 'signature'].includes(f.type) || f.name === 'diagnostico').slice(0, 7);
  const write = canWrite(name);
  view.innerHTML = `
    <div class="toolbar">
      <input id="q" placeholder="Buscar ${esc(def.label.toLowerCase())}..." />
      <a class="btn ghost" id="export" href="/api/${name}/export">⬇ Exportar CSV</a>
      ${write ? `<button class="btn primary" id="new">+ ${def.fem ? 'Nueva' : 'Nuevo'} ${esc(def.singular.toLowerCase())}</button>` : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const cell = (f, r) => {
    const v = r[f.name];
    if (f.type === 'ref') return esc(r[`${f.name}_label`]);
    if (['estado', 'triage'].includes(f.name)) return badge(v);
    if (['precio', 'total', 'tarifa_dia', 'costo_unitario'].includes(f.name)) return money(v);
    if (f.type === 'textarea') return esc(String(v ?? '').slice(0, 60));
    return esc(v);
  };

  const load = async () => {
    const q = $('#q').value;
    $('#export').href = `/api/${name}/export${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    const data = await api(`/api/${name}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    $('#rows').innerHTML = data.length ? data.map((r) => `
      <tr>${cols.map((f) => `<td>${cell(f, r)}</td>`).join('')}
        <td class="acts">
          ${name === 'pacientes' ? `<a class="btn sm ghost" href="#historia/${r.id}">Historia</a>` : ''}
          ${def.print ? `<a class="btn sm ghost" href="#imprimir/${name}/${r.id}">Imprimir</a>` : ''}
          ${write ? `<button class="btn sm ghost" data-edit="${r.id}">Editar</button><button class="btn sm danger" data-del="${r.id}">Eliminar</button>` : ''}
        </td></tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="empty">No hay registros</td></tr>`;
  };

  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  if (write) $('#new').onclick = () => openForm(name, null, load);
  $('#rows').onclick = async (e) => {
    const { edit, del } = e.target.dataset;
    if (edit) openForm(name, await api(`/api/${name}/${edit}`), load);
    if (del) {
      if (!confirm('¿Eliminar este registro?')) return;
      try { await api(`/api/${name}/${del}`, { method: 'DELETE' }); delete refCache[name]; load(); } catch (err) { toast(errText(err)); }
    }
  };
  await load();
}

/* ---------- Formularios ---------- */
async function refOptions(ref) {
  if (!refCache[ref]) refCache[ref] = await api(`/api/${ref}`);
  return refCache[ref];
}

function signaturePad(container, existing) {
  container.innerHTML = `<div class="sig-wrap"><canvas></canvas><button type="button" class="btn sm ghost">Limpiar</button></div>
    ${existing ? `<small>Firma actual:</small><img class="sig-img" src="${esc(existing)}" alt="firma" /><small> (dibuje para reemplazarla)</small>` : '<small>Firme dentro del recuadro con el mouse o el dedo</small>'}`;
  const canvas = $('canvas', container);
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  const fit = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width; canvas.height = r.height; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0d47a1'; };
  requestAnimationFrame(fit);
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.onpointerdown = (e) => { drawing = true; dirty = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  canvas.onpointermove = (e) => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } };
  canvas.onpointerup = () => { drawing = false; };
  $('button', container).onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; };
  return () => (dirty ? canvas.toDataURL('image/png') : undefined);
}

function fieldInput(f, val, opts, disabled) {
  const attrs = `name="${f.name}" ${f.required ? 'required' : ''} ${disabled ? 'disabled' : ''}`;
  if (f.type === 'textarea') return `<textarea ${attrs}>${esc(val)}</textarea>`;
  if (f.type === 'select') return `<select ${attrs}><option value="">— Seleccione —</option>${f.options.map((o) => `<option ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.type === 'ref') {
    const disp = META[f.ref].display;
    return `<select ${attrs}><option value="">— Seleccione —</option>${opts.map((o) => `<option value="${o.id}" ${o.id == val ? 'selected' : ''}>${esc(o[disp])}${o.propietario_id_label ? ` (${esc(o.propietario_id_label)})` : ''}</option>`).join('')}</select>`;
  }
  if (f.type === 'signature') return `<div data-sig="${f.name}"></div>`;
  const type = f.type === 'number' ? 'number" step="any' : f.type;
  return `<input type="${type}" ${attrs} value="${esc(val)}" />`;
}

async function openForm(name, row, onSaved, preset = {}) {
  const def = META[name];
  $('#modal').classList.remove('wide');
  $('#form-title').textContent = `${row ? 'Editar' : def.fem ? 'Nueva' : 'Nuevo'} ${def.singular.toLowerCase()}`;
  $('#form-errors').textContent = '';
  const html = [];
  for (const f of def.fields) {
    const isFecha = f.type === 'date' && ['fecha', 'fecha_aplicacion', 'fecha_ingreso'].includes(f.name);
    const val = row ? row[f.name] : preset[f.name] ?? f.default ?? (isFecha ? hoyISO() : '');
    const opts = f.type === 'ref' ? await refOptions(f.ref) : null;
    const full = ['textarea', 'signature'].includes(f.type);
    const disabled = !!row && (def.immutable || []).includes(f.name);
    // La firma no va dentro de <label>: un clic en el lienzo activaría el botón "Limpiar".
    const tag = f.type === 'signature' ? 'div' : 'label';
    html.push(`<${tag} class="${full ? 'full' : ''}"><span class="${f.required ? 'req' : ''}">${esc(f.label)}</span>${fieldInput(f, val, opts, disabled)}</${tag}>`);
  }
  $('#form-fields').innerHTML = html.join('');
  const sigs = {};
  document.querySelectorAll('[data-sig]').forEach((el) => { sigs[el.dataset.sig] = signaturePad(el, row?.[el.dataset.sig]); });
  bindModal(async (form) => {
    const body = Object.fromEntries(new FormData(form));
    for (const [k, get] of Object.entries(sigs)) { const v = get(); if (v) body[k] = v; }
    await api(`/api/${name}${row ? `/${row.id}` : ''}`, { method: row ? 'PUT' : 'POST', body: JSON.stringify(body) });
    delete refCache[name];
    onSaved && onSaved();
  });
}

/** Formulario simple con campos propios (no ligados a un recurso). */
function openCustomForm(title, fields, values, onSubmit) {
  $('#modal').classList.remove('wide');
  $('#form-title').textContent = title;
  $('#form-errors').textContent = '';
  $('#form-fields').innerHTML = fields.map((f) => `<label><span class="${f.required ? 'req' : ''}">${esc(f.label)}</span>${
    f.type === 'select'
      ? `<select name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(values[f.name]) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`
      : `<input type="${f.type || 'text'}" name="${f.name}" value="${f.type === 'password' ? '' : esc(values[f.name])}" ${f.required ? 'required' : ''} />`}</label>`).join('');
  bindModal(async (form) => onSubmit(Object.fromEntries(new FormData(form))));
}

function bindModal(onSubmit) {
  const modal = $('#modal');
  $('#cancel').onclick = () => modal.close();
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(e.target); modal.close(); } catch (err) { $('#form-errors').textContent = errText(err); }
  };
  modal.showModal();
}

/* ---------- Sala de espera (flujo con triage) ---------- */
async function renderSala() {
  $('#title').textContent = 'Sala de espera';
  const fecha = hoyISO();
  const cols = [
    ['Por llegar', ['Programada', 'Confirmada']],
    ['En sala de espera', ['En sala de espera']],
    ['En consulta', ['En consulta']],
    ['Finalizadas', ['Atendida', 'No asistió']],
  ];
  const draw = async () => {
    const citas = await api(`/api/sala-espera?fecha=${fecha}`);
    view.innerHTML = `<p class="kpi-sub no-print">Citas de hoy (${fecha}) · se actualiza cada 30 segundos · prioridad: Urgente → Prioritario → Normal</p>
      <div class="kanban">${cols.map(([title, estados]) => {
        const list = citas.filter((c) => estados.includes(c.estado));
        return `<div class="kcol"><h3>${title}<span class="badge">${list.length}</span></h3>${list.map((c) => `
          <div class="kcard ${esc(c.triage)}">
            <strong>${esc(c.paciente_id_label)}</strong> · ${esc(c.hora)} ${c.hora_llegada ? `<small>(llegó ${esc(c.hora_llegada)})</small>` : ''}<br>
            ${esc(c.motivo)} ${c.veterinario ? `<br><small>${esc(c.veterinario)}</small>` : ''}
            <div class="row">
              <select data-triage="${c.id}">${['Normal', 'Prioritario', 'Urgente'].map((t) => `<option ${t === c.triage ? 'selected' : ''}>${t}</option>`).join('')}</select>
              ${['Programada', 'Confirmada'].includes(c.estado) ? `<button class="btn sm primary" data-st="${c.id}|En sala de espera|llegada">Llegó</button><button class="btn sm danger" data-st="${c.id}|No asistió">No asistió</button>` : ''}
              ${c.estado === 'En sala de espera' ? `<button class="btn sm primary" data-st="${c.id}|En consulta">Pasar a consulta</button>` : ''}
              ${c.estado === 'En consulta' ? `<button class="btn sm primary" data-st="${c.id}|Atendida">Finalizar</button><a class="btn sm ghost" href="#historia/${c.paciente_id}">Historia</a>` : ''}
              ${['Atendida', 'No asistió'].includes(c.estado) ? badge(c.estado) : ''}
            </div>
          </div>`).join('') || '<p class="empty">—</p>'}</div>`;
      }).join('')}</div>`;
    view.querySelectorAll('[data-st]').forEach((b) => {
      b.onclick = async () => {
        const [id, estado, llegada] = b.dataset.st.split('|');
        try { await api(`/api/citas/${id}`, { method: 'PUT', body: JSON.stringify({ estado, ...(llegada ? { hora_llegada: ahoraHM() } : {}) }) }); draw(); } catch (e) { toast(errText(e)); }
      };
    });
    view.querySelectorAll('[data-triage]').forEach((s) => {
      s.onchange = async () => { await api(`/api/citas/${s.dataset.triage}`, { method: 'PUT', body: JSON.stringify({ triage: s.value }) }); draw(); };
    });
  };
  await draw();
  refreshTimer = setInterval(() => { if (location.hash === '#sala' && !$('#modal').open) draw().catch(() => {}); }, 30000);
}

/* ---------- Recordatorios ---------- */
async function renderRecordatorios() {
  $('#title').textContent = 'Recordatorios';
  view.innerHTML = `<div class="toolbar filters">
      <label>Próximos <select id="dias">${[3, 7, 15, 30].map((d) => `<option ${d === 7 ? 'selected' : ''}>${d}</option>`).join('')}</select> días</label>
      <span class="kpi-sub">Vacunas y desparasitaciones pendientes (incluye vencidas) y citas de hoy a 2 días.</span>
    </div><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Fecha</th><th>Paciente</th><th>Propietario</th><th>Detalle</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const load = async () => {
    const list = await api(`/api/recordatorios?dias=${$('#dias').value}`);
    $('#rows').innerHTML = list.length ? list.map((r, i) => `<tr>
      <td>${badge(r.tipo)} ${r.vencida ? badge('Vencida') : ''}</td><td>${esc(r.fecha)} ${esc(r.hora || '')}</td><td>${esc(r.paciente)}</td>
      <td>${esc(r.propietario)}<br><small>${esc(r.telefono)}</small></td><td>${esc(r.detalle)}</td>
      <td class="acts">${r.whatsapp ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${esc(r.whatsapp)}">WhatsApp</a>` : '<small>Sin celular válido</small>'}
        <button class="btn sm ghost" data-copy="${i}">Copiar</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No hay recordatorios pendientes</td></tr>';
    $('#rows').onclick = (e) => { const i = e.target.dataset.copy; if (i !== undefined) navigator.clipboard.writeText(list[i].mensaje).then(() => toast('Mensaje copiado', true)); };
  };
  $('#dias').onchange = load;
  await load();
}

/* ---------- Facturación ---------- */
async function renderFacturas() {
  $('#title').textContent = 'Facturación';
  view.innerHTML = `<div class="toolbar filters">
      <input id="q" placeholder="Buscar por número, cliente o documento..." style="flex:1" />
      <select id="ftipo"><option value="">Todos los tipos</option><option>Factura</option><option>Presupuesto</option></select>
      <select id="festado"><option value="">Todos los estados</option>${['Pagada', 'Pendiente', 'Borrador', 'Facturado', 'Anulada'].map((s) => `<option>${s}</option>`).join('')}</select>
      <button class="btn ghost" id="new-p">+ Presupuesto</button>
      <button class="btn primary" id="new-f">+ Factura</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Paciente</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('#q').value, tipo: $('#ftipo').value, estado: $('#festado').value });
    const list = await api(`/api/facturas?${qs}`);
    $('#rows').innerHTML = list.length ? list.map((f) => `<tr>
      <td><strong>${esc(f.numero)}</strong></td><td>${esc(f.fecha)}</td><td>${esc(f.propietario_nombre)}</td><td>${esc(f.paciente_nombre)}</td>
      <td>${money(f.total)}</td><td>${esc(f.metodo_pago || '—')}</td><td>${badge(f.estado)}</td>
      <td class="acts"><a class="btn sm ghost" href="#imprimir/factura/${f.id}">Ver / Imprimir</a>
        ${f.estado === 'Pendiente' ? `<button class="btn sm primary" data-pagar="${f.id}">Registrar pago</button>` : ''}
        ${f.tipo === 'Presupuesto' && f.estado === 'Borrador' ? `<button class="btn sm primary" data-convertir="${f.id}">Facturar</button>` : ''}
        ${USER.rol === 'admin' && !['Anulada', 'Facturado'].includes(f.estado) ? `<button class="btn sm danger" data-anular="${f.id}">Anular</button>` : ''}
      </td></tr>`).join('') : '<tr><td colspan="8" class="empty">No hay documentos</td></tr>';
  };
  const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi', 'Daviplata'];
  const metodoForm = (title, cb) => openCustomForm(title, [{ name: 'metodo_pago', label: 'Método de pago', type: 'select', required: true, options: METODOS }], {}, cb);
  $('#rows').onclick = async (e) => {
    const { pagar, convertir, anular } = e.target.dataset;
    try {
      if (pagar) metodoForm('Registrar pago', async (b) => { await post(`/api/facturas/${pagar}/pagar`, b); load(); });
      if (convertir) metodoForm('Convertir presupuesto en factura', async (b) => { const f = await post(`/api/facturas/${convertir}/convertir`, b); toast(`Factura ${f.numero} creada`, true); load(); });
      if (anular && confirm('¿Anular este documento? Si es una factura, el inventario se devuelve.')) { await post(`/api/facturas/${anular}/anular`); load(); }
    } catch (err) { toast(errText(err)); }
  };
  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#ftipo').onchange = load;
  $('#festado').onchange = load;
  $('#new-f').onclick = () => facturaForm('Factura', load);
  $('#new-p').onclick = () => facturaForm('Presupuesto', load);
  await load();
}

async function facturaForm(tipo, onSaved) {
  const [clientes, pacientes, productos] = await Promise.all([api('/api/propietarios'), api('/api/pacientes'), api('/api/productos')]);
  $('#modal').classList.add('wide');
  $('#form-title').textContent = `Nueva ${tipo.toLowerCase()}`;
  $('#form-errors').textContent = '';
  const prodOpts = `<option value="">— Ítem libre —</option>${productos.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.categoria !== 'Servicio' ? ` (stock ${p.stock})` : ''}</option>`).join('')}`;
  $('#form-fields').innerHTML = `
    <label><span class="req">Cliente</span><select name="propietario_id" required><option value="">— Seleccione —</option>${clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.documento)}</option>`).join('')}</select></label>
    <label><span>Paciente</span><select name="paciente_id"><option value="">—</option></select></label>
    <label><span class="req">Fecha</span><input type="date" name="fecha" value="${hoyISO()}" required /></label>
    ${tipo === 'Factura' ? '<label><span>Método de pago (vacío = pendiente)</span><select name="metodo_pago"><option value="">Pendiente de pago</option><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option><option>Nequi</option><option>Daviplata</option></select></label>' : '<label></label>'}
    <div class="full"><table class="items-table"><thead><tr><th style="width:28%">Producto / servicio</th><th>Descripción</th><th style="width:9%">Cant.</th><th style="width:14%">Precio</th><th style="width:9%">IVA %</th><th style="width:13%">Total</th><th></th></tr></thead><tbody id="items"></tbody></table>
      <button type="button" class="btn sm ghost" id="add-item">+ Agregar ítem</button></div>
    <label><span>Descuento ($)</span><input type="number" name="descuento" min="0" step="any" value="0" /></label>
    <label><span>Notas</span><input name="notas" /></label>
    <div class="full totales" id="totales"></div>`;
  const tbody = $('#items');
  const addRow = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><select data-k="producto_id">${prodOpts}</select></td><td><input data-k="descripcion" /></td>
      <td><input data-k="cantidad" type="number" min="0" step="any" value="1" /></td><td><input data-k="precio" type="number" min="0" step="any" /></td>
      <td><input data-k="iva" type="number" min="0" max="100" value="0" /></td><td data-total></td><td><button type="button" class="btn sm danger" data-rm>✕</button></td>`;
    tbody.appendChild(tr);
  };
  const items = () => [...tbody.rows].map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value])));
  const recalc = () => {
    let sub = 0;
    let iva = 0;
    const its = items();
    [...tbody.rows].forEach((tr, i) => {
      const t = (Number(its[i].cantidad) || 0) * (Number(its[i].precio) || 0);
      sub += t;
      iva += (t * (Number(its[i].iva) || 0)) / 100;
      $('[data-total]', tr).textContent = money(t);
    });
    const desc = Number($('[name=descuento]').value) || 0;
    $('#totales').innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>Descuento</span><span>− ${money(desc)}</span></div>
      <div><span>IVA</span><span>${money(iva)}</span></div><div class="grand"><span>Total</span><span>${money(sub - desc + iva)}</span></div>`;
  };
  tbody.oninput = recalc;
  tbody.onchange = (e) => {
    if (e.target.dataset.k === 'producto_id') {
      const p = productos.find((x) => x.id == e.target.value);
      const tr = e.target.closest('tr');
      if (p) { $('[data-k=descripcion]', tr).value = p.nombre; $('[data-k=precio]', tr).value = p.precio; $('[data-k=iva]', tr).value = p.iva || 0; }
    }
    recalc();
  };
  tbody.onclick = (e) => { if (e.target.dataset.rm !== undefined) { e.target.closest('tr').remove(); recalc(); } };
  $('#add-item').onclick = () => { addRow(); recalc(); };
  $('[name=descuento]').oninput = recalc;
  $('[name=propietario_id]').onchange = (e) => {
    $('[name=paciente_id]').innerHTML = `<option value="">—</option>${pacientes.filter((p) => p.propietario_id == e.target.value).map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}`;
  };
  addRow();
  recalc();
  bindModal(async (form) => {
    const body = Object.fromEntries(new FormData(form));
    body.tipo = tipo;
    body.items = items().filter((i) => i.descripcion || i.producto_id);
    const f = await post('/api/facturas', body);
    toast(`${tipo} ${f.numero} creada`, true);
    onSaved();
  });
}

/* ---------- Historia clínica ---------- */
async function renderHistoria(id) {
  const h = await api(`/api/pacientes/${id}/historia`);
  const p = h.paciente;
  $('#title').textContent = `Historia clínica — ${p.nombre}`;
  const linkPrint = (tipo, rid) => `<a class="btn sm ghost no-print" href="#imprimir/${tipo}/${rid}">Imprimir</a>`;
  const eventos = [
    ...h.consultas.map((c) => ({ f: c.fecha, t: '🩺 Consulta', d: `<strong>${esc(c.motivo)}</strong><br>Dx: ${esc(c.diagnostico) || '—'}<br>Plan: ${esc(c.tratamiento) || '—'}<br><small>T° ${esc(c.temperatura) || '—'} · Peso ${esc(c.peso) || '—'} kg · FC ${esc(c.frecuencia_cardiaca) || '—'} · ${esc(c.veterinario)}</small>` })),
    ...h.recetas.map((r) => ({ f: r.fecha, t: '💊 Receta', d: `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(r.medicamentos)}</pre><small>${esc(r.veterinario)}</small> ${linkPrint('recetas', r.id)}` })),
    ...h.vacunas.map((v) => ({ f: v.fecha_aplicacion, t: `💉 ${esc(v.tipo)}`, d: `${esc(v.vacuna)} ${v.lote ? `(lote ${esc(v.lote)})` : ''} — próxima: ${esc(v.proxima_dosis) || '—'}` })),
    ...h.cirugias.map((c) => ({ f: c.fecha, t: '🔪 Cirugía', d: `<strong>${esc(c.procedimiento)}</strong> ${badge(c.estado)} ${c.asa ? badge(c.asa) : ''}<br>${esc(c.hallazgos || '')} ${linkPrint('cirugias', c.id)}` })),
    ...h.hospitalizaciones.map((x) => ({ f: x.fecha_ingreso, t: '🏥 Hospitalización', d: `${esc(x.motivo)} ${badge(x.estado)}<br>${esc(x.observaciones)}` })),
    ...h.guarderia.map((x) => ({ f: x.fecha_ingreso, t: '🏠 Guardería', d: `${esc(x.fecha_ingreso)} → ${esc(x.fecha_salida)} ${badge(x.estado)}` })),
    ...h.peluqueria.map((x) => ({ f: x.fecha, t: '✂️ Peluquería', d: `${esc(x.servicio)} ${esc(x.observaciones)}` })),
    ...h.laboratorio.map((x) => ({ f: (x.fecha_validacion || x.fecha_solicitud).slice(0, 10), t: '🧪 Laboratorio', d: `<strong>${esc(x.examen)}</strong> ${esc(x.codigo)} ${badge(x.estado)}${x.conclusion ? `<br>${esc(x.conclusion)}` : ''} <a class="btn sm ghost no-print" href="#imprimir/lab/${x.id}">Ver resultado</a>` })),
    ...h.consentimientos.map((x) => ({ f: x.fecha, t: '✍️ Consentimiento', d: `${esc(x.tipo)} — firmado por ${esc(x.firmante)} ${linkPrint('consentimientos', x.id)}` })),
  ].sort((a, b) => (a.f < b.f ? 1 : -1));
  const botones = [['consultas', '+ Consulta', true], ['laboratorio', '+ Examen'], ['recetas', '+ Receta'], ['vacunas', '+ Vacuna'], ['cirugias', '+ Cirugía'], ['hospitalizaciones', '+ Hospitalización'],
    ['consentimientos', '+ Consentimiento'], ['citas', '+ Cita']].filter(([m]) => m === 'laboratorio' || canWrite(m));
  view.innerHTML = `
    ${p.alergias ? `<div class="panel" style="border-color:#f3c4c4;background:#fdecea;margin-bottom:12px"><strong>⚠️ Alertas:</strong> ${esc(p.alergias)}</div>` : ''}
    <div class="historia-head">
      <div><span>Paciente</span><strong>${esc(p.nombre)}</strong></div>
      <div><span>Especie / Raza</span>${esc(p.especie)} ${esc(p.raza)}</div>
      <div><span>Sexo</span>${esc(p.sexo) || '—'} ${p.esterilizado === 'Sí' ? '(esterilizado)' : ''}</div>
      <div><span>Nacimiento</span>${esc(p.fecha_nacimiento) || '—'}</div>
      <div><span>Peso</span>${esc(p.peso) || '—'} kg</div>
      <div><span>Microchip</span>${esc(p.microchip) || '—'}</div>
      <div><span>Propietario</span>${esc(h.propietario.nombre)} · ${esc(h.propietario.telefono)}</div>
    </div>
    <div class="toolbar">
      ${botones.map(([m, l, primary]) => `<button class="btn ${primary ? 'primary' : 'ghost'}" data-new="${m}">${l}</button>`).join('')}
      <a class="btn ghost" href="#imprimir/historia/${p.id}">🖨 Imprimir historia</a>
      <a class="btn ghost" href="#pacientes">← Volver</a>
    </div>
    <div class="timeline">${eventos.length ? eventos.map((e) => `<div class="item"><small>${esc(e.f)} · ${e.t}</small><div>${e.d}</div></div>`).join('') : '<p class="empty">Sin registros clínicos todavía</p>'}</div>`;
  view.querySelectorAll('[data-new]').forEach((b) => {
    b.onclick = () => {
      const preset = { paciente_id: p.id };
      if (b.dataset.new === 'consentimientos') Object.assign(preset, { firmante: h.propietario.nombre, documento_firmante: h.propietario.documento });
      if (b.dataset.new === 'laboratorio') return ordenLabForm(p.id, () => renderHistoria(id));
      openForm(b.dataset.new, null, () => renderHistoria(id), preset);
    };
  });
}

/* ---------- Documentos imprimibles ---------- */
function docHead(titulo, sub = '') {
  const datos = [CONFIG.nit && `NIT ${CONFIG.nit}`, CONFIG.direccion, CONFIG.telefono && `Tel. ${CONFIG.telefono}`, CONFIG.email].filter(Boolean).map(esc).join(' · ');
  return `<div class="doc-head"><div><h2>${esc(CONFIG.nombre_clinica)}</h2><small>${datos}</small></div>
    <div style="text-align:right"><h2>${esc(titulo)}</h2><small>${sub}</small></div></div>`;
}
const kv = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<div><span>${esc(k)}</span>${v === null || v === undefined || v === '' ? '—' : esc(v)}</div>`).join('')}</div>`;
const block = (t, v) => (v ? `<h3>${esc(t)}</h3><pre>${esc(v)}</pre>` : '');

async function pacienteInfo(pid) {
  const p = await api(`/api/pacientes/${pid}`);
  const o = await api(`/api/propietarios/${p.propietario_id}`);
  return kv([['Paciente', p.nombre], ['Especie / Raza', `${p.especie} ${p.raza || ''}`], ['Sexo', p.sexo], ['Peso', p.peso ? `${p.peso} kg` : null], ['Propietario', o.nombre], ['Documento / Tel.', `${o.documento} · ${o.telefono}`]]);
}

async function renderImprimir(tipo, id) {
  $('#title').textContent = 'Vista de impresión';
  let html = '';
  if (tipo === 'factura') {
    const f = await api(`/api/facturas/${id}`);
    html = `${docHead(f.tipo === 'Factura' ? 'Factura de venta' : 'Presupuesto', `N.º ${esc(f.numero)} · ${esc(f.fecha)} · ${badge(f.estado)}`)}
      ${kv([['Cliente', f.propietario_nombre], ['Documento', f.propietario_documento], ['Teléfono', f.propietario_telefono], ['Dirección', f.propietario_direccion], ['Paciente', f.paciente_nombre], ['Pago', f.metodo_pago || 'Pendiente']])}
      <h3>Detalle</h3><table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>Total</th></tr></thead>
      <tbody>${f.items.map((i) => `<tr><td>${esc(i.descripcion)}</td><td>${i.cantidad}</td><td>${money(i.precio)}</td><td>${i.iva}%</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table>
      <div class="totales" style="margin-top:12px"><div><span>Subtotal</span><span>${money(f.subtotal)}</span></div><div><span>Descuento</span><span>− ${money(f.descuento)}</span></div>
      <div><span>IVA</span><span>${money(f.impuestos)}</span></div><div class="grand"><span>Total</span><span>${money(f.total)}</span></div></div>
      ${f.notas ? `<p><small>${esc(f.notas)}</small></p>` : ''}
      ${f.tipo === 'Presupuesto' ? '<p><small>Presupuesto válido por 15 días. Los valores pueden variar según la evolución del paciente.</small></p>' : ''}`;
  } else if (tipo === 'lab') {
    html = await informeLab(id);
  } else if (tipo === 'historia') {
    const h = await api(`/api/pacientes/${id}/historia`);
    html = `${docHead('Historia clínica', `Impresa el ${hoyISO()}`)}${await pacienteInfo(id)}
      ${h.paciente.alergias ? `<h3>Alertas</h3><p>${esc(h.paciente.alergias)}</p>` : ''}
      ${h.consultas.map((c) => `<h3>Consulta ${esc(c.fecha)} — ${esc(c.motivo)}</h3>
        <p><small>T° ${esc(c.temperatura) || '—'} · Peso ${esc(c.peso) || '—'} kg · FC ${esc(c.frecuencia_cardiaca) || '—'} · FR ${esc(c.frecuencia_respiratoria) || '—'} · ${esc(c.veterinario)}</small></p>
        ${['anamnesis', 'examen_fisico', 'diagnostico', 'tratamiento'].map((k) => (c[k] ? `<p><strong>${esc(META.consultas.fields.find((f) => f.name === k).label)}:</strong> ${esc(c[k])}</p>` : '')).join('')}`).join('')}
      ${h.vacunas.length ? `<h3>Vacunación y desparasitación</h3><table><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Lote</th><th>Próxima</th></tr>${h.vacunas.map((v) => `<tr><td>${esc(v.fecha_aplicacion)}</td><td>${esc(v.tipo)}</td><td>${esc(v.vacuna)}</td><td>${esc(v.lote)}</td><td>${esc(v.proxima_dosis)}</td></tr>`).join('')}</table>` : ''}
      ${h.cirugias.map((c) => `<h3>Cirugía ${esc(c.fecha)} — ${esc(c.procedimiento)}</h3><p>${esc(c.estado)} · ${esc(c.asa || '')} · Cirujano: ${esc(c.cirujano || '—')}</p>${c.hallazgos ? `<p>${esc(c.hallazgos)}</p>` : ''}`).join('')}`;
  } else if (['recetas', 'cirugias', 'consentimientos'].includes(tipo)) {
    const def = META[tipo];
    const r = await api(`/api/${tipo}/${id}`);
    const datos = await pacienteInfo(r.paciente_id);
    const label = (k) => def.fields.find((f) => f.name === k).label;
    if (tipo === 'recetas') {
      html = `${docHead('Fórmula médica', esc(r.fecha))}${datos}${block('Medicamentos', r.medicamentos)}${block('Indicaciones', r.indicaciones)}
        <div class="firma-box"><div>${esc(r.veterinario)}<br>${r.tarjeta_profesional ? `T.P. ${esc(r.tarjeta_profesional)}` : 'Médico veterinario'}</div></div>`;
    } else if (tipo === 'cirugias') {
      html = `${docHead('Registro quirúrgico y anestésico', `${esc(r.fecha)} · ${badge(r.estado)}`)}${datos}
        <h3>Procedimiento</h3>${kv([['Procedimiento', r.procedimiento], ['Cirujano', r.cirujano], ['Anestesiólogo', r.anestesiologo], ['Riesgo ASA', r.asa], ['Ayuno', r.ayuno ? `${r.ayuno} h` : null], ['Horario', `${r.hora_inicio || '—'} a ${r.hora_fin || '—'}`]])}
        ${['premedicacion', 'induccion', 'mantenimiento', 'monitoreo', 'hallazgos', 'complicaciones', 'postoperatorio'].map((k) => block(label(k), r[k])).join('')}
        <div class="firma-box"><div>Cirujano</div><div>Anestesiólogo</div></div>`;
    } else {
      html = `${docHead(`Consentimiento informado — ${r.tipo}`, esc(r.fecha))}${datos}${block('Declaración', r.texto)}
        <div style="margin-top:24px"><img src="${esc(r.firma)}" alt="firma" style="max-height:110px" />
        <div style="border-top:1px solid #333;width:300px;padding-top:6px;font-size:12px">${esc(r.firmante)} · Doc. ${esc(r.documento_firmante)}</div></div>`;
    }
  } else {
    html = '<p class="empty">Documento no encontrado</p>';
  }
  view.innerHTML = `<div class="toolbar no-print"><button class="btn primary" id="print">🖨 Imprimir / Guardar PDF</button><button class="btn ghost" id="back">← Volver</button></div><div class="doc">${html}</div>`;
  $('#print').onclick = () => window.print();
  $('#back').onclick = () => history.back();
}

/* ---------- Laboratorio clínico ---------- */
const LAB_ESTADOS = ['Solicitado', 'Muestra tomada', 'En proceso', 'Validado', 'Entregado', 'Anulado'];
const esClinico = () => ['admin', 'veterinario'].includes(USER.rol);
const fmtRef = (r) => (r.tipo === 'texto' ? esc(r.normal || '—') : r.ref_min === null ? '—' : `${r.ref_min} – ${r.ref_max}`);
const flag = (i) => (i === 'Alto' ? '<span class="badge bad">▲ Alto</span>' : i === 'Bajo' ? '<span class="badge bad">▼ Bajo</span>' : i === 'Normal' ? '<span class="badge ok">Normal</span>' : '');

async function renderLaboratorio(tab = 'ordenes') {
  $('#title').textContent = 'Laboratorio clínico';
  const tabs = `<div class="toolbar"><a class="btn ${tab === 'ordenes' ? 'primary' : 'ghost'}" href="#laboratorio/ordenes">Órdenes y resultados</a>
    <a class="btn ${tab === 'catalogo' ? 'primary' : 'ghost'}" href="#laboratorio/catalogo">Catálogo de exámenes</a></div>`;
  if (tab === 'catalogo') return renderLabCatalogo(tabs);
  view.innerHTML = `${tabs}<div class="toolbar filters">
      <input id="q" placeholder="Buscar por código, paciente, propietario o examen..." style="flex:1" />
      <select id="festado"><option value="">Pendientes</option><option value="*">Todos</option>${LAB_ESTADOS.map((s) => `<option>${s}</option>`).join('')}</select>
      <button class="btn primary" id="new">+ Nueva orden</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Solicitud</th><th>Paciente</th><th>Examen</th><th>Prioridad</th><th>Estado</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const load = async () => {
    const est = $('#festado').value;
    const qs = new URLSearchParams({ q: $('#q').value, ...(est === '' ? { pendientes: 1 } : est === '*' ? {} : { estado: est }) });
    const list = await api(`/api/lab/ordenes?${qs}`);
    $('#rows').innerHTML = list.length ? list.map((o) => `<tr>
      <td><strong>${esc(o.codigo)}</strong></td><td>${esc(o.fecha_solicitud)}</td>
      <td>${esc(o.paciente)} <small>(${esc(o.especie)})</small><br><small>${esc(o.propietario)}</small></td>
      <td>${esc(o.examen)}<br><small>${esc(o.categoria)}</small></td><td>${o.prioridad === 'Urgente' ? badge('Urgente') : 'Normal'}</td><td>${badge(o.estado)}</td>
      <td class="acts">
        ${o.estado === 'Solicitado' ? `<button class="btn sm primary" data-act="muestra" data-id="${o.id}">Registrar muestra</button>` : ''}
        ${['Muestra tomada', 'En proceso'].includes(o.estado) && esClinico() ? `<button class="btn sm primary" data-act="resultados" data-id="${o.id}">Resultados</button>` : ''}
        ${o.estado === 'Validado' ? `<button class="btn sm ghost" data-act="entregar" data-id="${o.id}">Marcar entregado</button>` : ''}
        <a class="btn sm ghost" href="#imprimir/lab/${o.id}">${['Validado', 'Entregado'].includes(o.estado) ? 'Informe + QR' : 'Ver'}</a>
        ${['Validado', 'Entregado'].includes(o.estado) ? `<button class="btn sm wa" data-act="whatsapp" data-id="${o.id}">WhatsApp</button>` : ''}
        ${['Validado', 'Entregado'].includes(o.estado) && USER.rol === 'admin' ? `<button class="btn sm ghost" data-act="reabrir" data-id="${o.id}">Reabrir</button>` : ''}
        ${o.estado !== 'Anulado' && (USER.rol === 'admin' || !['Validado', 'Entregado'].includes(o.estado)) ? `<button class="btn sm danger" data-act="anular" data-id="${o.id}">Anular</button>` : ''}
      </td></tr>`).join('') : '<tr><td colspan="7" class="empty">No hay órdenes</td></tr>';
  };
  $('#rows').onclick = async (e) => {
    const { act, id } = e.target.dataset;
    if (!act) return;
    try {
      if (act === 'muestra') { await post(`/api/lab/ordenes/${id}/muestra`); toast('Muestra registrada', true); }
      if (act === 'resultados') return resultadosForm(id, load);
      if (act === 'entregar') await post(`/api/lab/ordenes/${id}/entregar`);
      if (act === 'whatsapp') { const o = await api(`/api/lab/ordenes/${id}`); if (o.whatsapp) window.open(o.whatsapp, '_blank', 'noopener'); else toast('El propietario no tiene un celular válido'); return; }
      if (act === 'reabrir' && !confirm('¿Reabrir el resultado? El código QR mostrará "no validado" hasta que se valide de nuevo.')) return;
      if (act === 'reabrir') await post(`/api/lab/ordenes/${id}/reabrir`);
      if (act === 'anular') { if (!confirm('¿Anular esta orden?')) return; await post(`/api/lab/ordenes/${id}/anular`); }
      load();
    } catch (err) { toast(errText(err)); }
  };
  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#festado').onchange = load;
  $('#new').onclick = () => ordenLabForm(null, load);
  await load();
}

async function ordenLabForm(pacienteId, onSaved) {
  const [pacientes, catalogo] = await Promise.all([refOptions('pacientes'), api('/api/lab/catalogo?activos=1')]);
  $('#modal').classList.add('wide');
  $('#form-title').textContent = 'Nueva orden de laboratorio';
  $('#form-errors').textContent = '';
  const porCat = {};
  catalogo.forEach((e) => { (porCat[e.categoria] = porCat[e.categoria] || []).push(e); });
  $('#form-fields').innerHTML = `
    <label><span class="req">Paciente</span><select name="paciente_id" required><option value="">— Seleccione —</option>${pacientes.map((p) => `<option value="${p.id}" ${p.id == pacienteId ? 'selected' : ''}>${esc(p.nombre)} (${esc(p.especie)} · ${esc(p.propietario_id_label)})</option>`).join('')}</select></label>
    <label><span>Prioridad</span><select name="prioridad"><option>Normal</option><option>Urgente</option></select></label>
    <label><span>Médico solicitante</span><input name="solicitante" value="${esc(USER.nombre)}" /></label>
    <label><span>Toma de muestra (vacío = pendiente)</span><input type="datetime-local" name="fecha_toma" /></label>
    <div class="full"><span class="req">Exámenes</span><div class="lab-cat">${Object.entries(porCat).map(([cat, ex]) => `<fieldset><legend>${esc(cat)}</legend>${ex.map((e) => `
      <label class="chk"><input type="checkbox" name="examen_ids" value="${e.id}" /> <span><strong>${esc(e.nombre)}</strong> · ${money(e.precio)}${e.tiempo_entrega ? ` · ${e.tiempo_entrega} h` : ''}<br><small>${esc(e.muestra || '')}</small></span></label>`).join('')}</fieldset>`).join('')}</div></div>
    <label class="full"><span>Observaciones / historia clínica relevante</span><textarea name="observaciones"></textarea></label>
    <div class="full" id="indicaciones"></div>`;
  $('#form-fields').onchange = () => {
    const sel = [...document.querySelectorAll('[name=examen_ids]:checked')].map((c) => catalogo.find((e) => e.id == c.value));
    $('#indicaciones').innerHTML = sel.length ? `<div class="panel"><strong>Manejo de muestras</strong>${sel.map((e) => `<p><strong>${esc(e.nombre)}:</strong> ${esc(e.muestra || '')}. ${esc(e.indicaciones || '')}</p>`).join('')}
      <p><strong>Total estimado: ${money(sel.reduce((s, e) => s + e.precio, 0))}</strong></p></div>` : '';
  };
  bindModal(async (form) => {
    const fd = new FormData(form);
    const body = Object.fromEntries(fd);
    body.examen_ids = fd.getAll('examen_ids');
    const ordenes = await post('/api/lab/ordenes', body);
    toast(`${ordenes.length} orden(es) creada(s): ${ordenes.map((o) => o.codigo).join(', ')}`, true);
    onSaved && onSaved();
  });
}

async function resultadosForm(id, onSaved) {
  const o = await api(`/api/lab/ordenes/${id}`);
  const actual = Object.fromEntries(o.resultados.map((r) => [r.parametro, r.valor]));
  const refs = Object.fromEntries(o.resultados.map((r) => [r.parametro, r]));
  const especieRef = (p) => (o.especie === 'Canino' ? p.can : o.especie === 'Felino' ? p.fel : p.otro);
  $('#modal').classList.add('wide');
  $('#form-title').textContent = `Resultados · ${o.codigo} · ${o.examen} · ${o.paciente} (${o.especie})`;
  $('#form-errors').textContent = '';
  $('#form-fields').innerHTML = `<div class="full"><table class="items-table"><thead><tr><th>Parámetro</th><th style="width:22%">Resultado</th><th>Unidad</th><th>Referencia (${esc(o.especie)})</th><th></th></tr></thead><tbody>
    ${o.parametros.map((p, i) => {
      const r = especieRef(p);
      const ref = p.tipo === 'texto' ? esc(p.normal || '—') : r ? `${r[0]} – ${r[1]}` : '—';
      return `<tr><td>${esc(p.nombre)}</td><td><input data-p="${i}" ${p.tipo === 'texto' ? `placeholder="${esc(p.normal || '')}" list="dl-${i}"` : 'inputmode="decimal"'} value="${esc(actual[p.nombre] ?? refs[p.nombre]?.valor ?? '')}" />
        ${p.tipo === 'texto' && p.normal ? `<datalist id="dl-${i}"><option value="${esc(p.normal)}"></datalist>` : ''}</td>
        <td>${esc(p.unidad || '')}</td><td>${ref}</td><td data-flag="${i}"></td></tr>`;
    }).join('')}</tbody></table></div>
    <label class="full"><span>Interpretación / conclusión</span><textarea name="conclusion">${esc(o.conclusion || '')}</textarea></label>
    <label class="full chk"><input type="checkbox" name="validar" /> <span>Validar y liberar el resultado (queda bloqueado y se habilita la verificación por QR)</span></label>`;
  const recalc = () => o.parametros.forEach((p, i) => {
    const r = especieRef(p);
    const n = Number(String($(`[data-p="${i}"]`).value).replace(',', '.'));
    const v = $(`[data-p="${i}"]`).value.trim();
    $(`[data-flag="${i}"]`).innerHTML = p.tipo === 'texto' || !r || v === '' || Number.isNaN(n) ? '' : flag(n < r[0] ? 'Bajo' : n > r[1] ? 'Alto' : 'Normal');
  });
  $('#form-fields').oninput = recalc;
  recalc();
  bindModal(async (form) => {
    const valores = {};
    o.parametros.forEach((p, i) => { valores[p.nombre] = $(`[data-p="${i}"]`).value; });
    await api(`/api/lab/ordenes/${id}/resultados`, { method: 'PUT', body: JSON.stringify({ valores, conclusion: form.conclusion.value }) });
    if (form.validar.checked) { await post(`/api/lab/ordenes/${id}/validar`); toast('Resultado validado', true); } else toast('Resultados guardados', true);
    onSaved && onSaved();
  });
}

async function informeLab(id) {
  const o = await api(`/api/lab/ordenes/${id}`);
  const valido = ['Validado', 'Entregado'].includes(o.estado);
  const filas = o.resultados.length ? o.resultados : o.parametros.map((p) => ({ parametro: p.nombre, valor: '', unidad: p.unidad, tipo: p.tipo, normal: p.normal, ref_min: null, ref_max: null }));
  return `${valido ? '' : '<div class="watermark">PRELIMINAR · NO VÁLIDO</div>'}
    ${docHead('Informe de laboratorio clínico', `${esc(o.codigo)} · ${badge(o.estado)}`)}
    ${kv([['Paciente', o.paciente], ['Especie / Raza', `${o.especie} ${o.raza || ''}`], ['Sexo', o.sexo], ['Propietario', o.propietario], ['Documento', o.propietario_documento], ['Médico solicitante', o.solicitante],
      ['Examen', o.examen], ['Muestra', o.muestra], ['Fecha de toma', o.fecha_toma], ['Fecha de solicitud', o.fecha_solicitud], ['Fecha de validación', o.fecha_validacion], ['Prioridad', o.prioridad]])}
    <h3>${esc(o.categoria)} — ${esc(o.examen)}</h3>
    <table class="lab-table"><thead><tr><th>Parámetro</th><th>Resultado</th><th>Unidad</th><th>Valor de referencia</th><th></th></tr></thead>
    <tbody>${filas.map((r) => `<tr class="${r.interpretacion && r.interpretacion !== 'Normal' ? 'fuera' : ''}"><td>${esc(r.parametro)}</td><td><strong>${esc(r.valor || '—')}</strong></td><td>${esc(r.unidad)}</td><td>${fmtRef(r)}</td><td>${flag(r.interpretacion)}</td></tr>`).join('')}</tbody></table>
    ${o.conclusion ? `<h3>Interpretación</h3><pre>${esc(o.conclusion)}</pre>` : ''}
    ${o.observaciones ? `<p><small><strong>Observaciones:</strong> ${esc(o.observaciones)}</small></p>` : ''}
    <div class="lab-foot">
      <div class="firma-box" style="flex:1;margin-top:20px"><div>${valido ? `Validado por: ${esc(o.validado_por)}<br>${esc(o.fecha_validacion)}` : 'Pendiente de validación'}</div></div>
      ${valido ? `<div class="qr-box"><img src="/api/lab/ordenes/${o.id}/qr.svg" alt="Código QR de verificación" /><small>Escanee para verificar la autenticidad de este resultado<br><strong>${esc(o.codigo)}</strong></small></div>` : ''}
    </div>
    <p><small>Los valores de referencia corresponden a la especie del paciente y a la metodología del laboratorio. Los resultados deben ser interpretados por el médico veterinario tratante en conjunto con la historia clínica.</small></p>`;
}

async function renderLabCatalogo(tabs) {
  const [cat, categorias] = await Promise.all([api('/api/lab/catalogo'), api('/api/lab/categorias')]);
  const admin = USER.rol === 'admin';
  view.innerHTML = `${tabs}<div class="toolbar"><span class="kpi-sub" style="flex:1">Los intervalos de referencia iniciales son orientativos: valídelos con la metodología y equipos de su laboratorio.</span>
    ${admin ? '<button class="btn primary" id="new">+ Nuevo examen</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Examen</th><th>Categoría</th><th>Muestra</th><th>Parámetros</th><th>Entrega</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody>
    ${cat.map((e) => `<tr><td>${esc(e.codigo)}</td><td><strong>${esc(e.nombre)}</strong></td><td>${esc(e.categoria)}</td><td><small>${esc(e.muestra || '')}</small></td>
      <td>${e.parametros.length}</td><td>${e.tiempo_entrega ? `${e.tiempo_entrega} h` : '—'}</td><td>${money(e.precio)}</td><td>${badge(e.activo ? 'Activo' : 'Inactivo')}</td>
      <td class="acts">${admin ? `<button class="btn sm ghost" data-edit="${e.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const toLines = (ps) => ps.map((p) => (p.tipo === 'texto' ? `${p.nombre} | texto | ${p.normal || ''}` : `${p.nombre} | ${p.unidad || ''} | ${p.can ? p.can.join('-') : ''} | ${p.fel ? p.fel.join('-') : ''}`)).join('\n');
  const parseRange = (s) => {
    const m = String(s || '').trim().match(/^(-?[\d.,]+)\s*-\s*(-?[\d.,]+)$/);
    return m ? [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))] : undefined;
  };
  const fromLines = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [nombre, b, c, d] = l.split('|').map((x) => x.trim());
    if (b === 'texto') return { nombre, tipo: 'texto', normal: c || '' };
    const p = { nombre, unidad: b || '' };
    const can = parseRange(c); const fel = parseRange(d);
    if (can) p.can = can;
    if (fel) p.fel = fel;
    return p;
  });
  const form = (e) => {
    $('#modal').classList.add('wide');
    $('#form-title').textContent = e ? `Editar ${e.nombre}` : 'Nuevo examen';
    $('#form-errors').textContent = '';
    $('#form-fields').innerHTML = `
      <label><span class="req">Código</span><input name="codigo" required value="${esc(e?.codigo)}" /></label>
      <label><span class="req">Nombre</span><input name="nombre" required value="${esc(e?.nombre)}" /></label>
      <label><span class="req">Categoría</span><select name="categoria" required>${categorias.map((c) => `<option ${c === e?.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label><span>Precio</span><input type="number" name="precio" min="0" value="${esc(e?.precio ?? 0)}" /></label>
      <label><span>Tiempo de entrega (horas)</span><input type="number" name="tiempo_entrega" min="0" value="${esc(e?.tiempo_entrega)}" /></label>
      <label><span>Estado</span><select name="activo"><option value="1">Activo</option><option value="" ${e && !e.activo ? 'selected' : ''}>Inactivo</option></select></label>
      <label class="full"><span>Tipo de muestra</span><input name="muestra" value="${esc(e?.muestra)}" /></label>
      <label class="full"><span>Indicaciones de toma y manejo de la muestra</span><textarea name="indicaciones">${esc(e?.indicaciones)}</textarea></label>
      <label class="full"><span class="req">Parámetros (uno por línea) — numérico: <code>Nombre | unidad | mín-máx canino | mín-máx felino</code> · texto: <code>Nombre | texto | valor normal</code></span>
        <textarea name="parametros" rows="10" style="font-family:monospace">${esc(e ? toLines(e.parametros) : '')}</textarea></label>`;
    bindModal(async (f) => {
      const b = Object.fromEntries(new FormData(f));
      b.parametros = fromLines(b.parametros);
      b.activo = !!b.activo;
      await api(`/api/lab/catalogo${e ? `/${e.id}` : ''}`, { method: e ? 'PUT' : 'POST', body: JSON.stringify(b) });
      renderLabCatalogo(tabs);
    });
  };
  if (admin) {
    $('#new').onclick = () => form(null);
    view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => form(cat.find((x) => x.id == b.dataset.edit)); });
  }
}

/* ---------- Reportes ---------- */
async function renderReportes() {
  $('#title').textContent = 'Reportes';
  const mes = hoyISO().slice(0, 7);
  view.innerHTML = `<div class="toolbar filters"><label>Desde <input type="date" id="desde" value="${mes}-01" /></label><label>Hasta <input type="date" id="hasta" value="${hoyISO()}" /></label>
    <button class="btn primary" id="go">Actualizar</button></div><div id="rep"></div>`;
  const load = async () => {
    const r = await api(`/api/reportes?desde=${$('#desde').value}&hasta=${$('#hasta').value}`);
    const k = r.kpis;
    const bars = (list, key, val, fmt = (x) => x) => {
      const max = Math.max(1, ...list.map((x) => x[val]));
      return list.length ? list.map((x) => `<tr><td style="width:35%">${esc(x[key])}</td><td><div class="bar" style="width:${(x[val] / max) * 100}%"></div></td><td style="width:25%;text-align:right">${fmt(x[val])}</td></tr>`).join('') : '<tr><td class="empty">Sin datos</td></tr>';
    };
    const card = (n, l) => `<div class="card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`;
    $('#rep').innerHTML = `<div class="cards">
        ${card(money(k.ingresos), 'Ingresos')}${card(k.facturas, 'Facturas')}${card(money(k.ticket_promedio), 'Ticket promedio')}${card(money(k.por_cobrar), 'Cartera por cobrar')}
        ${card(k.clientes_nuevos, 'Clientes nuevos')}${card(k.consultas, 'Consultas')}${card(k.cirugias, 'Cirugías finalizadas')}
        ${card(k.tasa_asistencia === null ? '—' : `${k.tasa_asistencia}%`, `Asistencia a citas (${k.citas_atendidas} atendidas · ${k.citas_no_asistio} no asistió)`)}
      </div><div class="panels">
        <div class="panel"><h3>Ingresos por mes (12 meses)</h3><table>${bars(r.por_mes, 'mes', 'total', money)}</table></div>
        <div class="panel"><h3>Ingresos por método de pago</h3><table>${bars(r.por_metodo, 'metodo_pago', 'total', money)}</table></div>
        <div class="panel"><h3>Productos y servicios más vendidos</h3><table>${bars(r.top_productos, 'descripcion', 'total', money)}</table></div>
        <div class="panel"><h3>Diagnósticos más frecuentes</h3><table>${bars(r.diagnosticos, 'diagnostico', 'cantidad')}</table></div>
        <div class="panel"><h3>Pacientes por especie</h3><table>${bars(r.por_especie, 'especie', 'cantidad')}</table></div>
      </div>`;
  };
  $('#go').onclick = load;
  await load();
}

/* ---------- Usuarios ---------- */
async function renderUsuarios() {
  $('#title').textContent = 'Usuarios';
  const ROLES = [['admin', 'Administrador'], ['veterinario', 'Veterinario'], ['recepcion', 'Recepción']];
  view.innerHTML = `<div class="toolbar"><span class="kpi-sub" style="flex:1">Administrador: todo · Veterinario: módulos clínicos · Recepción: agenda, clientes, facturación e inventario</span>
    <button class="btn primary" id="new">+ Nuevo usuario</button></div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const load = async () => {
    const list = await api('/api/usuarios');
    $('#rows').innerHTML = list.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${esc(u.rol)}</td><td>${badge(u.activo ? 'Activo' : 'Inactivo')}</td>
      <td class="acts"><button class="btn sm ghost" data-edit="${u.id}">Editar</button>
      <button class="btn sm ${u.activo ? 'danger' : 'ghost'}" data-toggle="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('');
    $('#rows').onclick = async (e) => {
      const { edit, toggle } = e.target.dataset;
      try {
        if (toggle) { await api(`/api/usuarios/${toggle}`, { method: 'PUT', body: JSON.stringify({ activo: e.target.dataset.activo !== 'true' }) }); load(); }
        if (edit) {
          const u = list.find((x) => x.id == edit);
          openCustomForm('Editar usuario', [
            { name: 'nombre', label: 'Nombre', required: true }, { name: 'rol', label: 'Rol', type: 'select', options: ROLES },
            { name: 'password', label: 'Nueva contraseña (vacío = sin cambio)', type: 'password' },
          ], u, async (b) => { await api(`/api/usuarios/${u.id}`, { method: 'PUT', body: JSON.stringify(b) }); load(); });
        }
      } catch (err) { toast(errText(err)); }
    };
  };
  $('#new').onclick = () => openCustomForm('Nuevo usuario', [
    { name: 'nombre', label: 'Nombre', required: true }, { name: 'usuario', label: 'Usuario', required: true },
    { name: 'rol', label: 'Rol', type: 'select', options: ROLES }, { name: 'password', label: 'Contraseña (mín. 8)', type: 'password', required: true },
  ], { rol: 'recepcion' }, async (b) => { await post('/api/usuarios', b); load(); });
  await load();
}

/* ---------- Configuración ---------- */
async function renderConfig() {
  $('#title').textContent = 'Configuración';
  const c = await api('/api/configuracion');
  const url = `${location.origin}/reservar.html`;
  const campos = [['nombre_clinica', 'Nombre de la clínica'], ['nit', 'NIT'], ['direccion', 'Dirección'], ['telefono', 'Teléfono'], ['email', 'Correo'],
    ['hora_apertura', 'Hora de apertura', 'time'], ['hora_cierre', 'Hora de cierre', 'time'], ['duracion_cita', 'Duración de cita (min)', 'number'],
    ['url_publica', 'URL pública del sistema (para los códigos QR, ej. https://vet.midominio.com)', 'url']];
  view.innerHTML = `<div class="panels"><form class="panel" id="cfg"><h3>Datos de la clínica (aparecen en facturas, recetas y recordatorios)</h3><div class="grid">
      ${campos.map(([k, l, t]) => `<label>${l}<input name="${k}" type="${t || 'text'}" value="${esc(c[k])}" /></label>`).join('')}</div>
      <div class="actions"><button class="btn primary">Guardar</button></div></form>
    <div class="panel"><h3>🌐 Reserva de citas en línea</h3><p>Comparta este enlace con sus clientes (redes sociales, WhatsApp, sitio web). Las solicitudes llegan a la Agenda con estado <strong>Solicitada</strong> para que las confirme.</p>
      <p><a href="${url}" target="_blank">${url}</a></p><button class="btn ghost" id="copy">Copiar enlace</button></div></div>`;
  $('#copy').onclick = () => navigator.clipboard.writeText(url).then(() => toast('Enlace copiado', true));
  $('#cfg').onsubmit = async (e) => {
    e.preventDefault();
    try {
      CONFIG = await api('/api/configuracion', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      $('#brand-name').textContent = CONFIG.nombre_clinica;
      toast('Configuración guardada', true);
    } catch (err) { toast(errText(err)); }
  };
}

/* ---------- Inicio ---------- */
$('#toggle').onclick = () => $('#sidebar').classList.toggle('open');
// Al cerrar el modal se limpian los manejadores propios de cada formulario
$('#modal').addEventListener('close', () => { $('#form-fields').onchange = null; $('#form-fields').oninput = null; });
window.addEventListener('hashchange', route);
api('/api/me').then(startApp).catch(showLogin);
