(function () {
  'use strict';
  const main = document.getElementById('main');
  const state = { user: null, csrf: '', services: null, generation: 0, offset: 0, query: '', status: '', ticket: null, flash: '' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => {
    if (!value) return 'Sin fecha';
    const parsed = new Date(value.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  };
  const badge = t => `<span class="status status-${Number(t.status)}">${esc(t.status_label)}</span>`;
  const fileField = `<div class="field"><label for="file">Adjuntar evidencia <span class="muted">(opcional)</span></label><input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt"><small>PDF, PNG, JPG o TXT. Máximo 10 MB. Evita incluir contraseñas o datos sensibles.</small></div>`;
  function notice(text, error = false) {
    const el = document.getElementById('notice');
    el.textContent = text; el.className = 'notice' + (error ? ' error' : ''); el.hidden = !text;
  }
  async function api(action, body, params = {}) {
    const url = new URL('api', window.location.href);
    url.hash = ''; url.search = new URLSearchParams({ action, ...params }).toString();
    const options = { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (body !== undefined) {
      options.method = 'POST'; options.headers['X-Eticket-CSRF'] = state.csrf;
      if (body instanceof FormData) options.body = body;
      else { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }
    let response;
    try { response = await fetch(url, options); }
    catch (_) { throw new Error('No pudimos conectar. Comprueba tu conexión e intenta nuevamente.'); }
    if (response.status === 429) throw new Error('Has intentado ingresar varias veces. Espera un minuto antes de volver a intentar.');
    if (response.status === 413) throw new Error('El archivo supera el tamaño permitido. Adjunta uno de hasta 10 MB.');
    if (response.status === 502 || response.status === 503 || response.status === 504) throw new Error('El servicio de soporte no está disponible por el momento. Intenta nuevamente en unos instantes.');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error(action === 'login' ? 'No pudimos completar el acceso. Si tu cuenta utiliza doble factor, ingresa primero desde el acceso institucional de GLPI.' : 'El servicio devolvió una respuesta inesperada. Intenta nuevamente.');
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && action !== 'login') { state.user = null; shell(); login(); }
      throw new Error(data.error || 'No pudimos completar la operación.');
    }
    return data;
  }
  function shell() {
    const logged = !!state.user;
    document.getElementById('sidebar').hidden = !logged;
    document.getElementById('logout').hidden = !logged;
    if (!logged) return;
    const u = state.user;
    document.getElementById('account-name').textContent = u.name;
    document.getElementById('account-avatar').textContent = u.name.trim().slice(0, 2).toUpperCase();
    document.getElementById('account-role').textContent = { cliente: 'Cliente', agente: 'Agente de atención', gestor: u.can_admin ? 'Gestor administrador' : 'Gestor de tickets' }[u.role];
    document.getElementById('new-nav').hidden = !u.can_create;
    document.getElementById('admin-nav').hidden = !u.can_admin;
    document.getElementById('tickets-nav-label').textContent = u.role === 'cliente' ? 'Mis solicitudes' : 'Solicitudes';
  }
  function login() {
    const glpi = (window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081';
    main.innerHTML = `<section class="login-grid"><div class="login-story"><p class="eyebrow">TECH HUB ULS / CENTRO DE AYUDA</p><h1>Tu próxima solución empieza aquí<span style="color:#f37188">.</span></h1><p>Un espacio simple para pedir ayuda y mantenerte al tanto. Nosotros nos encargamos del resto.</p><ul><li>Envía tu solicitud en pocos pasos</li><li>Conversa directamente con el equipo</li><li>Consulta el estado cuando lo necesites</li></ul><small>eTicket · Conectamos preguntas con soluciones.</small></div><form id="login-form" class="login-form"><h2>Te damos la bienvenida</h2><p>Ingresa con tu cuenta de soporte para continuar.</p><div class="field"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" required maxlength="255" placeholder="Tu nombre de usuario"></div><div class="field"><label for="password">Contraseña</label><div class="password-row"><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="button" class="button subtle small" id="show-password" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div></div><p class="inline-error" id="login-error" role="alert" hidden></p><button type="submit" class="button">Ingresar a mi espacio <span aria-hidden="true">→</span></button><div class="login-help"><strong>¿Necesitas acceso?</strong><p>Contacta a la persona que te dio acceso al servicio. Usa tu cuenta de soporte, sin compartirla.</p><a id="institutional-login" href="${esc(glpi)}" target="_blank" rel="noopener">Acceso institucional / doble factor ↗</a></div></form></section>`;
    document.getElementById('show-password').onclick = event => {
      const input = document.getElementById('password'); const show = input.type === 'password';
      input.type = show ? 'text' : 'password'; event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar'; event.currentTarget.setAttribute('aria-pressed', String(show));
    };
    document.getElementById('login-form').onsubmit = event => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const data = await api('login', { username: document.getElementById('username').value, password: document.getElementById('password').value });
        state.user = data.user; state.csrf = data.csrf; state.services = null;
        if (!state.user) throw new Error('La cuenta no tiene un perfil de soporte activo.');
        document.getElementById('password').value = ''; notice(''); shell(); route();
      }, 'login-error');
    };
  }
  async function submit(form, work, errorId) {
    const buttons = Array.from(form.querySelectorAll('button[type=submit]'));
    buttons.forEach(b => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Guardando…'; });
    const errorEl = errorId && document.getElementById(errorId);
    if (errorEl) errorEl.hidden = true;
    try { await work(); }
    catch (error) { if (errorEl && document.contains(errorEl)) { errorEl.textContent = error.message; errorEl.hidden = false; } else notice(error.message, true); }
    finally { buttons.forEach(b => { b.disabled = false; b.textContent = b.dataset.label; }); }
  }
  function ticketCards(tickets) {
    if (!tickets.length) return `<div class="empty"><span class="choice-icon" aria-hidden="true">▤</span><h2>No hay solicitudes para mostrar</h2><p>Cuando envíes una solicitud, podrás seguir sus avances aquí. Si estás buscando una, revisa los filtros.</p>${state.user.can_create ? '<a class="button subtle" href="#/nueva">Crear una solicitud</a>' : ''}</div>`;
    return tickets.map(t => `<a class="ticket-card" href="#/ticket/${t.id}"><span class="ticket-number">#${t.id}</span><div><strong>${esc(t.title)}</strong><small>Última actividad: ${esc(date(t.updated_at))}</small></div>${badge(t)}</a>`).join('');
  }
  async function dashboard(generation) {
    const staff = state.user.role !== 'cliente';
    main.innerHTML = `<p class="eyebrow">${staff ? 'MESA DE AYUDA' : 'TU ESPACIO DE SOPORTE'}</p><h1>Hola, ${esc(state.user.name.split(' ')[0])}<span style="color:var(--red)">.</span></h1><p class="lead">${staff ? 'Las conversaciones y solicitudes de tu equipo, en un solo lugar.' : '¿En qué podemos ayudarte hoy? Crea una solicitud o retoma una conversación con nuestro equipo.'}</p>${staff ? `<div class="role-info">${state.user.role === 'gestor' ? 'Perfil gestor: administra solicitudes, estructura del formulario y el acceso de tu equipo desde Administración.' : 'Perfil agente: puedes consultar y responder las solicitudes autorizadas. Las herramientas de gestión dependen de tu perfil en GLPI.'}</div>` : ''}<div class="choice-grid">${state.user.can_create ? '<a class="choice" href="#/nueva"><span class="choice-icon" aria-hidden="true">＋</span><h2>Crear una solicitud</h2><p>Cuéntanos qué necesitas. Te guiaremos para enviarla al equipo correcto.</p><span>Comenzar solicitud →</span></a>' : ''}<a class="choice" href="#/tickets"><span class="choice-icon" aria-hidden="true">▤</span><h2>${staff ? 'Ver solicitudes' : 'Mis solicitudes'}</h2><p>Revisa avances, responde al equipo y consulta las soluciones.</p><span>Ver conversaciones →</span></a></div><section class="panel"><div class="panel-heading"><h2>Solicitudes recientes</h2><a href="#/tickets">Ver todas →</a></div><div id="recent-tickets" class="loading">Cargando solicitudes…</div></section><p class="welcome-note">No necesitas crear otra solicitud para agregar información. Abre la conversación existente y escribe tu respuesta.</p>`;
    const data = await api('tickets');
    if (generation !== state.generation) return;
    const el = document.getElementById('recent-tickets'); el.className = 'ticket-list'; el.innerHTML = ticketCards(data.tickets.slice(0, 5));
    if (state.user.can_admin) {
      const adminChoice = document.createElement('a'); adminChoice.className = 'choice'; adminChoice.href = '#/administracion';
      adminChoice.innerHTML = '<span class="choice-icon" aria-hidden="true">⚙</span><h2>Administrar eTicket</h2><p>Personaliza los campos de las solicitudes y administra formularios, usuarios y perfiles.</p><span>Abrir administración →</span>';
      document.querySelector('.choice-grid').appendChild(adminChoice);
    }
  }
  async function administration(generation) {
    if (!state.user.can_admin) {
      main.innerHTML = '<section class="panel"><h1>Acceso reservado al gestor</h1><p>Tu perfil no permite administrar la estructura ni los perfiles del sistema.</p><a class="button" href="#/inicio">Volver al inicio</a></section>'; return;
    }
    const data = await api('schema');
    if (generation !== state.generation) return;
    let revision = data.schema.revision;
    let fields = data.schema.fields.map(f => ({ ...f, options: [...f.options] }));
    const glpi = (window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081';
    const nativeUrl = key => { const url = new URL(glpi.replace(/\/?$/, '/')); url.searchParams.set('redirect', state.user.admin_paths[key]); url.searchParams.set('noAUTO', '1'); return url.href; };
    const nativeLink = (key, label, description) => `<a class="admin-tool" href="${esc(nativeUrl(key))}" target="_blank" rel="noopener"><strong>${label} ↗</strong><span>${description}</span></a>`;
    main.innerHTML = `<p class="eyebrow">GESTOR ADMINISTRADOR</p><h1>Administración de eTicket</h1><p class="lead">Configura cómo se solicitan los servicios y gestiona el acceso de tu equipo.</p><section class="panel"><h2>Gestión del sistema</h2><div class="admin-tools">${nativeLink('home', 'Abrir GLPI', 'Revisa la operación y configuración completa.')}${nativeLink('profiles', 'Crear y administrar perfiles', 'Crea perfiles y define qué puede hacer cada uno.')}${nativeLink('users', 'Administrar usuarios', 'Crea cuentas y asigna sus perfiles y entidades.')}${nativeLink('forms', 'Formularios de GLPI', 'Configura formularios nativos, campos y destinos.')}</div><p class="muted admin-caption">Estos accesos abren GLPI en otra pestaña. Si te pide iniciar sesión, utiliza la misma cuenta de gestor.</p></section><section class="panel"><div class="panel-heading"><div><h2>Estructura de las solicitudes del portal</h2><p class="muted admin-caption">Agrega, ordena o quita campos del formulario de nuevas solicitudes.</p></div></div><p class="welcome-note">Servicio, asunto, descripción e impacto son los campos base. Los campos adicionales se aplican a las nuevas solicitudes; las respuestas de tickets existentes se conservan.</p><form id="schema-form"><div id="schema-fields"></div><div class="actions"><button id="add-schema-field" type="button" class="button subtle">＋ Añadir campo</button><span id="schema-count" class="muted admin-caption"></span></div><p id="schema-error" class="inline-error" role="alert" hidden></p><div class="actions admin-save"><button type="submit" class="button">Guardar estructura</button><a class="button subtle" href="#/nueva">Ver formulario</a></div></form></section>`;
    function collect() {
      fields = fields.map(f => ({ ...f,
        label: document.getElementById('label-' + f.id).value,
        type: document.getElementById('type-' + f.id).value,
        required: document.getElementById('required-' + f.id).checked,
        options: document.getElementById('options-' + f.id).value.split('\n').map(x => x.trim()).filter(Boolean),
      }));
    }
    function renderFields() {
      document.getElementById('schema-fields').innerHTML = fields.length ? fields.map((f, index) => `<fieldset class="schema-field"><legend>Campo ${index + 1}</legend><div class="form-row"><div class="field"><label for="label-${f.id}">Nombre del campo</label><input id="label-${f.id}" value="${esc(f.label)}" required minlength="2" maxlength="120" placeholder="Ej.: Proyecto relacionado"></div><div class="field"><label for="type-${f.id}">Tipo de respuesta</label><select id="type-${f.id}" data-field-type="${f.id}"><option value="text" ${f.type === 'text' ? 'selected' : ''}>Texto corto</option><option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>Texto largo</option><option value="select" ${f.type === 'select' ? 'selected' : ''}>Lista de opciones</option></select></div></div><div class="field" ${f.type === 'select' ? '' : 'hidden'}><label for="options-${f.id}">Opciones, una por línea</label><textarea id="options-${f.id}" maxlength="2500" ${f.type === 'select' ? 'required' : ''}>${esc(f.options.join('\n'))}</textarea><small>Entre 2 y 20 opciones distintas.</small></div><div class="schema-field-actions"><label class="check-field"><input type="checkbox" id="required-${f.id}" ${f.required ? 'checked' : ''}>Respuesta obligatoria</label><div class="actions"><button type="button" class="button subtle small" data-move="up" data-id="${f.id}" ${index === 0 ? 'disabled' : ''} aria-label="Subir campo ${index + 1}">↑</button><button type="button" class="button subtle small" data-move="down" data-id="${f.id}" ${index === fields.length - 1 ? 'disabled' : ''} aria-label="Bajar campo ${index + 1}">↓</button><button type="button" class="button subtle small" data-remove="${f.id}" aria-label="Quitar campo ${index + 1}">Quitar campo</button></div></div></fieldset>`).join('') : '<p class="muted">No hay campos adicionales. El formulario utiliza los campos base.</p>';
      document.getElementById('schema-count').textContent = fields.length + ' de 20 campos';
      document.getElementById('add-schema-field').disabled = fields.length >= 20;
    }
    document.getElementById('schema-fields').onchange = event => {
      if (event.target.dataset.fieldType) { collect(); renderFields(); }
    };
    document.getElementById('schema-fields').onclick = event => {
      const button = event.target.closest('button'); if (!button) return;
      collect();
      if (button.dataset.remove) fields = fields.filter(f => f.id !== button.dataset.remove);
      else if (button.dataset.move) {
        const from = fields.findIndex(f => f.id === button.dataset.id); const to = from + (button.dataset.move === 'up' ? -1 : 1);
        if (to >= 0 && to < fields.length) [fields[from], fields[to]] = [fields[to], fields[from]];
      }
      renderFields();
    };
    document.getElementById('add-schema-field').onclick = () => {
      collect(); fields.push({ id: 'field_' + crypto.randomUUID().replace(/-/g, ''), label: '', type: 'text', required: false, options: [] }); renderFields(); document.getElementById('label-' + fields.at(-1).id).focus();
    };
    document.getElementById('schema-form').onsubmit = event => {
      event.preventDefault(); submit(event.currentTarget, async () => { collect(); const saved = await api('save_schema', { revision, fields }); revision = saved.schema.revision; fields = saved.schema.fields; renderFields(); notice('Estructura guardada. Los cambios están disponibles para las nuevas solicitudes.'); }, 'schema-error');
    };
    renderFields();
  }
  async function tickets(generation) {
    const heading = state.user.role === 'cliente' ? 'Mis solicitudes' : 'Solicitudes del equipo';
    main.innerHTML = `<div class="page-head"><div><p class="eyebrow">CONVERSACIONES</p><h1>${heading}</h1><p class="lead">Todo lo que necesitas para seguir cada caso.</p></div>${state.user.can_create ? '<a class="button" href="#/nueva">＋ Crear solicitud</a>' : ''}</div><section class="panel"><form id="filter-form" class="filters" role="search"><label class="visually-hidden" for="search">Buscar por asunto o número</label><input id="search" type="search" placeholder="Buscar por asunto o número…" value="${esc(state.query)}" maxlength="120"><label class="visually-hidden" for="status-filter">Filtrar por estado</label><select id="status-filter"><option value="">Todos los estados</option>${['Recibida', 'En curso', 'Planificada', 'En espera', 'Resuelta', 'Cerrada'].map((s, i) => `<option value="${i + 1}"${state.status === String(i + 1) ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit" class="button subtle">Buscar</button></form><div id="ticket-results" class="loading" aria-live="polite">Cargando solicitudes…</div><div id="pagination"></div></section>`;
    document.getElementById('filter-form').onsubmit = event => { event.preventDefault(); state.query = document.getElementById('search').value.trim(); state.status = document.getElementById('status-filter').value; state.offset = 0; route(); };
    const data = await api('tickets', undefined, { q: state.query, status: state.status, offset: state.offset });
    if (generation !== state.generation) return;
    const results = document.getElementById('ticket-results'); results.className = 'ticket-list'; results.innerHTML = ticketCards(data.tickets);
    document.getElementById('pagination').innerHTML = `<div class="pagination"><button class="button subtle small" id="previous" ${state.offset === 0 ? 'disabled' : ''}>← Anterior</button><span>Página ${state.offset / 20 + 1}</span><button class="button subtle small" id="next" ${!data.has_more ? 'disabled' : ''}>Siguiente →</button></div>`;
    document.getElementById('previous').onclick = () => { state.offset = Math.max(0, state.offset - 20); route(); };
    document.getElementById('next').onclick = () => { state.offset += 20; route(); };
  }
  async function newTicket(generation) {
    if (!state.user.can_create) { main.innerHTML = '<section class="panel"><h1>Tu perfil es de atención</h1><p>Puedes consultar y responder las solicitudes desde tu bandeja.</p><a class="button" href="#/tickets">Ver solicitudes</a></section>'; return; }
    if (!state.services) state.services = (await api('services')).services;
    const schema = (await api('schema')).schema;
    if (generation !== state.generation) return;
    main.innerHTML = `<a class="breadcrumb" href="#/inicio">← Volver al inicio</a><p class="eyebrow">ESTAMOS PARA AYUDARTE</p><h1>Cuéntanos qué necesitas</h1><p class="lead">Completa estos datos. Recibirás un número para seguir tu solicitud desde aquí.</p><div class="steps"><span><b>1</b> Elige el servicio</span><span><b>2</b> Describe tu solicitud</span><span><b>3</b> Envíala y sigue los avances</span></div><div class="form-layout"><form class="panel" id="create-form"><div class="field"><label for="service">¿En qué necesitas ayuda?</label><select name="service" id="service" required><option value="">Selecciona una opción</option>${state.services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><small id="service-hint">Elige la opción que mejor describe lo que necesitas.</small></div><div class="field"><label for="title">Asunto</label><input name="title" id="title" required minlength="4" maxlength="200" placeholder="Ej.: No puedo acceder al repositorio"><small>Un resumen breve para identificar tu solicitud.</small></div><div class="field"><label for="description">¿Qué ocurre o qué necesitas?</label><textarea name="description" id="description" required minlength="10" maxlength="20000" placeholder="Indica el servicio o proyecto, qué esperabas que ocurriera y qué sucede. Si hay un error, explica cómo reproducirlo."></textarea></div><div class="field"><label for="urgency">¿Cuánto afecta tu trabajo?</label><select name="urgency" id="urgency"><option value="2">Puedo continuar trabajando</option><option value="3" selected>Me dificulta parte del trabajo</option><option value="4">No puedo continuar una tarea importante</option><option value="5">Afecta un servicio crítico o a muchas personas</option></select><small>El equipo evaluará la prioridad según el impacto.</small></div>${fileField}<p id="create-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">Enviar solicitud →</button><a class="button subtle" href="#/inicio">Cancelar</a></div></form><aside class="panel form-hints"><span class="choice-icon" aria-hidden="true">?</span><h2>Una buena descripción ayuda</h2><ul><li>Menciona el servicio o proyecto relacionado.</li><li>Explica desde cuándo ocurre y a quién afecta.</li><li>Agrega una captura del error, si la tienes.</li><li>No incluyas claves ni información sensible.</li></ul><p>Después de enviar, podrás agregar más información en la conversación.</p></aside></div>`;
    const additional = document.createElement('div'); additional.id = 'additional-fields';
    additional.innerHTML = schema.fields.map(f => `<div class="field"><label for="${f.id}">${esc(f.label)} ${f.required ? '' : '<span class="muted">(opcional)</span>'}</label>${f.type === 'textarea' ? `<textarea id="${f.id}" maxlength="4000" ${f.required ? 'required' : ''}></textarea>` : f.type === 'select' ? `<select id="${f.id}" ${f.required ? 'required' : ''}><option value="">Selecciona una opción</option>${f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>` : `<input id="${f.id}" maxlength="255" ${f.required ? 'required' : ''}>`}</div>`).join('');
    document.getElementById('file').closest('.field').before(additional);
    document.getElementById('service').onchange = event => { document.getElementById('service-hint').textContent = event.target.value === 'F08' ? 'Si el incidente está ocurriendo ahora, informa también al responsable institucional. No compartas evidencia sensible por este medio.' : 'Elige la opción que mejor describe lo que necesitas.'; };
    document.getElementById('create-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; submit(form, async () => {
      const file = form.elements.file.files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar menos de 10 MB.');
      const payload = new FormData(form);
      payload.set('answers', JSON.stringify(Object.fromEntries(schema.fields.map(f => [f.id, document.getElementById(f.id).value]))));
      const data = await api('create', payload);
      state.flash = 'Solicitud #' + data.ticket.id + ' enviada. Puedes seguir la conversación aquí.';
      window.location.hash = '#/ticket/' + data.ticket.id;
    }, 'create-error'); };
  }
  async function detail(id, generation) {
    const data = await api('ticket', undefined, { id });
    if (generation !== state.generation) return;
    renderDetail(data.ticket);
  }
  function renderDetail(t) {
    state.ticket = t; const p = t.permissions;
    main.innerHTML = `<a class="breadcrumb" href="#/tickets">← Volver a solicitudes</a><div class="page-head detail-head"><div><p class="eyebrow">SOLICITUD #${t.id}</p><h1>${esc(t.title)}</h1><p class="lead">Creada el ${esc(date(t.created_at))}</p></div><div class="actions">${badge(t)}<button id="refresh-ticket" class="button subtle small">Actualizar</button></div></div>${p.approve ? '<section class="approve-box"><h2>El equipo publicó una solución</h2><p>Revisa la respuesta. Puedes confirmar que está resuelto o indicar qué falta.</p><div class="actions"><button id="approve-solution" class="button">Sí, está resuelto</button><button id="reject-solution" class="button subtle">Necesito más ayuda</button></div><form id="reject-form" hidden style="margin-top:20px"><div class="field"><label for="reject-message">Cuéntanos qué falta por resolver</label><textarea id="reject-message" name="message" required minlength="5" maxlength="20000"></textarea></div><button type="submit" class="button">Enviar y reabrir solicitud</button></form></section>' : ''}<div class="detail-grid"><div><section class="panel"><div class="panel-heading"><h2>Tu solicitud</h2>${p.edit ? '<button id="show-edit" class="button subtle small">Editar</button>' : ''}</div><div id="ticket-description" class="text-content">${esc(t.description)}</div>${p.edit ? `<form id="edit-form" hidden><div class="field"><label for="edit-title">Asunto</label><input id="edit-title" name="title" value="${esc(t.title)}" minlength="4" maxlength="200" required></div><div class="field"><label for="edit-description">Descripción</label><textarea id="edit-description" name="description" required minlength="10" maxlength="20000">${esc(t.description)}</textarea></div>${t.status <= 4 ? `<div class="field"><label for="edit-status">Estado</label><select id="edit-status" name="status">${['Recibida','En curso','Planificada','En espera'].map((s, i) => `<option value="${i+1}" ${t.status === i+1 ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : ''}<p id="edit-error" role="alert" class="inline-error" hidden></p><div class="actions"><button type="submit" class="button">Guardar cambios</button><button id="cancel-edit" type="button" class="button subtle">Cancelar</button></div></form>` : ''}</section><section class="panel"><div class="panel-heading"><h2>Conversación</h2><small>${t.messages.length} ${t.messages.length === 1 ? 'mensaje' : 'mensajes'}</small></div>${t.messages.length ? t.messages.map(m => `<article class="message ${m.kind === 'solution' ? 'solution' : ''}"><div class="message-header"><strong>${esc(m.author)}${m.kind === 'solution' ? ' · Solución propuesta' : ''}${m.private ? '<span class="message-tag">Nota interna</span>' : ''}</strong><time>${esc(date(m.date))}</time></div><div class="text-content">${esc(m.content)}</div></article>`).join('') : '<p class="muted">Tu solicitud fue recibida. Las respuestas del equipo aparecerán aquí.</p>'}${p.reply ? `<form id="reply-form" class="reply-form"><div class="field"><label for="message">Agregar una respuesta</label><textarea id="message" name="message" required maxlength="20000" placeholder="Escribe tu respuesta o agrega información sobre el caso…"></textarea></div>${p.private_reply ? '<label class="check-field"><input type="checkbox" id="private-reply" name="private" value="1"> Nota interna: visible solo para el equipo autorizado</label>' : ''}${fileField}<p id="reply-error" role="alert" class="inline-error" hidden></p><button type="submit" class="button">Enviar respuesta →</button></form>` : `<p class="welcome-note">${t.status === 6 ? 'Esta solicitud está cerrada. Si necesitas ayuda con un caso nuevo, crea otra solicitud.' : 'Tu perfil no permite agregar respuestas en este estado.'}</p>`}</section>${p.solve ? '<section class="panel"><h2>Proponer una solución</h2><p class="muted">La solución quedará visible para el cliente, que podrá revisarla.</p><form id="solve-form"><div class="field"><label for="solution">Qué se resolvió y cómo</label><textarea id="solution" name="message" required minlength="10" maxlength="20000"></textarea></div><p id="solve-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button">Registrar solución</button></form></section>' : ''}</div><aside><section class="panel"><h2>Detalles</h2><dl class="meta-list"><div><dt>Estado</dt><dd>${esc(t.status_label)}</dd></div><div><dt>Solicitante</dt><dd>${esc(t.requesters.join(', '))}</dd></div><div><dt>Última actividad</dt><dd>${esc(date(t.updated_at))}</dd></div><div><dt>Tipo</dt><dd>${t.type === 1 ? 'Incidente' : 'Solicitud de servicio'}</dd></div></dl>${p.delete ? '<div class="danger-zone"><button id="delete-ticket">Enviar a la papelera</button></div>' : ''}</section><section class="panel"><h2>Archivos adjuntos</h2>${t.attachments.length ? `<ul class="attachment-list">${t.attachments.map(a => `<li><a href="api?action=download&amp;id=${t.id}&amp;document=${a.id}" download>↓ ${esc(a.name)}</a></li>`).join('')}</ul>` : '<small>No hay archivos adjuntos.</small>'}</section></aside></div>`;
    document.getElementById('refresh-ticket').onclick = () => route();
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
    if (p.delete) document.getElementById('delete-ticket').onclick = () => {
      const dialog = document.getElementById('confirm-dialog'); dialog.showModal();
      document.getElementById('cancel-delete').onclick = () => dialog.close();
      document.getElementById('confirm-delete').onclick = async event => {
        event.currentTarget.disabled = true;
        try { await api('delete', {}, { id: t.id }); dialog.close(); state.flash = 'Solicitud enviada a la papelera. El historial se conserva en GLPI.'; window.location.hash = '#/tickets'; }
        catch (error) { dialog.close(); notice(error.message, true); }
        finally { event.target.disabled = false; }
      };
    }
  }
  async function route() {
    const generation = ++state.generation;
    shell();
    if (!state.user) { login(); return; }
    const routeName = window.location.hash.slice(2) || (window.location.pathname.includes('crear-consulta') ? 'nueva' : window.location.pathname.includes('panel-atencion') ? 'tickets' : 'inicio');
    document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === (routeName.startsWith('ticket/') ? 'tickets' : routeName); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    main.innerHTML = '<div class="loading" aria-live="polite">Cargando tu espacio…</div>';
    try {
      if (routeName === 'nueva') await newTicket(generation);
      else if (routeName === 'administracion') await administration(generation);
      else if (routeName === 'tickets') await tickets(generation);
      else if (/^ticket\/\d+$/.test(routeName)) await detail(Number(routeName.split('/')[1]), generation);
      else await dashboard(generation);
    } catch (error) {
      if (generation !== state.generation || !state.user) return;
      main.innerHTML = `<section class="panel empty"><h1>No pudimos abrir esta página</h1><p>${esc(error.message)}</p><div class="actions" style="justify-content:center"><button id="retry" class="button">Intentar nuevamente</button><a class="button subtle" href="#/inicio">Volver al inicio</a></div></section>`;
      document.getElementById('retry').onclick = () => route();
    }
  }
  document.getElementById('logout').onclick = async event => {
    event.currentTarget.disabled = true;
    try { await api('logout', {}); state.user = null; state.ticket = null; state.services = null; state.query = ''; state.status = ''; state.offset = 0; const data = await api('session'); state.csrf = data.csrf; notice('Sesión cerrada.'); shell(); login(); }
    catch (error) { notice(error.message, true); }
    finally { event.target.disabled = false; }
  };
  let origin = new URLSearchParams(window.location.search).get('origen');
  try { if (origin === 'A' || origin === 'B') sessionStorage.setItem('eticket-origin', origin); origin = sessionStorage.getItem('eticket-origin'); } catch (_) { /* Optional memory. */ }
  if (origin === 'A' || origin === 'B') { const link = document.getElementById('origin-link'); link.href = ((window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081') + '/plugins/etickethub/front/return.php?origen=' + origin; link.hidden = false; }
  window.addEventListener('hashchange', () => { notice(state.flash); state.flash = ''; route(); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo(0,0); });
  api('session').then(data => { state.user = data.user; state.csrf = data.csrf; return route(); }).catch(error => { notice(error.message, true); main.innerHTML = '<section class="panel empty"><h1>Estamos preparando tu espacio</h1><p>La conexión con soporte no está disponible. Intenta recargar en unos momentos.</p><button id="reload" class="button">Recargar</button></section>'; document.getElementById('reload').onclick = () => window.location.reload(); });
})();
