import { api, esc, notice, state, submit } from './core.js';
import { chip, tierLabel, TIERS } from './tiers.js';
import { USER_ROLES } from './profile.js';

const ROLE_HELP = {
  cliente: 'Crea solicitudes y conversa con el equipo. No tiene tier.',
  agente: 'Responde, cambia estados, resuelve y deriva los casos de su tier.',
  gestor: 'Supervisa todo, puede intervenir en cualquier tier y administra Eticket. No tiene tier ni crea solicitudes.',
};
const tempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(12); crypto.getRandomValues(values);
  return Array.from(values, v => chars[v % chars.length]).join('');
};
async function usersAdmin(el, fallbackUrl) {
  let users;
  try { users = (await api('users')).users; }
  catch (error) {
    const glpiLink = `<a class="button subtle" href="${esc(fallbackUrl)}" target="_blank" rel="noopener">Abrir usuarios en GLPI ↗</a>`;
    if (error.status === 428) {
      el.innerHTML = `<h2>Usuarios y tiers</h2><form id="user-reauth"><p>Confirma tu identidad para administrar cuentas.</p><div class="field"><label for="manager-password">${state.user.mfa_enabled ? "Código de tu autenticador" : "Tu contraseña de gestor"}</label><input id="manager-password" name="password" ${state.user.mfa_enabled ? 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"' : 'type="password" autocomplete="current-password"'} required></div><p id="reauth-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">Confirmar</button>${glpiLink}</div></form>`;
      const form = el.querySelector('form');
      form.onsubmit = event => {
        event.preventDefault();
        submit(form, async () => {
          const password = form.elements.password.value;
          form.elements.password.value = '';
          await api('reauth_users', { password });
          await usersAdmin(el, fallbackUrl);
        }, 'reauth-error');
      };
    } else {
      el.innerHTML = `<h2>Usuarios y tiers</h2><p class="welcome-note">${esc(error.message)}</p>${glpiLink}`;
    }
    return;
  }
  if (!el.isConnected) return;
  let editing = null;          // null = sin formulario; {} = cuenta nueva; {...} = cuenta existente
  let query = ''; let roleFilter = ''; let tierFilter = '';
  const isSelf = u => !!state.user && u.login === state.user.login;
  function rowsHtml() {
    const q = query.trim().toLowerCase();
    const list = users.filter(u => (!roleFilter || u.role === roleFilter) && (!tierFilter || (u.role === 'agente' && String(u.tier) === tierFilter)) && (!q || `${u.name} ${u.email} ${u.login}`.toLowerCase().includes(q)));
    if (!list.length) return '<p class="muted users-empty">No hay cuentas que coincidan con la búsqueda.</p>';
    return `<div class="profile-list">${list.map(u => `<article class="profile-row user-row user-role-${u.role}${u.role === 'agente' && TIERS[u.tier] ? ` tier-accent-${u.tier}` : ''}${u.active === false ? ' inactive' : ''}"><div class="profile-main"><strong>${esc(u.name)}${isSelf(u) ? ' <span class="muted">(tú)</span>' : ''}</strong><small>${esc(u.email || u.login)}</small></div><div class="profile-tier"><span class="role-tag">${esc(USER_ROLES[u.role] || u.role)}</span>${u.role === 'agente' ? (TIERS[u.tier] ? chip(u.tier) : '<span class="muted">Sin tier</span>') : ''}</div><div class="profile-users">${u.active === false ? '<span class="state-off">Inactiva</span>' : 'Activa'}</div><div class="actions profile-actions"><button type="button" class="button edit-action small" data-edit-user="${esc(u.id)}">Editar</button>${isSelf(u) ? "" : `<button type="button" class="button danger small" data-delete-user="${esc(u.id)}">Eliminar</button>`}</div></article>`).join('')}</div>`;
  }
  function formHtml(u) {
    const role = u.role || 'agente'; const isNew = !u.id; const self = isSelf(u);
    return `<form id="user-form" class="profile-form panel-inset" novalidate><h3>${isNew ? 'Crear cuenta' : 'Editar cuenta'}</h3><div class="form-row"><div class="field"><label for="user-name">Nombre completo</label><input id="user-name" name="name" required minlength="3" maxlength="120" value="${esc(u.name || '')}" placeholder="Ej.: Ana Soto" autocomplete="off"></div><div class="field"><label for="user-email">Correo</label><input id="user-email" name="email" type="email" required maxlength="255" value="${esc(u.email || '')}" placeholder="ana.soto@userena.cl" autocomplete="off"></div></div><div class="field"><label for="user-login">Usuario para iniciar sesión</label><input id="user-login" name="login" required minlength="3" maxlength="60" pattern="[a-z0-9._-]+" value="${esc(u.login || '')}" placeholder="ana.soto" autocomplete="off"${isNew ? '' : ' readonly'}><small>${isNew ? 'Se completa con el correo. Solo minúsculas, números, punto, guion o guion bajo.' : 'El usuario no se puede cambiar.'}</small></div><fieldset class="profile-role"><legend>Tipo de cuenta</legend>${Object.entries(USER_ROLES).map(([value, label]) => `<label class="role-option"><input type="radio" name="role" value="${value}"${role === value ? ' checked' : ''}${self ? ' disabled' : ''}><span>${label}</span></label>`).join('')}<small id="user-role-help">${self ? 'No puedes cambiar tu propio tipo de cuenta.' : ROLE_HELP[role]}</small></fieldset><div class="field" id="user-tier-field"${role === 'agente' ? '' : ' hidden'}><label for="user-tier">Tier</label><select id="user-tier" name="tier"><option value="">Selecciona un tier</option>${[4, 3, 2, 1].map(l => `<option value="${l}"${Number(u.tier) === l ? ' selected' : ''}>${esc(tierLabel(l))}</option>`).join('')}</select><small>Atenderá y podrá resolver los casos de ese tier. El cliente verá el tier junto a sus respuestas.</small></div>${isNew ? `<div class="field"><label for="user-password">Contraseña temporal</label><div class="password-row"><input id="user-password" name="password" required minlength="8" maxlength="128" autocomplete="new-password" value="${esc(tempPassword())}"><button type="button" class="button subtle small" id="new-password">Generar otra</button></div><small>Entrégasela a la persona por un canal seguro. Puede cambiarla desde sus preferencias en GLPI.</small></div>` : `<label class="check-field"><input type="checkbox" name="active"${u.active === false ? '' : ' checked'}${self ? ' disabled' : ''}> Cuenta activa</label><p class="muted admin-caption">Una cuenta inactiva no puede iniciar sesión, pero se conserva su historial.</p>`}<p id="user-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">${isNew ? 'Crear cuenta' : 'Guardar cambios'}</button><button type="button" class="button subtle" id="cancel-user">Cancelar</button></div></form>`;
  }
  function render() {
    el.innerHTML = `<div class="panel-heading"><div><h2>Usuarios y tiers</h2><p class="muted admin-caption">Crea las cuentas de tu equipo y de los clientes. A cada agente asígnale su tier.</p></div>${editing ? '' : '<button type="button" class="button" id="new-user">＋ Crear cuenta</button>'}</div><div class="tier-legend" aria-label="Colores de los tiers">${[4, 3, 2, 1].map(l => `<span>${chip(l)} ${esc(TIERS[l].name)} · ${users.filter(u => u.role === 'agente' && Number(u.tier) === l && u.active !== false).length}</span>`).join('')}</div>${editing ? formHtml(editing) : ''}<div class="filters users-filters"><label class="visually-hidden" for="user-search">Buscar persona</label><input id="user-search" type="search" placeholder="Buscar por nombre, correo o usuario…" value="${esc(query)}"><label class="visually-hidden" for="user-role-filter">Filtrar por tipo</label><select id="user-role-filter"><option value="">Todos los tipos</option>${Object.entries(USER_ROLES).map(([v, l]) => `<option value="${v}"${roleFilter === v ? ' selected' : ''}>${l}</option>`).join('')}</select><label class="visually-hidden" for="user-tier-filter">Filtrar agentes por tier</label><select id="user-tier-filter"${roleFilter && roleFilter !== "agente" ? " disabled" : ""}><option value="">Todos los tiers</option>${[4, 3, 2, 1].map(tier => `<option value="${tier}"${tierFilter === String(tier) ? " selected" : ""}>${tierLabel(tier)}</option>`).join("")}</select></div><div id="user-rows">${rowsHtml()}</div><p class="muted admin-caption">Los tipos de cuenta son fijos. Para crear un tipo de cuenta con permisos distintos, usa “Perfiles de GLPI” en la pestaña Accesos a GLPI.</p>`;
    document.getElementById('user-search').oninput = event => { query = event.target.value; document.getElementById('user-rows').innerHTML = rowsHtml(); };
    document.getElementById('user-role-filter').onchange = event => { roleFilter = event.target.value; const tier = document.getElementById('user-tier-filter'); tier.disabled = !!roleFilter && roleFilter !== 'agente'; if (tier.disabled) tierFilter = tier.value = ''; document.getElementById('user-rows').innerHTML = rowsHtml(); };
    document.getElementById('user-tier-filter').onchange = event => { tierFilter = event.target.value; document.getElementById('user-rows').innerHTML = rowsHtml(); };
    const form = document.getElementById('user-form');
    if (!form) return;
    document.getElementById('user-name').focus();
    const loginInput = form.elements.login; let loginTouched = !!editing.id;
    loginInput.oninput = () => { loginTouched = true; };
    form.elements.email.oninput = () => { if (!loginTouched) loginInput.value = form.elements.email.value.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''); };
    const regen = document.getElementById('new-password'); if (regen) regen.onclick = () => { form.elements.password.value = tempPassword(); };
    form.onchange = event => {
      if (event.target.name !== 'role') return;
      const role = event.target.value;
      document.getElementById('user-tier-field').hidden = role !== 'agente';
      document.getElementById('user-role-help').textContent = ROLE_HELP[role];
    };
    document.getElementById('cancel-user').onclick = () => { editing = null; render(); };
    form.onsubmit = event => { event.preventDefault(); submit(form, async () => {
      const checked = form.querySelector('input[name=role]:checked');
      const role = checked ? checked.value : editing.role;
      const body = { name: form.elements.name.value.trim(), email: form.elements.email.value.trim().toLowerCase(), login: form.elements.login.value.trim().toLowerCase(), role, tier: role === 'agente' ? Number(form.elements.tier.value) || null : null };
      if (body.name.length < 3) throw new Error('Escribe el nombre completo.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Revisa el correo.');
      if (!/^[a-z0-9._-]{3,60}$/.test(body.login)) throw new Error('El usuario debe tener entre 3 y 60 caracteres: minúsculas, números, punto, guion o guion bajo.');
      if (role === 'agente' && !body.tier) throw new Error('Elige el tier del agente.');
      const others = users.filter(u => u.id !== editing.id);
      if (others.some(u => (u.email || '').toLowerCase() === body.email)) throw new Error('Ya existe una cuenta con ese correo.');
      if (others.some(u => u.login === body.login)) throw new Error('Ya existe una cuenta con ese usuario.');
      if (editing.id) { body.id = editing.id; body.active = form.elements.active ? form.elements.active.checked : true; }
      else { body.password = form.elements.password.value; if (body.password.length < 8) throw new Error('La contraseña temporal debe tener al menos 8 caracteres.'); }
      const saved = (await api('save_user', body)).user;
      users = editing.id ? users.map(u => (u.id === saved.id ? saved : u)) : [...users, saved];
      const created = !editing.id; editing = null; render();
      notice(created ? `Cuenta creada para ${saved.name}. Recuerda entregarle su usuario y contraseña temporal.` : 'Cuenta actualizada.');
    }, 'user-error'); };
  }
  el.onclick = async event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.id === 'new-user') { editing = {}; render(); }
    else if (target.dataset.editUser) { editing = users.find(u => String(u.id) === target.dataset.editUser) || null; render(); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (target.dataset.deleteUser) {
      const user = users.find(u => String(u.id) === target.dataset.deleteUser);
      if (!user || !window.confirm(`¿Eliminar la cuenta de ${user.name}? Esta acción es permanente.`)) return;
      target.disabled = true;
      try {
        await api('delete_user', { id: user.id });
        users = users.filter(u => u.id !== user.id);
        if (editing?.id === user.id) editing = null;
        if (el.isConnected) { render(); notice('Cuenta eliminada.'); }
      } catch (error) { notice(error.message, true); }
      finally { target.disabled = false; }
    }
  };
  render();
}

export { usersAdmin };
