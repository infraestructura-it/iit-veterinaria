// Autenticación con sesiones en SQLite y contraseñas con scrypt (sin dependencias externas).
const crypto = require('node:crypto');

const ROLES = ['admin', 'veterinario', 'recepcion'];
const SESSION_HOURS = 12;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(password), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function publicUser(u) {
  return u && { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, activo: !!u.activo };
}

/** Crea el administrador inicial si no hay usuarios. Devuelve la contraseña si se generó. */
function ensureAdmin(db, adminPassword) {
  const n = db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;
  if (n > 0) return null;
  const password = adminPassword || crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)')
    .run('Administrador', 'admin', hashPassword(password), 'admin');
  return adminPassword ? null : password;
}

function registerAuth(app, db) {
  // Middleware: carga el usuario de la sesión (si existe)
  app.use((req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = db.prepare(
        'SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND s.expira > ? AND u.activo = 1'
      ).get(token, Date.now());
      if (row) { req.user = row; req.sessionToken = token; }
    }
    next();
  });

  app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(String(usuario || ''));
    if (!u || !verifyPassword(password || '', u.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now());
    db.prepare('INSERT INTO sesiones (token, usuario_id, expira) VALUES (?,?,?)')
      .run(token, u.id, Date.now() + SESSION_HOURS * 3600e3);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
    res.json(publicUser(u));
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sesiones WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    res.json(publicUser(req.user));
  });

  // Todo lo demás en /api requiere sesión (excepto /api/publico/*)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/publico/')) return next();
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    next();
  });

  app.put('/api/me/password', (req, res) => {
    const { actual, nueva } = req.body || {};
    if (!verifyPassword(actual || '', req.user.password_hash)) return res.status(400).json({ errors: ['La contraseña actual no es correcta'] });
    if (!nueva || String(nueva).length < 8) return res.status(400).json({ errors: ['La nueva contraseña debe tener al menos 8 caracteres'] });
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(nueva), req.user.id);
    res.status(204).end();
  });

  // Gestión de usuarios (solo admin)
  const adminOnly = requireRole('admin');
  app.get('/api/usuarios', adminOnly, (_req, res) => {
    res.json(db.prepare('SELECT * FROM usuarios ORDER BY nombre').all().map(publicUser));
  });

  app.post('/api/usuarios', adminOnly, (req, res) => {
    const { nombre, usuario, password, rol } = req.body || {};
    const errors = [];
    if (!nombre) errors.push('Nombre es obligatorio');
    if (!usuario || !/^[a-zA-Z0-9._-]{3,30}$/.test(usuario)) errors.push('Usuario inválido (3-30 caracteres: letras, números, . _ -)');
    if (!password || String(password).length < 8) errors.push('La contraseña debe tener al menos 8 caracteres');
    if (!ROLES.includes(rol)) errors.push('Rol inválido');
    if (errors.length) return res.status(400).json({ errors });
    try {
      const info = db.prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)')
        .run(nombre, usuario, hashPassword(password), rol);
      res.status(201).json(publicUser(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid)));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ errors: ['Ese nombre de usuario ya existe'] });
      throw e;
    }
  });

  app.put('/api/usuarios/:id', adminOnly, (req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { nombre, rol, activo, password } = req.body || {};
    if (rol !== undefined && !ROLES.includes(rol)) return res.status(400).json({ errors: ['Rol inválido'] });
    if (password !== undefined && password !== '' && String(password).length < 8) {
      return res.status(400).json({ errors: ['La contraseña debe tener al menos 8 caracteres'] });
    }
    const quitaAdmin = u.rol === 'admin' && ((rol && rol !== 'admin') || activo === false);
    if (quitaAdmin && db.prepare("SELECT COUNT(*) c FROM usuarios WHERE rol='admin' AND activo=1").get().c <= 1) {
      return res.status(400).json({ errors: ['Debe quedar al menos un administrador activo'] });
    }
    db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?')
      .run(nombre ?? u.nombre, rol ?? u.rol, activo === undefined ? u.activo : (activo ? 1 : 0), u.id);
    if (password) db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    if (activo === false) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(u.id);
    res.json(publicUser(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.id)));
  });
}

function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!allowed.includes(req.user.rol)) return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    next();
  };
}

module.exports = { registerAuth, requireRole, ensureAdmin, hashPassword, verifyPassword, ROLES };
