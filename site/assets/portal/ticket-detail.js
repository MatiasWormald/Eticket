import { api, badge, confirmAction, date, esc, fileField, main, notice, requestRoute, state, submit } from './core.js';
import { chip, tierChip, tierLabel, tierLevel, TIERS } from './tiers.js';

async function detail(id, generation) {
  const data = await api('ticket', undefined, { id });
  if (generation !== state.generation) return;
  renderDetail(data.ticket);
}

// Cambio de estado separado de la edición: el agente modifica estados sin poder editar asunto ni descripción.
const OPEN_STATUSES = ['Recibida', 'En curso', 'Planificada', 'En espera'];
const statusForm = t => (t.permissions.status && t.status <= 4) ? `<form id="status-form" class="status-form"><label for="status-select">Cambiar estado</label><div class="status-row"><select id="status-select" name="status" aria-describedby="status-hint">${OPEN_STATUSES.map((s, i) => `<option value="${i + 1}"${t.status === i + 1 ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit" class="button subtle small">Guardar</button></div><small id="status-hint">Para cerrar el caso, registra una solución.</small><p id="status-error" class="inline-error" role="alert" hidden></p></form>` : '';
function bindStatus(t) {
  const form = document.getElementById('status-form');
  if (!form) return;
  form.onsubmit = event => { event.preventDefault(); submit(form, async () => {
    const status = Number(form.elements.status.value);
    if (status === t.status) throw new Error('El caso ya está en ese estado.');
    const data = await api('status', { status }, { id: t.id }); renderDetail(data.ticket); notice('Estado actualizado.');
  }, 'status-error'); };
}
const isStaff = () => !!state.user && state.user.role !== 'cliente';
function tierRow(t) {
  const level = tierLevel(t);
  if (!level) return '';
  const steps = [4, 3, 2, 1].map(l => `<li class="${l === level ? `current tier-${l}` : l > level ? 'done' : ''}" title="${esc(tierLabel(l))}">${TIERS[l].label.replace('Tier ', '')}</li>`).join('');
  return `<div><dt>${isStaff() ? 'Nivel de soporte' : 'Te atiende'}</dt><dd>${chip(level)} <strong>${esc(TIERS[level].name)}</strong>${t.tier.group_label ? `<br><span class="muted">${esc(t.tier.group_label)}</span>` : ''}<ol class="tier-steps" aria-label="Avance por niveles: de Tier IV a Tier I">${steps}</ol></dd></div>`;
}
function tierEvents(t) {
  return (t.escalations || []).map((e, index) => ({ kind: 'event', date: e.date, event: { ...e, index } }));
}
function eventHtml(e) {
  const to = TIERS[e.to] ? e.to : 0;
  const team = e.group_label ? ` · ${esc(e.group_label)}` : '';
  if (!isStaff()) {
    // El cliente ve a qué tier y equipo pasó su caso, pero no el motivo interno ni quién lo derivó.
    const text = to ? `Tu caso pasó a ${chip(to)} <strong>${esc(TIERS[to].name)}</strong>${team}` : 'Tu caso fue derivado a un equipo especializado';
    return `<div class="thread-event${to ? ` tier-event tier-${to}` : ''}"><span>${text} · ${esc(date(e.date))}</span></div>`;
  }
  const verb = e.kind === 'reassign' ? 'Movido por el gestor' : 'Derivado';
  return `<div class="thread-event staff${to ? ` tier-event tier-${to}` : ''}"><span><strong>${verb}: ${chip(e.from)} → ${chip(to)}${team}</strong> · ${esc(e.by || 'Equipo de soporte')} · ${esc(date(e.date))}</span>${e.reason ? `<small>Motivo: ${esc(e.reason)}</small>` : ''}</div>`;
}
// Paneles del lado derecho: derivar (agente y gestor) e intervenir (solo gestor, opcional).
// Se deriva por tier.
function sidePanels(t) {
  const p = t.permissions || {};
  const level = tierLevel(t);
  let html = '';
  if (p.escalate && TIERS[level - 1]) {
    const next = level - 1;
    html += `<section class="panel escalate-panel tier-accent-${next}"><h2>Derivar al siguiente tier</h2><p class="muted">Si el caso supera la capacidad de este nivel, derívalo a ${chip(next)} <strong>${esc(TIERS[next].name)}</strong>. Se conservan el número, el historial y los archivos.</p><form id="escalate-form"><div class="field"><label for="escalate-reason">Motivo</label><textarea id="escalate-reason" name="reason" required minlength="10" maxlength="2000" placeholder="Qué se revisó, qué se intentó y por qué se necesita un nivel más especializado." aria-describedby="escalate-reason-hint"></textarea><small id="escalate-reason-hint">Queda registrado con tu nombre y la fecha. El cliente ve el cambio de tier, pero no este motivo.</small></div><p id="escalate-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button dark">Derivar a ${esc(TIERS[next].label)} <span aria-hidden="true">↑</span></button></form></section>`;
  } else if (isStaff() && level === 1 && state.user.role === 'agente') {
    html += `<section class="panel tier-last-note tier-accent-1"><h2>${chip(1)} Último nivel</h2><p class="muted">Tier I no deriva ni bloquea casos. Si tu solución no funciona o el cliente la rechaza, el caso vuelve a ti para que lo intentes de nuevo. El gestor puede intervenir si lo estima necesario.</p></section>`;
  }
  if (p.reassign) {
    html += `<details class="panel intervene-panel"><summary><span><strong>Intervenir como gestor</strong><small>Opcional. Mueve el caso a cualquier tier.</small></span></summary><form id="reassign-form"><div class="field"><label for="reassign-level">Nuevo tier</label><select id="reassign-level" name="level" required><option value="">Selecciona un tier</option>${[4, 3, 2, 1].map(l => `<option value="${l}"${l === level ? ' disabled' : ''}>${esc(tierLabel(l))}${l === level ? ' (actual)' : ''}</option>`).join('')}</select></div><div class="field"><label for="reassign-reason">Motivo</label><textarea id="reassign-reason" name="reason" required minlength="10" maxlength="2000" placeholder="Por qué mueves el caso." aria-describedby="reassign-reason-hint"></textarea><small id="reassign-reason-hint">Queda registrado en el historial. También puedes responder o registrar la solución tú mismo desde la conversación.</small></div><p id="reassign-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button dark">Mover caso</button></form></details>`;
  }
  return html;
}
function bindEscalation(t) {
  const escalate = document.getElementById('escalate-form');
  if (escalate) escalate.onsubmit = event => { event.preventDefault(); submit(escalate, async () => {
    const body = Object.fromEntries(new FormData(escalate));
    const data = await api('escalate', body, { id: t.id });
    if (!data.ticket) {
      state.flash = 'Caso derivado a ' + tierLabel(tierLevel(t) - 1) + '.';
      window.location.hash = '#/tickets';
      return;
    }
    renderDetail(data.ticket); notice('Caso derivado a ' + tierLabel(tierLevel(data.ticket)) + '.');
  }, 'escalate-error'); };
  const reassign = document.getElementById('reassign-form');
  if (reassign) reassign.onsubmit = event => { event.preventDefault(); submit(reassign, async () => {
    const form = Object.fromEntries(new FormData(reassign));
    const data = await api('reassign', { level: Number(form.level), reason: form.reason }, { id: t.id });
    renderDetail(data.ticket); notice('Caso movido a ' + tierLabel(tierLevel(data.ticket)) + '.');
  }, 'reassign-error'); };
}
const MESSAGE_ROLES = { client: 'Cliente', team: 'Equipo de soporte', internal: 'Nota interna · no visible para el cliente', solution: 'Solución propuesta' };
const initialMessage = t => ({ kind: 'initial', author: t.requesters[0] || 'Solicitante', date: t.created_at, content: t.description, private: false });
function messageHtml(m, t) {
  if (m.kind === 'event') return eventHtml(m.event);
  const fromClient = m.kind === 'initial' || (m.kind !== 'solution' && !m.private && t.requesters.includes(m.author));
  const kind = m.kind === 'solution' ? 'solution' : m.private ? 'internal' : fromClient ? 'client' : 'team';
  const mine = !!state.user && m.author === state.user.name;
  const initials = m.author.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return `<article class="message message-${kind}"><span class="message-avatar" aria-hidden="true">${esc(initials)}</span><div class="message-bubble"><div class="message-header"><strong>${esc(mine ? 'Tú' : m.author)}</strong><span class="message-role">${m.kind === 'initial' ? 'Solicitud inicial' : MESSAGE_ROLES[kind]}</span>${kind !== 'client' ? chip(Number(m.tier)) : ''}<time>${esc(date(m.date))}</time></div><div class="text-content">${esc(m.content)}</div></div></article>`;
}
function renderDetail(t) {
  const p = t.permissions;
  main.innerHTML = `<a class="breadcrumb" href="#/tickets">← Volver a solicitudes</a><div class="page-head detail-head"><div><p class="eyebrow">SOLICITUD #${t.id}</p><h1>${esc(t.title)}</h1><p class="lead">Creada el ${esc(date(t.created_at))}</p></div><div class="actions">${tierChip(t)}${badge(t)}<button id="refresh-ticket" class="button subtle small">Actualizar</button></div></div>${p.approve ? '<section class="approve-box"><h2>El equipo publicó una solución</h2><p>Revisa la respuesta. Puedes confirmar que está resuelto o indicar qué falta.</p><div class="actions"><button id="approve-solution" class="button">Sí, está resuelto</button><button id="reject-solution" class="button subtle">Necesito más ayuda</button></div><form id="reject-form" class="reject-form" hidden><div class="field"><label for="reject-message">Cuéntanos qué falta por resolver</label><textarea id="reject-message" name="message" required minlength="5" maxlength="20000"></textarea></div><button type="submit" class="button">Enviar y reabrir solicitud</button></form></section>' : ''}<div class="detail-grid"><div>${p.edit ? `<section class="panel"><div class="panel-heading"><h2>Asunto y descripción</h2><button id="show-edit" class="button subtle small">Editar</button></div><p id="ticket-description" class="muted edit-hint">La descripción original aparece como primer mensaje de la conversación.</p>${p.edit ? `<form id="edit-form" hidden><div class="field"><label for="edit-title">Asunto</label><input id="edit-title" name="title" value="${esc(t.title)}" minlength="4" maxlength="200" required></div><div class="field"><label for="edit-description">Descripción</label><textarea id="edit-description" name="description" required minlength="10" maxlength="20000">${esc(t.description)}</textarea></div>${t.status <= 4 && !p.status ? `<div class="field"><label for="edit-status">Estado</label><select id="edit-status" name="status">${['Recibida','En curso','Planificada','En espera'].map((s, i) => `<option value="${i+1}" ${t.status === i+1 ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : ''}<p id="edit-error" role="alert" class="inline-error" hidden></p><div class="actions"><button type="submit" class="button">Guardar cambios</button><button id="cancel-edit" type="button" class="button subtle">Cancelar</button></div></form>` : ''}</section>` : ''}<section class="panel"><div class="panel-heading"><h2>Conversación</h2><small>${t.messages.length + 1} ${t.messages.length === 0 ? 'mensaje' : 'mensajes'}</small></div><div class="thread">${[initialMessage(t), ...[...t.messages, ...tierEvents(t)].sort((a, b) => String(a.date).localeCompare(String(b.date)))].map(m => messageHtml(m, t)).join('')}</div>${t.messages.length ? '' : '<p class="muted thread-empty">Tu solicitud fue recibida. Las respuestas del equipo aparecerán aquí.</p>'}${p.reply ? `<form id="reply-form" class="reply-form"><div class="field"><label for="message">Agregar una respuesta</label><textarea id="message" name="message" required maxlength="20000" placeholder="Escribe tu respuesta o agrega información sobre el caso…"></textarea></div>${p.private_reply ? '<label class="check-field"><input type="checkbox" id="private-reply" name="private" value="1"> Nota interna: visible solo para el equipo autorizado</label>' : ''}${fileField}<p id="reply-error" role="alert" class="inline-error" hidden></p><button type="submit" class="button">Enviar respuesta →</button></form>` : `<p class="welcome-note">${t.status === 6 ? 'Esta solicitud está cerrada. Si necesitas ayuda con un caso nuevo, crea otra solicitud.' : 'Tu perfil no permite agregar respuestas en este estado.'}</p>`}</section>${p.solve ? '<section class="panel"><h2>Proponer una solución</h2><p class="muted">La solución quedará visible para el cliente, que podrá revisarla.</p><form id="solve-form"><div class="field"><label for="solution">Qué se resolvió y cómo</label><textarea id="solution" name="message" required minlength="10" maxlength="20000"></textarea></div><p id="solve-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button">Registrar solución</button></form></section>' : ''}</div><aside><section class="panel"><h2>Detalles</h2><dl class="meta-list"><div><dt>Estado</dt><dd>${esc(t.status_label)}</dd></div>${tierRow(t)}<div><dt>Solicitante</dt><dd>${esc(t.requesters.join(', '))}</dd></div><div><dt>Última actividad</dt><dd>${esc(date(t.updated_at))}</dd></div><div><dt>Tipo</dt><dd>${t.type === 1 ? 'Incidente' : 'Solicitud de servicio'}</dd></div></dl>${statusForm(t)}${p.delete ? '<div class="danger-zone"><button id="delete-ticket">Eliminar definitivamente</button></div>' : ''}</section>${sidePanels(t)}<section class="panel"><h2>Archivos adjuntos</h2>${t.attachments.length ? `<ul class="attachment-list">${t.attachments.map(a => `<li><a href="api?action=download&amp;id=${t.id}&amp;document=${a.id}" download>↓ ${esc(a.name)}</a></li>`).join('')}</ul>` : '<small>No hay archivos adjuntos.</small>'}</section></aside></div>`;
  document.getElementById('refresh-ticket').onclick = () => requestRoute();
  if (p.reply) document.getElementById('reply-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; submit(form, async () => {
    const file = form.elements.file.files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar menos de 10 MB.');
    const data = await api('reply', new FormData(form), { id: t.id }); renderDetail(data.ticket); notice('Respuesta enviada.');
  }, 'reply-error'); };
  if (p.edit) {
    const toggle = editing => { document.getElementById('edit-form').hidden = !editing; document.getElementById('ticket-description').hidden = editing; document.getElementById('show-edit').hidden = editing; };
    document.getElementById('show-edit').onclick = () => { toggle(true); document.getElementById('edit-title').focus(); };
    document.getElementById('cancel-edit').onclick = () => toggle(false);
    document.getElementById('edit-form').onsubmit = event => { event.preventDefault(); submit(event.currentTarget, async () => {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const data = await api('edit', body, { id: t.id }); renderDetail(data.ticket); notice('Cambios guardados.');
    }, 'edit-error'); };
  }
  bindEscalation(t);
  bindStatus(t);
  if (p.solve) document.getElementById('solve-form').onsubmit = event => { event.preventDefault(); submit(event.currentTarget, async () => {
    const data = await api('solve', Object.fromEntries(new FormData(event.currentTarget)), { id: t.id }); renderDetail(data.ticket); notice('Solución registrada. El cliente puede revisarla.');
  }, 'solve-error'); };
  if (p.approve) {
    document.getElementById('approve-solution').onclick = async event => {
      event.currentTarget.disabled = true;
      try { const data = await api('approve', { accept: true }, { id: t.id }); renderDetail(data.ticket); notice('Gracias por confirmar. La solicitud quedó cerrada.'); }
      catch (error) { notice(error.message, true); event.target.disabled = false; }
    };
    document.getElementById('reject-solution').onclick = () => { document.getElementById('reject-form').hidden = false; document.getElementById('reject-message').focus(); };
    document.getElementById('reject-form').onsubmit = event => { event.preventDefault(); submit(event.currentTarget, async () => {
      const data = await api('approve', { accept: false, message: document.getElementById('reject-message').value }, { id: t.id }); renderDetail(data.ticket); notice('Solicitud reabierta. El equipo podrá revisar tu respuesta.');
    }); };
  }
  if (p.delete) document.getElementById('delete-ticket').onclick = async () => {
    if (!await confirmAction({ title: 'Eliminar definitivamente', message: 'Esta solicitud se eliminará de GLPI de forma permanente.', confirmLabel: 'Eliminar definitivamente' })) return;
    try { await api('delete', {}, { id: t.id }); state.flash = 'Solicitud eliminada definitivamente.'; window.location.hash = '#/tickets'; }
    catch (error) { notice(error.message, true); }
  };
}

export { detail };
