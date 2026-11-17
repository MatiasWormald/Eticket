/* ==========================================================================
   MODO DEMOSTRACIÓN
   Simula en este navegador lo que el backend todavía no tiene (tiers, cuentas,
   verificación en dos pasos y cambio de estado), usando los tickets reales de GLPI.
   Se activa con demoMode: true en config.js. Para el proyecto final se pone en
   false (o se borra este archivo y su <script> en index.html).
   Los datos simulados se guardan en localStorage de este navegador: no llegan a
   GLPI ni los ven otros computadores.
   ========================================================================== */
(function () {
  'use strict';
  const config = window.ETICKET_CONFIG || {};
  if (!config.demoMode) return;

  const KEY = 'eticket-demo-v1';
  const SL = { 1: 'Recibida', 2: 'En curso', 3: 'Planificada', 4: 'En espera', 5: 'Resuelta', 6: 'Cerrada' };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  const save = data => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* sin almacenamiento */ } };
  const db = Object.assign({ tickets: {}, users: null, base: null }, load());
  if (!db.users) db.users = [
    { id: 1, name: 'Cliente Demostración', email: 'cliente.demo@example.com', login: 'cliente.demo', role: 'cliente', tier: null, active: true },
    { id: 2, name: 'Agente Demostración', email: 'agente.demo@example.com', login: 'agente.demo', role: 'agente', tier: 4, active: true },
    { id: 3, name: 'Gestor Demostración', email: 'gestor.demo@example.com', login: 'gestor.demo', role: 'gestor', tier: null, active: true },
  ];
  const persist = () => save(db);
  const rec = id => (db.tickets[id] = db.tickets[id] || { level: 4, esc: [], status: null });
  const pad = n => String(n).padStart(2, '0');
  const now = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  let user = null;            // usuario de la sesión actual
  let pending = null;         // login correcto que espera el código
  const PENDING = 'eticket-demo-2fa';
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  const levelAt = (r, date) => r.esc.filter(e => String(e.date) <= String(date)).reduce((level, e) => e.to, 4);
  function augment(t) {
    if (!t || !t.id) return t;
    const r = rec(t.id);
    const role = user && user.role; const staff = !!role && role !== 'cliente';
    if (r.status && t.status <= 4) { t.status = r.status; t.status_label = SL[r.status]; }
    const open = t.status <= 4;
    t.tier = { level: r.level };
    t.escalations = staff ? r.esc : r.esc.map(({ reason, by, ...e }) => e);
    if (Array.isArray(t.messages)) t.messages = t.messages.map(m => {
      const fromTeam = m.kind === 'solution' || m.private || !(t.requesters || []).includes(m.author);
      const isGestor = role === 'gestor' && user && m.author === user.name;
      return fromTeam && !isGestor ? { ...m, tier: levelAt(r, m.date) } : m;
    });
    if (t.permissions) t.permissions = { ...t.permissions, status: staff && open, escalate: staff && open && r.level > 1, reassign: role === 'gestor' && open };
    return t;
  }
  async function realJson(url, options) {
    const response = await realFetch(url, options);
    const type = response.headers.get('content-type') || '';
    return { response, data: type.includes('application/json') ? await response.clone().json() : null };
  }
  const bodyOf = options => { try { return typeof options.body === 'string' ? JSON.parse(options.body) : {}; } catch (_) { return {}; } };
  async function freshTicket(url, id) {
    const u = new URL(url); u.search = new URLSearchParams({ action: 'ticket', id }).toString();
    const { data } = await realJson(u, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' });
    return json({ ticket: augment(data.ticket) });
  }

  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, window.location.href);
    const action = url.searchParams.get('action');
    if (!action || !/\/api$/.test(url.pathname)) return realFetch(input, options);
    const id = url.searchParams.get('id');
    const body = bodyOf(options);
    switch (action) {
      case 'session': {
        const { response, data } = await realJson(url, options);
        if (data && data.user && sessionStorage.getItem(PENDING)) return json({ user: null, csrf: data.csrf });
        user = data && data.user; return response;
      }
      case 'login': {
        let { response, data } = await realJson(url, options);
        if (response.status === 409) { // quedó una sesión abierta de una verificación anterior
          const s = await realJson(new URL('api?action=session', url), { credentials: 'same-origin' });
          await realFetch(new URL('api?action=logout', url), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Eticket-CSRF': s.data.csrf }, body: '{}' });
          const s2 = await realJson(new URL('api?action=session', url), { credentials: 'same-origin' });
          ({ response, data } = await realJson(url, { ...options, headers: { ...options.headers, 'X-Eticket-CSRF': s2.data.csrf } }));
        }
        if (!response.ok || !data || !data.user) return response;
        pending = data; sessionStorage.setItem(PENDING, '1');
        return json({ verification_required: true, csrf: data.csrf });
      }
      case 'verify_login': {
        if (!/^\d{6}$/.test(String(body.code || ''))) return json({ error: 'Escribe un código de 6 dígitos.' }, 422);
        sessionStorage.removeItem(PENDING);
        if (!pending) { const s = await realJson(new URL('api?action=session', url), { credentials: 'same-origin' }); pending = s.data; }
        if (!pending || !pending.user) return json({ error: 'Tu sesión venció. Vuelve a ingresar tus datos.' }, 401);
        user = pending.user; const result = { user: pending.user, csrf: pending.csrf }; pending = null;
        return json(result);
      }
      case 'resend_code': return json({ ok: true });
      case 'register': return json({ ok: true });
      case 'logout': { sessionStorage.removeItem(PENDING); user = null; return realFetch(input, options); }
      case 'tickets': {
        const { response, data } = await realJson(url, options);
        if (!response.ok) return response;
        data.tickets = data.tickets.map(t => ({ ...t, tier: { level: rec(t.id).level } }));
        return json(data);
      }
      case 'ticket': case 'reply': case 'edit': case 'solve': case 'approve': case 'create': {
        if (action === 'solve' || action === 'approve') { if (id) { rec(id).status = null; persist(); } }
        const { response, data } = await realJson(url, options);
        if (!response.ok || !data || !data.ticket) return response;
        if (action === 'create') { rec(data.ticket.id); persist(); }
        return json({ ...data, ticket: augment(data.ticket) }, response.status);
      }
      case 'status': {
        const status = Number(body.status);
        if (!(status >= 1 && status <= 4)) return json({ error: 'Estado no válido.' }, 422);
        rec(id).status = status; persist();
        return freshTicket(url, id);
      }
      case 'escalate': {
        const r = rec(id);
        if (r.level <= 1) return json({ error: 'Tier I es el último nivel.' }, 422);
        if (String(body.reason || '').trim().length < 10) return json({ error: 'Escribe un motivo de al menos 10 caracteres.' }, 422);
        r.esc.push({ kind: 'escalate', from: r.level, to: r.level - 1, by: user ? user.name : 'Equipo de soporte', date: now(), reason: body.reason });
        r.level -= 1; r.status = null; persist();
        return freshTicket(url, id);
      }
      case 'reassign': {
        const r = rec(id); const level = Number(body.level);
        if (!(level >= 1 && level <= 4) || level === r.level) return json({ error: 'Elige un tier distinto al actual.' }, 422);
        if (String(body.reason || '').trim().length < 10) return json({ error: 'Escribe un motivo de al menos 10 caracteres.' }, 422);
        r.esc.push({ kind: 'reassign', from: r.level, to: level, by: user ? user.name : 'Gestor', date: now(), reason: body.reason });
        r.level = level; persist();
        return freshTicket(url, id);
      }
      case 'users': return json({ users: db.users });
      case 'save_user': {
        // En la demostración la cuenta solo se guarda en este navegador: no puede iniciar sesión.
        const { password, ...data } = body;
        if (body.id) { db.users = db.users.map(u => (u.id === body.id ? { ...u, ...data } : u)); persist(); return json({ user: db.users.find(u => u.id === body.id) }); }
        const created = { ...data, id: Date.now(), active: true }; db.users.push(created); persist();
        return json({ user: created });
      }
      case 'schema': {
        const { response, data } = await realJson(url, options);
        if (!response.ok) return response;
        if (db.base) data.schema.base = db.base;
        return json(data);
      }
      case 'save_schema': {
        const { response, data } = await realJson(url, options);
        if (!response.ok) return response;
        db.base = body.base || null; persist();
        data.schema.base = db.base; return json(data);
      }
      default: return realFetch(input, options);
    }
  };

  // Aviso visible para que nadie confunda la simulación con el sistema final.
  const banner = document.createElement('div');
  banner.className = 'demo-banner'; banner.setAttribute('role', 'note');
  banner.innerHTML = '<span><strong>Modo demostración.</strong> Los tiers, las cuentas y la verificación en dos pasos se simulan en este navegador mientras el backend no los tenga. Código de verificación: cualquier número de 6 dígitos.</span><button type="button" class="button subtle small">Reiniciar demostración</button>';
  banner.querySelector('button').onclick = () => { try { localStorage.removeItem(KEY); } catch (_) { /* sin almacenamiento */ } window.location.reload(); };
  document.body.prepend(banner);
})();
