/* IIT Veterinaria — interfaz SPA sin dependencias */
const $ = (s) => document.querySelector(s);
const view = $('#view');
let META = {};
const refCache = {};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

function badge(v) {
  const map = { Atendida: 'ok', 'Dado de alta': 'ok', Confirmada: 'ok', Cancelada: 'bad', 'No asistió': 'bad', Fallecido: 'bad', Hospitalizado: 'warn', 'En observación': 'warn' };
  return `<span class="badge ${map[v] || ''}">${esc(v)}</span>`;
}

function cell(f, row) {
  const v = row[f.name];
  if (f.type === 'ref') return esc(row[`${f.name}_label`]);
  if (f.type === 'select' && f.name === 'estado') return badge(v);
  if (['precio', 'total'].includes(f.name)) return money(v);
  if (f.type === 'textarea') return esc(String(v ?? '').slice(0, 60));
  return esc(v);
}

/* ---------- Router ---------- */
const views = {
  dashboard: renderDashboard,
  reportes: renderReportes,
  historia: renderHistoria,
};

async function route() {
  const [name, param] = (location.hash.slice(1) || 'dashboard').split('/');
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.view === name || (name === 'historia' && a.dataset.view === 'pacientes')));
  $('#sidebar').classList.remove('open');
  try {
    if (views[name]) await views[name](param);
    else if (META[name]) await renderList(name);
    else view.innerHTML = '<p class="empty">Módulo no encontrado</p>';
  } catch (e) {
    view.innerHTML = `<p class="errors">Error: ${esc(e.error || e.message || e)}</p>`;
  }
}

/* ---------- Dashboard ---------- */
async function renderDashboard() {
  $('#title').textContent = 'Inicio';
  const d = await api('/api/dashboard');
  const rows = (list, fn) => list.length ? list.map(fn).join('') : '<tr><td class="empty">Sin registros</td></tr>';
  view.innerHTML = `
    <div class="cards">
      <div class="card"><div class="num">${d.totales.citas_hoy}</div><div class="lbl">Citas hoy</div></div>
      <div class="card"><div class="num">${d.totales.pacientes}</div><div class="lbl">Pacientes</div></div>
      <div class="card"><div class="num">${d.totales.propietarios}</div><div class="lbl">Propietarios</div></div>
      <div class="card"><div class="num">${d.totales.hospitalizados}</div><div class="lbl">Hospitalizados</div></div>
      <div class="card"><div class="num">${money(d.ventas_mes)}</div><div class="lbl">Ventas del mes</div></div>
    </div>
    <div class="panels">
      <div class="panel"><h3>📅 Agenda de hoy (${esc(d.fecha)})</h3><table>${rows(d.citas_hoy, (c) => `<tr><td>${esc(c.hora)}</td><td>${esc(c.paciente_id_label)}</td><td>${esc(c.motivo)}</td><td>${badge(c.estado)}</td></tr>`)}</table></div>
      <div class="panel"><h3>💉 Vacunas próximas / vencidas</h3><table>${rows(d.vacunas_pendientes, (v) => `<tr><td>${esc(v.proxima_dosis)}</td><td>${esc(v.paciente_id_label)}</td><td>${esc(v.vacuna)}</td></tr>`)}</table></div>
      <div class="panel"><h3>📦 Stock bajo</h3><table>${rows(d.stock_bajo, (p) => `<tr><td>${esc(p.nombre)}</td><td><span class="badge bad">${p.stock} / mín ${p.stock_minimo}</span></td></tr>`)}</table></div>
    </div>`;
}

/* ---------- Listado genérico ---------- */
async function renderList(name) {
  const def = META[name];
  $('#title').textContent = def.label;
  const cols = def.fields.filter((f) => f.type !== 'textarea' || ['diagnostico'].includes(f.name)).slice(0, 7);
  view.innerHTML = `
    <div class="toolbar">
      <input id="q" placeholder="Buscar ${esc(def.label.toLowerCase())}..." />
      <button class="btn primary" id="new">+ ${def.fem ? 'Nueva' : 'Nuevo'} ${esc(def.singular.toLowerCase())}</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const load = async () => {
    const q = $('#q').value;
    const data = await api(`/api/${name}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    $('#rows').innerHTML = data.length ? data.map((r) => `
      <tr>${cols.map((f) => `<td>${cell(f, r)}</td>`).join('')}
        <td class="acts">
          ${name === 'pacientes' ? `<a class="btn sm ghost" href="#historia/${r.id}">Historia</a>` : ''}
          <button class="btn sm ghost" data-edit="${r.id}">Editar</button>
          <button class="btn sm danger" data-del="${r.id}">Eliminar</button>
        </td></tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="empty">No hay registros</td></tr>`;
  };

  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#new').onclick = () => openForm(name, null, load);
  $('#rows').onclick = async (e) => {
    const id = e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.edit) openForm(name, await api(`/api/${name}/${id}`), load);
    else {
      if (!confirm('¿Eliminar este registro?')) return;
      try { await api(`/api/${name}/${id}`, { method: 'DELETE' }); delete refCache[name]; load(); }
      catch (err) { showToast((err.errors || [err.error]).join(', ')); }
    }
  };
  await load();
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'errors';
  el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:99';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ---------- Formulario ---------- */
async function refOptions(ref) {
  if (!refCache[ref]) refCache[ref] = await api(`/api/${ref}`);
  return refCache[ref];
}

async function openForm(name, row, onSaved, preset = {}) {
  const def = META[name];
  $('#form-title').textContent = `${row ? 'Editar' : def.fem ? 'Nueva' : 'Nuevo'} ${def.singular.toLowerCase()}`;
  $('#form-errors').textContent = '';
  const html = [];
  for (const f of def.fields) {
    const val = row ? row[f.name] : preset[f.name] ?? f.default ?? (f.type === 'date' && /fecha$|fecha_aplicacion|fecha_ingreso/.test(f.name) ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'textarea') input = `<textarea name="${f.name}" ${req}>${esc(val)}</textarea>`;
    else if (f.type === 'select') input = `<select name="${f.name}" ${req}><option value="">— Seleccione —</option>${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'ref') {
      const opts = await refOptions(f.ref);
      const disp = META[f.ref].display;
      input = `<select name="${f.name}" ${req}><option value="">— Seleccione —</option>${opts.map((o) => `<option value="${o.id}" ${o.id == val ? 'selected' : ''}>${esc(o[disp])}${o.propietario_id_label ? ` (${esc(o.propietario_id_label)})` : ''}</option>`).join('')}</select>`;
    } else input = `<input type="${f.type === 'number' ? 'number" step="any' : f.type}" name="${f.name}" value="${esc(val)}" ${req} />`;
    html.push(`<label class="${f.type === 'textarea' ? 'full' : ''}"><span class="${f.required ? 'req' : ''}">${esc(f.label)}</span>${input}</label>`);
  }
  $('#form-fields').innerHTML = html.join('');
  const modal = $('#modal');
  $('#cancel').onclick = () => modal.close();
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api(`/api/${name}${row ? `/${row.id}` : ''}`, { method: row ? 'PUT' : 'POST', body: JSON.stringify(body) });
      delete refCache[name];
      modal.close();
      onSaved && onSaved();
    } catch (err) {
      $('#form-errors').textContent = (err.errors || [err.error]).join(' · ');
    }
  };
  modal.showModal();
}

/* ---------- Historia clínica ---------- */
async function renderHistoria(id) {
  const h = await api(`/api/pacientes/${id}/historia`);
  const p = h.paciente;
  $('#title').textContent = `Historia clínica — ${p.nombre}`;
  const eventos = [
    ...h.consultas.map((c) => ({ f: c.fecha, t: '🩺 Consulta', d: `<strong>${esc(c.motivo)}</strong><br>Dx: ${esc(c.diagnostico) || '—'}<br>Tx: ${esc(c.tratamiento) || '—'}<br><small>T° ${esc(c.temperatura) || '—'} · Peso ${esc(c.peso) || '—'} kg · FC ${esc(c.frecuencia_cardiaca) || '—'} · ${esc(c.veterinario)}</small>` })),
    ...h.vacunas.map((v) => ({ f: v.fecha_aplicacion, t: `💉 ${esc(v.tipo)}`, d: `${esc(v.vacuna)} ${v.lote ? `(lote ${esc(v.lote)})` : ''} — próxima: ${esc(v.proxima_dosis) || '—'}` })),
    ...h.hospitalizaciones.map((x) => ({ f: x.fecha_ingreso, t: '🏥 Hospitalización', d: `${esc(x.motivo)} ${badge(x.estado)}<br>${esc(x.observaciones)}` })),
    ...h.peluqueria.map((x) => ({ f: x.fecha, t: '✂️ Peluquería', d: `${esc(x.servicio)} ${esc(x.observaciones)}` })),
  ].sort((a, b) => (a.f < b.f ? 1 : -1));
  view.innerHTML = `
    <div class="historia-head">
      <div><span>Paciente</span><strong>${esc(p.nombre)}</strong></div>
      <div><span>Especie / Raza</span>${esc(p.especie)} ${esc(p.raza)}</div>
      <div><span>Sexo</span>${esc(p.sexo) || '—'}</div>
      <div><span>Nacimiento</span>${esc(p.fecha_nacimiento) || '—'}</div>
      <div><span>Peso</span>${esc(p.peso) || '—'} kg</div>
      <div><span>Propietario</span>${esc(h.propietario.nombre)} · ${esc(h.propietario.telefono)}</div>
    </div>
    <div class="toolbar">
      <button class="btn primary" data-new="consultas">+ Consulta</button>
      <button class="btn ghost" data-new="vacunas">+ Vacuna</button>
      <button class="btn ghost" data-new="hospitalizaciones">+ Hospitalización</button>
      <button class="btn ghost" data-new="citas">+ Cita</button>
      <a class="btn ghost" href="#pacientes">← Volver</a>
    </div>
    <div class="timeline">${eventos.length ? eventos.map((e) => `<div class="item"><small>${esc(e.f)} · ${e.t}</small><div>${e.d}</div></div>`).join('') : '<p class="empty">Sin registros clínicos todavía</p>'}</div>`;
  view.querySelectorAll('[data-new]').forEach((b) => {
    b.onclick = () => openForm(b.dataset.new, null, () => renderHistoria(id), { paciente_id: p.id });
  });
}

/* ---------- Reportes ---------- */
async function renderReportes() {
  $('#title').textContent = 'Reportes';
  const r = await api('/api/reportes/ventas');
  const bars = (list, key, val, fmt = (x) => x) => {
    const max = Math.max(1, ...list.map((x) => x[val]));
    return list.length ? list.map((x) => `<tr><td style="width:30%">${esc(x[key])}</td><td><div class="bar" style="width:${(x[val] / max) * 100}%"></div></td><td style="width:25%;text-align:right">${fmt(x[val])}</td></tr>`).join('') : '<tr><td class="empty">Sin datos</td></tr>';
  };
  view.innerHTML = `<div class="panels">
    <div class="panel"><h3>Ventas por mes</h3><table>${bars(r.por_mes, 'mes', 'total', money)}</table></div>
    <div class="panel"><h3>Ventas por método de pago</h3><table>${bars(r.por_metodo, 'metodo_pago', 'total', money)}</table></div>
    <div class="panel"><h3>Pacientes por especie</h3><table>${bars(r.por_especie, 'especie', 'cantidad')}</table></div>
  </div>`;
}

/* ---------- Inicio ---------- */
$('#toggle').onclick = () => $('#sidebar').classList.toggle('open');
window.addEventListener('hashchange', route);
api('/api/meta').then((m) => { META = m; route(); });
