(function () {
  'use strict';
  const main = document.getElementById('main');
  const state = { user: null, csrf: '', services: null, generation: 0, offset: 0, query: '', status: '', ticket: null, flash: '', pendingEmail: '', verifyMode: '', intent: '', prefillUser: '' };
  try { state.intent = sessionStorage.getItem('eticket-intent') || ''; } catch (_) { /* Optional memory. */ }
  const INTENTS = { servicio: 'Quiero un servicio', problema: 'Tengo un problema' };
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
  const PUBLIC_ACTIONS = ['login', 'register', 'verify_login', 'resend_code'];
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
    if (response.status === 429) throw new Error(action === 'login' ? 'Has intentado ingresar varias veces. Espera un minuto antes de volver a intentar.' : 'Hiciste varios intentos seguidos. Espera un minuto antes de volver a intentar.');
    if (response.status === 413) throw new Error('El archivo supera el tamaño permitido. Adjunta uno de hasta 10 MB.');
    if (response.status === 502 || response.status === 503 || response.status === 504) throw new Error('El servicio de soporte no está disponible por el momento. Intenta nuevamente en unos instantes.');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error(action === 'login' ? 'No pudimos completar el acceso. Si tu cuenta utiliza doble factor, ingresa primero desde el acceso institucional de GLPI.' : 'El servicio devolvió una respuesta inesperada. Intenta nuevamente.');
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !PUBLIC_ACTIONS.includes(action)) { state.user = null; shell(); route(); }
      throw new Error(data.error || 'No pudimos completar la operación.');
    }
    return data;
  }
  // El gestor supervisa e interviene, pero no crea solicitudes.
  const canCreate = () => !!state.user && !!state.user.can_create && state.user.role !== 'gestor';
  function shell() {
    const logged = !!state.user;
    document.getElementById('sidebar').hidden = !logged;
    document.getElementById('logout').hidden = !logged;
    if (!logged) return;
    const u = state.user;
    document.getElementById('account-name').textContent = u.name;
    document.getElementById('account-avatar').textContent = u.name.trim().slice(0, 2).toUpperCase();
    document.getElementById('account-role').textContent = { cliente: 'Cliente', agente: 'Agente de atención', gestor: u.can_admin ? 'Gestor administrador' : 'Gestor de tickets' }[u.role];
    document.getElementById('new-nav').hidden = !canCreate();
    document.getElementById('admin-nav').hidden = !u.can_admin;
    document.getElementById('tickets-nav-label').textContent = u.role === 'cliente' ? 'Mis solicitudes' : 'Solicitudes';
  }
  const storyHtml = (title, text) => `<div class="login-story"><p class="eyebrow">TECH HUB ULS / CENTRO DE AYUDA</p><h1>${title}<span style="color:#f37188">.</span></h1><p>${text}</p><ul><li>Envía tu solicitud en pocos pasos</li><li>Conversa directamente con el equipo</li><li>Consulta el estado cuando lo necesites</li></ul><small>Eticket · Conectamos preguntas con soluciones.</small></div>`;
  function bindPasswordToggle(buttonId, inputIds) {
    document.getElementById(buttonId).onclick = event => {
      const inputs = inputIds.map(id => document.getElementById(id)); const show = inputs[0].type === 'password';
      inputs.forEach(input => { input.type = show ? 'text' : 'password'; });
      event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar'; event.currentTarget.setAttribute('aria-pressed', String(show));
    };
  }
  function welcome() {
    main.innerHTML = `<section class="start"><p class="eyebrow">TECH HUB ULS / CENTRO DE AYUDA</p><h1>¿Cómo podemos ayudarte?</h1><p class="lead">Elige la opción que mejor describe lo que necesitas. Después ingresarás con tu cuenta para continuar.</p><div class="choice-grid start-grid"><a class="choice" href="#/ingresar" data-intent="servicio"><span class="choice-icon" aria-hidden="true">＋</span><h2>Quiero un servicio</h2><p>Pide un acceso, apoyo técnico, datos o un nuevo proyecto a alguna de nuestras unidades.</p><span>Continuar →</span></a><a class="choice" href="#/ingresar" data-intent="problema"><span class="choice-icon" aria-hidden="true">!</span><h2>Tengo un problema</h2><p>Algo dejó de funcionar o no funciona como esperabas: un sistema, un acceso o un equipo.</p><span>Continuar →</span></a></div><p class="start-login">Para entrar, elige una de las dos opciones. Si ya tienes solicitudes, las verás al iniciar sesión.</p></section>`;
    main.querySelectorAll('[data-intent]').forEach(card => {
      card.onclick = () => {
        state.intent = card.dataset.intent;
        try { sessionStorage.setItem('eticket-intent', state.intent); } catch (_) { /* Optional memory. */ }
      };
    });
  }
  function login() {
    const glpi = (window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081';
    main.innerHTML = `<section class="login-grid">${storyHtml('Tu próxima solución empieza aquí', 'Un espacio simple para pedir ayuda y mantenerte al tanto. Nosotros nos encargamos del resto.')}<form id="login-form" class="login-form"><h2>Te damos la bienvenida</h2>${INTENTS[state.intent] ? `<p class="intent-chip">Elegiste: <strong>${INTENTS[state.intent]}</strong> · <a href="#/">Cambiar</a></p>` : ''}<p>Ingresa con tu cuenta de soporte para continuar.</p><div class="field"><label for="username">Usuario o correo</label><input id="username" name="username" autocomplete="username" required maxlength="255" placeholder="Tu usuario o correo" value="${esc(state.prefillUser)}"></div><div class="field"><label for="password">Contraseña</label><div class="password-row"><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="button" class="button subtle small" id="show-password" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div></div><p class="inline-error" id="login-error" role="alert" hidden></p><button type="submit" class="button">Ingresar a mi espacio <span aria-hidden="true">→</span></button><p class="login-switch">¿Aún no tienes cuenta? <a href="#/registro">Crea una cuenta</a></p><div class="login-help"><strong>¿Necesitas acceso?</strong><p>Contacta a la persona que te dio acceso al servicio. Usa tu cuenta de soporte, sin compartirla.</p><a id="institutional-login" href="${esc(glpi)}" target="_blank" rel="noopener">Acceso institucional / doble factor ↗</a></div></form></section>`;
    bindPasswordToggle('show-password', ['password']);
    document.getElementById('login-form').onsubmit = event => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const data = await api('login', { username: document.getElementById('username').value, password: document.getElementById('password').value });
        if (data.verification_required) {
          document.getElementById('password').value = '';
          state.csrf = data.csrf || state.csrf; state.pendingEmail = data.email || ''; state.verifyMode = 'login'; state.prefillUser = '';
          if (window.location.hash === '#/verificar') route(); else window.location.hash = '#/verificar';
          return;
        }
        state.user = data.user; state.csrf = data.csrf; state.services = null; state.prefillUser = '';
        if (!state.user) throw new Error('La cuenta no tiene un perfil de soporte activo.');
        document.getElementById('password').value = ''; notice(''); shell();
        if (window.location.hash === '#/inicio') route(); else window.location.hash = '#/inicio';
      }, 'login-error');
    };
  }
  function register() {
    main.innerHTML = `<section class="login-grid">${storyHtml('Crea tu cuenta y empieza hoy', 'Regístrate una sola vez para enviar solicitudes y seguir cada conversación con el equipo.')}<form id="register-form" class="login-form"><h2>Crea tu cuenta</h2><p>Completa tus datos. Cada vez que inicies sesión te enviaremos un código a tu correo para confirmar que eres tú.</p><div class="field"><label for="reg-name">Nombre completo</label><input id="reg-name" name="name" autocomplete="name" required minlength="3" maxlength="120" placeholder="Ej.: Camila Rojas"></div><div class="field"><label for="reg-email">Correo electrónico</label><input id="reg-email" name="email" type="email" autocomplete="email" required maxlength="255" placeholder="nombre@gmail.com" value="${esc(state.pendingEmail)}"><small>Aquí te llegarán el código de verificación y los avances de tus solicitudes.</small></div><div class="field"><label for="reg-password">Contraseña</label><div class="password-row"><input id="reg-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="1024" aria-describedby="reg-password-hint"><button type="button" class="button subtle small" id="show-reg-password" aria-label="Mostrar contraseñas" aria-pressed="false">Mostrar</button></div><small id="reg-password-hint">Mínimo 8 caracteres. Combina letras y números, y no la uses en otros sitios.</small></div><div class="field"><label for="reg-password2">Repite la contraseña</label><input id="reg-password2" type="password" autocomplete="new-password" required minlength="8" maxlength="1024"></div><label class="check-field consent"><input type="checkbox" id="reg-consent" required><span>Acepto la <button type="button" class="link-button" data-open-privacy data-privacy-accept>política de privacidad</button> y el uso de mis datos para gestionar mis solicitudes.</span></label><p class="inline-error" id="register-error" role="alert" hidden></p><button type="submit" class="button">Crear cuenta <span aria-hidden="true">→</span></button><p class="login-switch">¿Ya tienes cuenta? <a href="#/ingresar">Inicia sesión</a></p></form></section>`;
    bindPasswordToggle('show-reg-password', ['reg-password', 'reg-password2']);
    document.getElementById('register-form').onsubmit = event => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim().toLowerCase();
        const password = document.getElementById('reg-password').value;
        if (password !== document.getElementById('reg-password2').value) throw new Error('Las contraseñas no coinciden.');
        await api('register', { name, email, password });
        document.getElementById('reg-password').value = ''; document.getElementById('reg-password2').value = '';
        // La verificación en dos pasos ocurre al iniciar sesión.
        state.prefillUser = email;
        state.flash = 'Tu cuenta fue creada. Inicia sesión: te enviaremos un código a tu correo para confirmar que eres tú.';
        window.location.hash = '#/ingresar';
      }, 'register-error');
    };
  }
  function verify() {
    const mode = state.verifyMode;
    const email = state.pendingEmail;
    if (mode !== 'login') { login(); return; }
    const isLogin = true;
    const destination = email ? `a <strong>${esc(email)}</strong>` : 'a tu correo electrónico registrado';
    main.innerHTML = `<section class="login-grid">${storyHtml(isLogin ? 'Un paso más para entrar' : 'Un último paso', isLogin ? 'Para proteger tu cuenta, confirmamos que eres tú con un código que enviamos a tu correo.' : 'Verificamos tu correo para proteger tu cuenta y asegurarnos de que los avances te lleguen a ti.')}<form id="verify-form" class="login-form"><h2>Verificación de seguridad</h2><div class="verify-alert" id="verify-alert" role="status"><span class="verify-alert-icon" aria-hidden="true">✓</span><p>Hemos enviado un código de seguridad ${destination}.</p><button type="button" id="close-alert" aria-label="Cerrar aviso">×</button></div><p>Por seguridad, ingresa el código numérico de 6 dígitos que enviamos a tu correo.</p><div class="field"><label for="verify-code">Código de verificación</label><input id="verify-code" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000" aria-describedby="verify-hint"><small id="verify-hint">Si no lo ves, revisa también la carpeta de spam.</small></div><p class="inline-error" id="verify-error" role="alert" hidden></p><button type="submit" class="button">${isLogin ? 'Verificar y acceder' : 'Verificar y activar mi cuenta'} <span aria-hidden="true">→</span></button><div class="login-help verify-help"><p>¿No te llegó el código? <button type="button" class="link-button" id="resend-code">Reenviar código</button></p><a class="verify-back" href="${isLogin ? '#/ingresar' : '#/registro'}"><span aria-hidden="true">←</span> Volver a ingresar datos</a></div></form></section>`;
    document.getElementById('close-alert').onclick = () => { document.getElementById('verify-alert').hidden = true; };
    const codeInput = document.getElementById('verify-code');
    codeInput.oninput = () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); };
    codeInput.focus();
    const resend = document.getElementById('resend-code');
    let timer = null;
    const cooldown = seconds => {
      clearInterval(timer); let left = seconds; resend.disabled = true; resend.textContent = `Reenviar en ${left} s`;
      timer = setInterval(() => {
        left -= 1;
        if (!document.contains(resend)) { clearInterval(timer); return; }
        if (left <= 0) { clearInterval(timer); resend.disabled = false; resend.textContent = 'Reenviar código'; }
        else resend.textContent = `Reenviar en ${left} s`;
      }, 1000);
    };
    cooldown(60);
    resend.onclick = async () => {
      resend.disabled = true;
      const errorEl = document.getElementById('verify-error'); errorEl.hidden = true;
      try {
        await api('resend_code', { purpose: 'login' });
        document.getElementById('verify-alert').hidden = false; cooldown(60);
      } catch (error) { errorEl.textContent = error.message; errorEl.hidden = false; resend.disabled = false; }
    };
    document.getElementById('verify-form').onsubmit = event => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const data = await api('verify_login', { code: codeInput.value });
        clearInterval(timer); state.pendingEmail = ''; state.verifyMode = '';
        if (!data.user) throw new Error('No pudimos iniciar tu sesión. Vuelve a ingresar tus datos.');
        state.user = data.user; state.csrf = data.csrf || state.csrf; state.services = null; state.prefillUser = '';
        if (window.location.hash === '#/inicio') route(); else window.location.hash = '#/inicio';
      }, 'verify-error');
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
    if (!tickets.length) return `<div class="empty"><span class="choice-icon" aria-hidden="true">▤</span><h2>No hay solicitudes para mostrar</h2><p>Cuando envíes una solicitud, podrás seguir sus avances aquí. Si estás buscando una, revisa los filtros.</p>${canCreate() ? '<a class="button subtle" href="#/nueva">Crear una solicitud</a>' : ''}</div>`;
    return tickets.map(t => `<a class="ticket-card" href="#/ticket/${t.id}"><span class="ticket-number">#${t.id}</span><div><strong>${esc(t.title)}</strong><small>Última actividad: ${esc(date(t.updated_at))}</small></div>${tierChip(t) ? `<span class="ticket-badges">${tierChip(t)}${badge(t)}</span>` : badge(t)}</a>`).join('');
  }
  async function dashboard(generation) {
    const staff = state.user.role !== 'cliente';
    main.innerHTML = `<p class="eyebrow">${staff ? 'MESA DE AYUDA' : 'TU ESPACIO DE SOPORTE'}</p><h1>Hola, ${esc(state.user.name.split(' ')[0])}<span class="brand-dot">.</span></h1><p class="lead">${staff ? 'Las conversaciones y solicitudes de tu equipo, en un solo lugar.' : '¿En qué podemos ayudarte hoy? Crea una solicitud o retoma una conversación con nuestro equipo.'}</p>${staff ? `<div class="role-info">${state.user.role === 'gestor' ? 'Perfil gestor: supervisas todas las solicitudes y puedes intervenir en cualquier caso cuando lo estimes necesario. Administras las cuentas, los tiers y el formulario desde Administración.' : 'Perfil agente: atiendes las solicitudes asignadas a ti o a tu equipo. Puedes responder, cambiar el estado, registrar la solución o escalar el caso al siguiente nivel.'}</div>` : ''}${staff ? '' : tierGuideHtml()}<div class="choice-grid">${canCreate() ? `<a class="choice" href="#/nueva"><span class="choice-icon" aria-hidden="true">${state.intent === 'servicio' ? '＋' : '!'}</span><h2>${state.intent === 'servicio' ? 'Pedir un servicio' : 'Reportar un problema'}</h2><p>${state.intent === 'servicio' ? 'Cuéntanos qué necesitas. Te guiaremos para enviarlo al equipo correcto.' : 'Cuéntanos qué está fallando. Te guiaremos para enviarlo al equipo correcto.'}</p><span>Comenzar solicitud →</span></a>` : ''}<a class="choice" href="#/tickets"><span class="choice-icon" aria-hidden="true">▤</span><h2>${state.user.role === 'agente' ? 'Solicitudes asignadas' : staff ? 'Todas las solicitudes' : 'Mis solicitudes'}</h2><p>Revisa avances, responde al equipo y consulta las soluciones.</p><span>Ver conversaciones →</span></a></div><section class="panel"><div class="panel-heading"><h2>Solicitudes recientes</h2><a href="#/tickets">Ver todas →</a></div><div id="recent-tickets" class="loading">Cargando solicitudes…</div></section><p class="welcome-note">No necesitas crear otra solicitud para agregar información. Abre la conversación existente y escribe tu respuesta.</p>`;
    const data = await api('tickets');
    if (generation !== state.generation) return;
    const el = document.getElementById('recent-tickets'); el.className = 'ticket-list'; el.innerHTML = ticketCards(data.tickets.slice(0, 5));
    if (state.user.can_admin) {
      const adminChoice = document.createElement('a'); adminChoice.className = 'choice'; adminChoice.href = '#/administracion';
      adminChoice.innerHTML = '<span class="choice-icon" aria-hidden="true">⚙</span><h2>Administrar Eticket</h2><p>Crea las cuentas de tu equipo con su tier, personaliza el formulario de solicitudes y accede a GLPI.</p><span>Abrir administración →</span>';
      document.querySelector('.choice-grid').appendChild(adminChoice);
    }
  }
  // Campos base del formulario de nuevas solicitudes. El gestor puede cambiar sus textos,
  // pero no quitarlos ni cambiar su tipo.
  const BASE_FIELDS = {
    service: { name: 'Servicio', note: 'Siempre obligatorio. Puedes renombrar, ocultar o agregar opciones a la lista. Los servicios que agregues llegan primero a la mesa de ayuda (Tier IV).',
      label: '¿En qué necesitas ayuda?', hint: 'Elige la opción que mejor describe lo que necesitas.' },
    kind: { name: 'Tipo de solución', note: 'Solo aparece cuando la persona entra por “Quiero un servicio”. Escribe una opción por línea.',
      label: '¿Qué tipo de solución necesitas?', hint: 'Elige la opción más cercana. Si no está, elige “Otro” y explícalo en la descripción.',
      list: ['Sitio web', 'Aplicación web', 'Aplicación móvil', 'Datos y análisis', 'Hardware o IoT', 'Otro'] },
    problem: { name: 'Qué está fallando', note: 'Solo aparece cuando la persona entra por “Tengo un problema”. Escribe una opción por línea.',
      label: '¿Qué está fallando?', hint: 'Elige la opción más cercana. Si no está, elige “Otro” y explícalo en la descripción.',
      list: ['Un sistema o aplicación', 'Mi cuenta o acceso', 'Un equipo o dispositivo', 'La red o internet', 'Otro'] },
    title: { name: 'Asunto', note: 'Siempre obligatorio, de 4 a 200 caracteres.',
      label: 'Asunto', placeholder: 'Ej.: No puedo acceder al repositorio', hint: 'Un resumen breve para identificar tu solicitud.' },
    description: { name: 'Descripción', note: 'Siempre obligatoria, mínimo 10 caracteres.',
      label: '¿Qué ocurre o qué necesitas?', placeholder: 'Indica el servicio o proyecto, qué esperabas que ocurriera y qué sucede. Si hay un error, explica cómo reproducirlo.', hint: '' },
    urgency: { name: 'Impacto', note: 'Solo aparece con “Tengo un problema”. Los cuatro niveles se mantienen porque definen la prioridad; solo cambia cómo se describen.',
      label: '¿Cuánto afecta tu trabajo?', hint: 'El equipo evaluará la prioridad según el impacto.',
      options: { 2: 'Puedo continuar trabajando', 3: 'Me dificulta parte del trabajo', 4: 'No puedo continuar una tarea importante', 5: 'Afecta un servicio crítico o a muchas personas' } },
  };
  const BASE_TEXT_KEYS = ['label', 'hint', 'placeholder'];
  // Mezcla lo guardado por el gestor con los textos originales.
  function baseOf(schema) {
    const saved = (schema && schema.base) || {};
    return Object.fromEntries(Object.entries(BASE_FIELDS).map(([key, def]) => {
      const own = saved[key] || {}; const merged = {};
      BASE_TEXT_KEYS.forEach(k => { if (k in def) merged[k] = typeof own[k] === 'string' && (k !== 'label' || own[k].trim()) ? own[k] : def[k]; });
      if (def.list) { const list = Array.isArray(own.list) ? own.list.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []; merged.list = list.length >= 2 ? list : [...def.list]; }
      if (key === 'service') merged.custom = (Array.isArray(own.custom) ? own.custom : []).filter(c => c && typeof c.id === 'string' && typeof c.name === 'string').map(c => ({ id: c.id, name: c.name, type: Number(c.type) === 1 ? 1 : 2, hidden: !!c.hidden }));
      if (key === 'service') merged.options = Object.fromEntries(Object.entries(own.options && typeof own.options === 'object' ? own.options : {}).map(([code, o]) => [code, { name: o && typeof o.name === 'string' ? o.name.trim() : '', hidden: !!(o && o.hidden) }]));
      else if (def.options) merged.options = Object.fromEntries(Object.entries(def.options).map(([level, text]) => [level, own.options && typeof own.options[level] === 'string' && own.options[level].trim() ? own.options[level] : text]));
      return [key, merged];
    }));
  }
  const hintHtml = (text, id) => text ? `<small${id ? ` id="${id}"` : ''}>${esc(text)}</small>` : (id ? `<small id="${id}"></small>` : '');

  // ---- Usuarios y tiers (Administración) ---------------------------------
  // El gestor crea las cuentas de las personas sin ir a GLPI. Los tipos de cuenta
  // son fijos (cliente, agente, gestor) y a cada agente se le asigna su tier.
  // En GLPI, el tier de un agente es el grupo al que pertenece.
  const USER_ROLES = { cliente: 'Cliente', agente: 'Agente', gestor: 'Gestor' };
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
      el.innerHTML = `<h2>Usuarios y tiers</h2><p class="welcome-note">El servidor todavía no permite administrar cuentas desde aquí. Mientras tanto, puedes hacerlo en GLPI.</p><a class="button subtle" href="${esc(fallbackUrl)}" target="_blank" rel="noopener">Abrir usuarios en GLPI ↗</a>`;
      return;
    }
    let editing = null;          // null = sin formulario; {} = cuenta nueva; {...} = cuenta existente
    let query = ''; let roleFilter = '';
    const isSelf = u => !!state.user && u.login === state.user.login;
    function rowsHtml() {
      const q = query.trim().toLowerCase();
      const list = users.filter(u => (!roleFilter || u.role === roleFilter) && (!q || `${u.name} ${u.email} ${u.login}`.toLowerCase().includes(q)));
      if (!list.length) return '<p class="muted users-empty">No hay cuentas que coincidan con la búsqueda.</p>';
      return `<div class="profile-list">${list.map(u => `<article class="profile-row user-row${u.role === 'agente' && TIERS[u.tier] ? ` tier-accent-${u.tier}` : ''}${u.active === false ? ' inactive' : ''}"><div class="profile-main"><strong>${esc(u.name)}${isSelf(u) ? ' <span class="muted">(tú)</span>' : ''}</strong><small>${esc(u.email || u.login)}</small></div><div class="profile-tier"><span class="role-tag">${esc(USER_ROLES[u.role] || u.role)}</span>${u.role === 'agente' ? (TIERS[u.tier] ? chip(u.tier) : '<span class="muted">Sin tier</span>') : ''}</div><div class="profile-users">${u.active === false ? '<span class="state-off">Inactiva</span>' : 'Activa'}</div><div class="actions profile-actions"><button type="button" class="button subtle small" data-edit-user="${esc(u.id)}">Editar</button></div></article>`).join('')}</div>`;
    }
    function formHtml(u) {
      const role = u.role || 'agente'; const isNew = !u.id; const self = isSelf(u);
      return `<form id="user-form" class="profile-form panel-inset" novalidate><h3>${isNew ? 'Crear cuenta' : 'Editar cuenta'}</h3><div class="form-row"><div class="field"><label for="user-name">Nombre completo</label><input id="user-name" name="name" required minlength="3" maxlength="120" value="${esc(u.name || '')}" placeholder="Ej.: Ana Soto" autocomplete="off"></div><div class="field"><label for="user-email">Correo</label><input id="user-email" name="email" type="email" required maxlength="255" value="${esc(u.email || '')}" placeholder="ana.soto@userena.cl" autocomplete="off"></div></div><div class="field"><label for="user-login">Usuario para iniciar sesión</label><input id="user-login" name="login" required minlength="3" maxlength="60" pattern="[a-z0-9._-]+" value="${esc(u.login || '')}" placeholder="ana.soto" autocomplete="off"${isNew ? '' : ' readonly'}><small>${isNew ? 'Se completa con el correo. Solo minúsculas, números, punto, guion o guion bajo.' : 'El usuario no se puede cambiar.'}</small></div><fieldset class="profile-role"><legend>Tipo de cuenta</legend>${Object.entries(USER_ROLES).map(([value, label]) => `<label class="role-option"><input type="radio" name="role" value="${value}"${role === value ? ' checked' : ''}${self ? ' disabled' : ''}><span>${label}</span></label>`).join('')}<small id="user-role-help">${self ? 'No puedes cambiar tu propio tipo de cuenta.' : ROLE_HELP[role]}</small></fieldset><div class="field" id="user-tier-field"${role === 'agente' ? '' : ' hidden'}><label for="user-tier">Tier</label><select id="user-tier" name="tier"><option value="">Selecciona un tier</option>${[4, 3, 2, 1].map(l => `<option value="${l}"${Number(u.tier) === l ? ' selected' : ''}>${esc(tierLabel(l))}</option>`).join('')}</select><small>Atenderá y podrá resolver los casos de ese tier. El cliente verá el tier junto a sus respuestas.</small></div>${isNew ? `<div class="field"><label for="user-password">Contraseña temporal</label><div class="password-row"><input id="user-password" name="password" required minlength="8" maxlength="128" autocomplete="new-password" value="${esc(tempPassword())}"><button type="button" class="button subtle small" id="new-password">Generar otra</button></div><small>Entrégasela a la persona por un canal seguro. Deberá cambiarla en su primer ingreso.</small></div>` : `<label class="check-field"><input type="checkbox" name="active"${u.active === false ? '' : ' checked'}${self ? ' disabled' : ''}> Cuenta activa</label><p class="muted admin-caption">Una cuenta inactiva no puede iniciar sesión, pero se conserva su historial. Las cuentas no se borran.</p>`}<p id="user-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">${isNew ? 'Crear cuenta' : 'Guardar cambios'}</button><button type="button" class="button subtle" id="cancel-user">Cancelar</button></div></form>`;
    }
    function render() {
      el.innerHTML = `<div class="panel-heading"><div><h2>Usuarios y tiers</h2><p class="muted admin-caption">Crea las cuentas de tu equipo y de los clientes. A cada agente asígnale su tier.</p></div>${editing ? '' : '<button type="button" class="button" id="new-user">＋ Crear cuenta</button>'}</div><div class="tier-legend" aria-label="Colores de los tiers">${[4, 3, 2, 1].map(l => `<span>${chip(l)} ${esc(TIERS[l].name)} · ${users.filter(u => u.role === 'agente' && Number(u.tier) === l && u.active !== false).length}</span>`).join('')}</div>${editing ? formHtml(editing) : ''}<div class="filters users-filters"><label class="visually-hidden" for="user-search">Buscar persona</label><input id="user-search" type="search" placeholder="Buscar por nombre, correo o usuario…" value="${esc(query)}"><label class="visually-hidden" for="user-role-filter">Filtrar por tipo</label><select id="user-role-filter"><option value="">Todos los tipos</option>${Object.entries(USER_ROLES).map(([v, l]) => `<option value="${v}"${roleFilter === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div><div id="user-rows">${rowsHtml()}</div><p class="muted admin-caption">Los tipos de cuenta son fijos. Para crear un tipo de cuenta con permisos distintos, usa “Perfiles de GLPI” en la pestaña Accesos a GLPI.</p>`;
      document.getElementById('user-search').oninput = event => { query = event.target.value; document.getElementById('user-rows').innerHTML = rowsHtml(); };
      document.getElementById('user-role-filter').onchange = event => { roleFilter = event.target.value; document.getElementById('user-rows').innerHTML = rowsHtml(); };
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
    el.onclick = event => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.id === 'new-user') { editing = {}; render(); }
      else if (target.dataset.editUser) { editing = users.find(u => String(u.id) === target.dataset.editUser) || null; render(); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    };
    render();
  }
  async function administration(generation) {
    if (!state.user.can_admin) {
      main.innerHTML = '<section class="panel"><h1>Acceso reservado al gestor</h1><p>Tu perfil no permite administrar la estructura ni los perfiles del sistema.</p><a class="button" href="#/inicio">Volver al inicio</a></section>'; return;
    }
    const data = await api('schema');
    try { state.adminServices = (await api('services', undefined, { all: 1 })).services; } catch (e) { state.adminServices = []; }
    state.services = null; // el formulario vuelve a pedir la lista para ver los cambios guardados
    if (generation !== state.generation) return;
    let revision = data.schema.revision;
    let fields = data.schema.fields.map(f => ({ ...f, options: [...f.options] }));
    let base = baseOf(data.schema);
    const glpi = (window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081';
    const nativeUrl = key => { try { const url = new URL(glpi.replace(/\/?$/, '/')); url.searchParams.set('redirect', state.user.admin_paths[key]); url.searchParams.set('noAUTO', '1'); return url.href; } catch (_) { return glpi; } };
    const nativeLink = (key, label, description) => `<a class="admin-tool" href="${esc(nativeUrl(key))}" target="_blank" rel="noopener"><strong>${label} ↗</strong><span>${description}</span></a>`;
    main.innerHTML = `<p class="eyebrow">GESTOR ADMINISTRADOR</p><h1>Administración de Eticket</h1><p class="lead">Crea las cuentas de tu equipo con su tier, configura el formulario de solicitudes y entra a GLPI cuando lo necesites.</p><div class="admin-tabs" role="tablist" aria-label="Secciones de administración"><button type="button" role="tab" id="tab-perfiles" aria-controls="panel-perfiles" data-tab="perfiles">Usuarios y tiers</button><button type="button" role="tab" id="tab-formulario" aria-controls="panel-formulario" data-tab="formulario">Formulario de solicitudes</button><button type="button" role="tab" id="tab-glpi" aria-controls="panel-glpi" data-tab="glpi">Accesos a GLPI</button></div><div class="admin-panel" id="panel-perfiles" role="tabpanel" aria-labelledby="tab-perfiles"><section class="panel" id="profiles-section"><div class="loading">Cargando cuentas…</div></section></div><div class="admin-panel" id="panel-formulario" role="tabpanel" aria-labelledby="tab-formulario" hidden><section class="panel"><div class="panel-heading"><div><h2>Estructura de las solicitudes del portal</h2><p class="muted admin-caption">Edita los campos que ya tiene el formulario de nuevas solicitudes y agrega, ordena o quita campos adicionales.</p></div></div><p class="welcome-note">Los cambios se aplican a las nuevas solicitudes; las respuestas de tickets existentes se conservan.</p><form id="schema-form"><h3 class="schema-group">Campos base <span class="muted">· siempre aparecen en el formulario</span></h3><p class="muted admin-caption schema-group-note">Puedes cambiar sus textos. No se pueden quitar ni cambiar de tipo porque el sistema los necesita para crear la solicitud.</p><div id="schema-base"></div><h3 class="schema-group">Campos adicionales</h3><div id="schema-fields"></div><div class="actions"><button id="add-schema-field" type="button" class="button subtle">＋ Añadir campo</button><span id="schema-count" class="muted admin-caption"></span></div><p id="schema-error" class="inline-error" role="alert" hidden></p><div class="actions admin-save"><button type="submit" class="button">Guardar estructura</button><a class="button subtle" href="#/nueva">Ver formulario</a></div></form></section></div><div class="admin-panel" id="panel-glpi" role="tabpanel" aria-labelledby="tab-glpi" hidden><section class="panel"><h2>Accesos a GLPI</h2><div class="admin-tools">${nativeLink('home', 'Abrir GLPI', 'Revisa la operación y configuración completa.')}${nativeLink('profiles', 'Perfiles de GLPI', 'Para casos avanzados: crea un tipo de cuenta con permisos distintos.')}${nativeLink('users', 'Usuarios en GLPI', 'Configuración avanzada de cuentas, entidades y grupos.')}${nativeLink('forms', 'Formularios de GLPI', 'Configura formularios nativos, campos y destinos.')}</div><p class="muted admin-caption">Estos accesos abren GLPI en otra pestaña. Si te pide iniciar sesión, utiliza la misma cuenta de gestor. Las cuentas del día a día se crean en la pestaña Usuarios y tiers.</p></section></div>`;
    // Pestañas: se recuerda la última abierta en este navegador.
    const showTab = name => { document.querySelectorAll('.admin-tabs [role=tab]').forEach(tab => { const on = tab.dataset.tab === name; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; document.getElementById('panel-' + tab.dataset.tab).hidden = !on; }); try { sessionStorage.setItem('eticket-admin-tab', name); } catch (_) { /* Optional memory. */ } };
    document.querySelector('.admin-tabs').onclick = event => { const tab = event.target.closest('[role=tab]'); if (tab) showTab(tab.dataset.tab); };
    document.querySelector('.admin-tabs').onkeydown = event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const tabs = [...document.querySelectorAll('.admin-tabs [role=tab]')]; const i = tabs.indexOf(document.activeElement); const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; showTab(next.dataset.tab); next.focus(); };
    let savedTab = 'perfiles'; try { savedTab = sessionStorage.getItem('eticket-admin-tab') || 'perfiles'; } catch (_) { /* Optional memory. */ }
    showTab(['perfiles', 'formulario', 'glpi'].includes(savedTab) ? savedTab : 'perfiles');
    usersAdmin(document.getElementById('profiles-section'), nativeUrl('users'));
    function collect() {
      fields = fields.map(f => ({ ...f,
        label: document.getElementById('label-' + f.id).value,
        type: document.getElementById('type-' + f.id).value,
        required: document.getElementById('required-' + f.id).checked,
        options: document.getElementById('options-' + f.id).value.split('\n').map(x => x.trim()).filter(Boolean),
      }));
    }
    function collectBase() {
      base = Object.fromEntries(Object.entries(base).map(([key, value]) => {
        const next = {};
        BASE_TEXT_KEYS.forEach(k => { if (k in value) next[k] = document.getElementById(`base-${key}-${k}`).value.trim(); });
        if (value.list) next.list = document.getElementById(`base-${key}-list`).value.split('\n').map(x => x.trim()).filter(Boolean);
        if (key === 'service') next.options = Object.fromEntries(catalog().map(s => {
          const name = document.getElementById(`base-service-name-${s.id}`).value.trim();
          const hidden = !document.getElementById(`base-service-show-${s.id}`).checked;
          return [s.id, { name: name === (s.default_name || s.name) ? '' : name, hidden }];
        }).filter(([, o]) => o.name || o.hidden));
        if (key === 'service') next.custom = value.custom.map(c => ({ id: c.id, name: document.getElementById(`base-custom-name-${c.id}`).value.trim(), type: Number(document.getElementById(`base-custom-type-${c.id}`).value), hidden: !document.getElementById(`base-custom-show-${c.id}`).checked, ...(c.isNew ? { isNew: true } : {}) }));
        else if (value.options) next.options = Object.fromEntries(Object.keys(value.options).map(level => [level, document.getElementById(`base-${key}-option-${level}`).value.trim()]));
        return [key, next];
      }));
    }
    // Servicios del catálogo (hub.json). Los creados desde aquí vienen marcados con `custom` y se editan aparte.
    const catalog = () => (state.adminServices || []).filter(s => !s.custom);
    function serviceOptionsHtml(options) {
      const list = catalog();
      if (!list.length) return '<p class="muted admin-caption">No se pudieron cargar los servicios del catálogo.</p>';
      return `<fieldset class="base-options"><legend>Opciones de la lista</legend><p class="muted admin-caption base-options-note">Deja el nombre en blanco para usar el original. Las opciones ocultas no aparecen al crear una solicitud.</p>${list.map(s => { const own = options[s.id] || {}; const original = s.default_name || s.name; return `<div class="service-option"><div class="field"><label for="base-service-name-${esc(s.id)}">${esc(s.id)} · <span class="muted">original: ${esc(original)}</span></label><input id="base-service-name-${esc(s.id)}" value="${esc(own.name || original)}" maxlength="120" placeholder="${esc(original)}"></div><label class="check-field"><input type="checkbox" id="base-service-show-${esc(s.id)}" ${own.hidden ? '' : 'checked'}>Visible</label></div>`; }).join('')}${customServicesHtml(base.service.custom)}</fieldset>`;
    }
    function customServicesHtml(custom) {
      const rows = custom.map(c => `<div class="service-option custom-service" data-custom="${esc(c.id)}"><div class="field"><label for="base-custom-name-${esc(c.id)}">${c.isNew ? 'Servicio nuevo <span class="new-tag">sin guardar</span>' : 'Servicio agregado'}</label><input id="base-custom-name-${esc(c.id)}" value="${esc(c.name)}" data-min="2" maxlength="120" placeholder="Ej.: Préstamo de equipos"></div><div class="field custom-type"><label for="base-custom-type-${esc(c.id)}">Tipo</label><select id="base-custom-type-${esc(c.id)}"><option value="2"${c.type === 2 ? ' selected' : ''}>Solicitud</option><option value="1"${c.type === 1 ? ' selected' : ''}>Incidente</option></select></div><label class="check-field"><input type="checkbox" id="base-custom-show-${esc(c.id)}" ${c.hidden ? '' : 'checked'}>Visible</label>${c.isNew ? `<button type="button" class="button subtle small custom-remove" data-remove-service="${esc(c.id)}" aria-label="Quitar servicio nuevo">Quitar</button>` : ''}</div>`).join('');
      return `${rows}<div class="actions custom-add"><button type="button" class="button subtle small" id="add-service">＋ Agregar servicio</button><span class="muted admin-caption">Un servicio ya guardado no se borra, para no perder el historial de sus solicitudes. Si ya no se usa, desmárcalo como visible.</span></div>`;
    }
    function validateBase() {
      for (const el of document.querySelectorAll('#schema-base [data-min]')) {
        if (el.value.trim().length < Number(el.dataset.min)) {
          el.closest('details').open = true; el.focus();
          throw new Error('Completa los textos marcados de los campos base (mínimo ' + el.dataset.min + ' caracteres).');
        }
      }
      for (const key of ['kind', 'problem']) {
        const list = base[key].list;
        if (list.length < 2 || list.length > 20 || new Set(list.map(x => x.toLowerCase())).size !== list.length) { const el = document.getElementById(`base-${key}-list`); el.closest('details').open = true; el.focus(); throw new Error(`“${BASE_FIELDS[key].name}” necesita entre 2 y 20 opciones distintas.`); }
      }
      const names = [...catalog().filter(s => !(base.service.options[s.id] || {}).hidden).map(s => (base.service.options[s.id] || {}).name || s.default_name || s.name), ...base.service.custom.filter(c => !c.hidden).map(c => c.name)].map(n => n.toLowerCase());
      if (new Set(names).size !== names.length) throw new Error('Hay dos servicios visibles con el mismo nombre. Cambia uno para que no se confundan.');
      if (!names.length) throw new Error('Deja al menos un servicio visible en la lista.');
    }
    function renderBase() {
      const open = new Set([...document.querySelectorAll('#schema-base details[open]')].map(d => d.dataset.base));
      const input = (key, k, label, attrs, help) => `<div class="field"><label for="base-${key}-${k}">${label}</label>${k === 'placeholder' && key === 'description' ? `<textarea id="base-${key}-${k}" ${attrs}>${esc(base[key][k])}</textarea>` : `<input id="base-${key}-${k}" value="${esc(base[key][k])}" ${attrs}>`}${help ? `<small>${help}</small>` : ''}</div>`;
      document.getElementById('schema-base').innerHTML = Object.entries(base).map(([key, value]) => `<details class="schema-field base-field" data-base="${key}"${open.has(key) ? ' open' : ''}><summary><span class="base-field-name">${BASE_FIELDS[key].name}</span><span class="base-field-label">${esc(value.label)}</span><span class="base-field-edit">Editar</span></summary><div class="base-field-body"><p class="muted admin-caption">${BASE_FIELDS[key].note}</p>${input(key, 'label', 'Pregunta o nombre del campo', 'data-min="2" maxlength="120"')}${'placeholder' in value ? input(key, 'placeholder', 'Texto de ejemplo dentro del campo', 'maxlength="200"', 'Se ve en gris mientras el campo está vacío. Puede quedar en blanco.') : ''}${input(key, 'hint', 'Texto de ayuda bajo el campo', 'maxlength="200"', 'Puede quedar en blanco.')}${value.list ? `<div class="field"><label for="base-${key}-list">Opciones de la lista, una por línea</label><textarea id="base-${key}-list" maxlength="2500">${esc(value.list.join('\n'))}</textarea><small>Entre 2 y 20 opciones.</small></div>` : ''}${key === 'service' ? serviceOptionsHtml(value.options) : value.options ? `<fieldset class="base-options"><legend>Opciones de impacto, de menor a mayor</legend>${Object.entries(value.options).map(([level, text], i) => `<div class="field"><label for="base-${key}-option-${level}">Nivel ${i + 1}</label><input id="base-${key}-option-${level}" value="${esc(text)}" data-min="2" maxlength="120"></div>`).join('')}</fieldset>` : ''}<div class="actions"><button type="button" class="button subtle small" data-reset-base="${key}">Restablecer textos originales</button></div></div></details>`).join('');
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
      event.preventDefault(); submit(event.currentTarget, async () => { collect(); collectBase(); validateBase(); const toSend = { ...base, service: { ...base.service, custom: base.service.custom.map(({ isNew, ...c }) => c) } }; const saved = await api('save_schema', { revision, fields, base: toSend }); revision = saved.schema.revision; fields = saved.schema.fields; renderFields(); if (saved.schema.base) { base = baseOf(saved.schema); renderBase(); notice('Estructura guardada. Los cambios están disponibles para las nuevas solicitudes.'); } else notice('Se guardaron los campos adicionales, pero el servidor todavía no guarda los cambios de los campos base.', true); }, 'schema-error');
    };
    document.getElementById('schema-base').onclick = event => {
      if (event.target.closest('#add-service')) {
        collectBase(); base.service.custom.push({ id: 'custom_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12), name: '', type: 2, hidden: false, isNew: true }); renderBase();
        document.getElementById('base-custom-name-' + base.service.custom.at(-1).id).focus(); return;
      }
      const remove = event.target.closest('[data-remove-service]');
      if (remove) { collectBase(); base.service.custom = base.service.custom.filter(c => c.id !== remove.dataset.removeService); renderBase(); return; }
      const button = event.target.closest('[data-reset-base]'); if (!button) return;
      const key = button.dataset.resetBase; collectBase();
      const keep = key === 'service' ? base.service.custom : null;
      base[key] = baseOf({ base: {} })[key]; if (keep) base.service.custom = keep; renderBase();
      notice('Se restablecieron los textos de ' + BASE_FIELDS[key].name.toLowerCase() + '. Guarda la estructura para aplicarlos.');
    };
    document.getElementById('schema-base').oninput = event => {
      if (event.target.id && event.target.id.endsWith('-label')) { const summary = event.target.closest('details').querySelector('.base-field-label'); summary.textContent = event.target.value; }
    };
    renderBase();
    renderFields();
  }
  async function tickets(generation) {
    const heading = { cliente: 'Mis solicitudes', agente: 'Solicitudes asignadas', gestor: 'Todas las solicitudes' }[state.user.role] || 'Solicitudes';
    const lead = { agente: 'Los casos asignados a ti o a tu equipo, con su nivel de atención.', gestor: 'Supervisa todos los casos, su nivel y los que necesitan tu intervención.' }[state.user.role] || 'Todo lo que necesitas para seguir cada caso.';
    main.innerHTML = `<div class="page-head"><div><p class="eyebrow">CONVERSACIONES</p><h1>${heading}</h1><p class="lead">${lead}</p></div>${canCreate() ? '<a class="button" href="#/nueva">＋ Crear solicitud</a>' : ''}</div><section class="panel"><form id="filter-form" class="filters" role="search"><label class="visually-hidden" for="search">Buscar por asunto o número</label><input id="search" type="search" placeholder="Buscar por asunto o número…" value="${esc(state.query)}" maxlength="120"><label class="visually-hidden" for="status-filter">Filtrar por estado</label><select id="status-filter"><option value="">Todos los estados</option>${['Recibida', 'En curso', 'Planificada', 'En espera', 'Resuelta', 'Cerrada'].map((s, i) => `<option value="${i + 1}"${state.status === String(i + 1) ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit" class="button subtle">Buscar</button></form><div id="ticket-results" class="loading" aria-live="polite">Cargando solicitudes…</div><div id="pagination"></div></section>`;
    document.getElementById('filter-form').onsubmit = event => { event.preventDefault(); state.query = document.getElementById('search').value.trim(); state.status = document.getElementById('status-filter').value; state.offset = 0; route(); };
    const data = await api('tickets', undefined, { q: state.query, status: state.status, offset: state.offset });
    if (generation !== state.generation) return;
    const results = document.getElementById('ticket-results'); results.className = 'ticket-list'; results.innerHTML = ticketCards(data.tickets);
    document.getElementById('pagination').innerHTML = `<div class="pagination"><button class="button subtle small" id="previous" ${state.offset === 0 ? 'disabled' : ''}>← Anterior</button><span>Página ${state.offset / 20 + 1}</span><button class="button subtle small" id="next" ${!data.has_more ? 'disabled' : ''}>Siguiente →</button></div>`;
    document.getElementById('previous').onclick = () => { state.offset = Math.max(0, state.offset - 20); route(); };
    document.getElementById('next').onclick = () => { state.offset += 20; route(); };
  }
  async function newTicket(generation) {
    if (!canCreate()) { main.innerHTML = state.user.role === 'gestor' ? '<section class="panel"><h1>El gestor no crea solicitudes</h1><p>Supervisas todas las solicitudes y puedes intervenir en cualquiera cuando lo estimes necesario.</p><a class="button" href="#/tickets">Ver todas las solicitudes</a></section>' : '<section class="panel"><h1>Tu perfil es de atención</h1><p>Atiende las solicitudes asignadas desde tu bandeja: responde, cambia su estado, resuélvelas o derívalas.</p><a class="button" href="#/tickets">Ver solicitudes</a></section>'; return; }
    if (!state.services) state.services = (await api('services')).services;
    const schema = (await api('schema')).schema;
    if (generation !== state.generation) return;
    const b = baseOf(schema);
    // El formulario depende del cuadrado elegido en el inicio y no se puede cambiar aquí.
    // En GLPI, "Quiero un servicio" es una solicitud (tipo 2) y "Tengo un problema" es un incidente (tipo 1).
    const intent = INTENTS[state.intent] ? state.intent : 'problema';
    const isService = intent === 'servicio';
    const wantedType = isService ? 2 : 1;
    const services = state.services.filter(s => !(b.service.options[s.id] || {}).hidden && Number(s.type || 2) === wantedType);
    const extra = isService ? { key: 'kind', prefix: 'Tipo de solución' } : { key: 'problem', prefix: 'Qué está fallando' };
    const ef = b[extra.key];
    const listField = `<div class="field"><label for="extra-choice">${esc(ef.label)}</label><select id="extra-choice" required><option value="">Selecciona una opción</option>${ef.list.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>${hintHtml(ef.hint)}</div>`;
    const urgencyField = isService ? '' : `<div class="field"><label for="urgency">${esc(b.urgency.label)}</label><select name="urgency" id="urgency">${Object.entries(b.urgency.options).map(([level, text]) => `<option value="${level}"${level === '3' ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>${hintHtml(b.urgency.hint)}</div>`;
    main.innerHTML = `<a class="breadcrumb" href="#/inicio">← Volver al inicio</a><p class="eyebrow">ESTAMOS PARA AYUDARTE</p><h1>${isService ? 'Pide un servicio' : 'Cuéntanos qué está fallando'}</h1><p class="lead">${isService ? 'Cuéntanos qué necesitas. Recibirás un número para seguir tu solicitud desde aquí.' : 'Describe el problema. Recibirás un número para seguir tu solicitud desde aquí.'}</p><div class="steps"><span><b>1</b> ${isService ? 'Elige el servicio' : 'Elige el tipo de problema'}</span><span><b>2</b> Describe tu solicitud</span><span><b>3</b> Envíala y sigue los avances</span></div><div class="form-layout"><form class="panel" id="create-form"><p class="intent-chip intent-fixed">Elegiste: <strong>${INTENTS[intent]}</strong></p><div class="field"><label for="service">${isService ? esc(b.service.label) : '¿Qué tipo de problema es?'}</label><select name="service" id="service" required>${services.length === 1 ? '' : '<option value="">Selecciona una opción</option>'}${services.map(s => `<option value="${esc(s.id)}">${esc((b.service.options[s.id] || {}).name || s.name)}</option>`).join('')}</select>${hintHtml(isService ? b.service.hint : 'Si alguien podría estar accediendo a datos o cuentas sin permiso, elige el incidente de seguridad.', 'service-hint')}</div>${listField}<div class="field"><label for="title">${esc(b.title.label)}</label><input name="title" id="title" required minlength="4" maxlength="200" placeholder="${esc(b.title.placeholder)}">${hintHtml(b.title.hint)}</div><div class="field"><label for="description">${esc(b.description.label)}</label><textarea name="description" id="description" required minlength="10" maxlength="20000" placeholder="${esc(b.description.placeholder)}"></textarea>${hintHtml(b.description.hint)}</div>${urgencyField}${fileField}<p id="create-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">Enviar solicitud →</button><a class="button subtle" href="#/inicio">Cancelar</a></div></form><aside class="panel form-hints"><span class="choice-icon" aria-hidden="true">?</span><h2>Una buena descripción ayuda</h2><ul>${isService ? '<li>Explica qué necesitas lograr y para cuándo.</li><li>Menciona el proyecto o la unidad relacionada.</li><li>Si tienes un ejemplo o referencia, adjúntalo.</li>' : '<li>Explica desde cuándo ocurre y a quién afecta.</li><li>Cuenta qué estabas haciendo cuando falló.</li><li>Agrega una captura del error, si la tienes.</li>'}<li>No incluyas claves ni información sensible.</li></ul><p>Después de enviar, podrás agregar más información en la conversación.</p></aside></div>`;
    const additional = document.createElement('div'); additional.id = 'additional-fields';
    additional.innerHTML = schema.fields.map(f => `<div class="field"><label for="${f.id}">${esc(f.label)} ${f.required ? '' : '<span class="muted">(opcional)</span>'}</label>${f.type === 'textarea' ? `<textarea id="${f.id}" maxlength="4000" ${f.required ? 'required' : ''}></textarea>` : f.type === 'select' ? `<select id="${f.id}" ${f.required ? 'required' : ''}><option value="">Selecciona una opción</option>${f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>` : `<input id="${f.id}" maxlength="255" ${f.required ? 'required' : ''}>`}</div>`).join('');
    document.getElementById('file').closest('.field').before(additional);
    document.getElementById('service').onchange = event => { document.getElementById('service-hint').textContent = event.target.value === 'F08' ? 'Si el incidente está ocurriendo ahora, informa también al responsable institucional. No compartas evidencia sensible por este medio.' : (isService ? b.service.hint : 'Si alguien podría estar accediendo a datos o cuentas sin permiso, elige el incidente de seguridad.'); };
    document.getElementById('create-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; submit(form, async () => {
      const file = form.elements.file.files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar menos de 10 MB.');
      const payload = new FormData(form);
      // La opción elegida en la segunda lista viaja al inicio de la descripción, para que el equipo la vea.
      const choice = document.getElementById('extra-choice').value;
      payload.set('description', extra.prefix + ': ' + choice + '\n\n' + form.elements.description.value);
      payload.set('intent', intent);
      payload.set(extra.key, choice);
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
  // ---- Niveles de soporte (tiers) ---------------------------------------
  // Numeración del flujo: 4 = atención inicial … 1 = soporte experto.
  // Cada tier tiene un color (clases .tier-4 … .tier-1 en portal.css). El cliente
  // también ve el tier para saber con quién está hablando.
  const TIERS = {
    4: { label: 'Tier IV', name: 'Atención inicial', who: 'La mesa de ayuda recibe tu caso y resuelve lo más común.' },
    3: { label: 'Tier III', name: 'Soporte intermedio', who: 'Un equipo especializado de la unidad que corresponde a tu caso.' },
    2: { label: 'Tier II', name: 'Soporte avanzado', who: 'Especialistas con más experiencia revisan los casos complejos.' },
    1: { label: 'Tier I', name: 'Soporte experto', who: 'El nivel experto atiende los casos más críticos.' },
  };
  const tierLabel = level => (TIERS[level] ? `${TIERS[level].label} · ${TIERS[level].name}` : 'Sin nivel asignado');
  const tierLevel = t => (t && t.tier && TIERS[t.tier.level] ? t.tier.level : 0);
  const chip = (level, extra = '') => (TIERS[level] ? `<span class="tier-chip tier-${level}${extra}" title="${esc(tierLabel(level))}">${TIERS[level].label}</span>` : '');
  function tierGuideHtml() {
    return `<section class="tier-guide" aria-labelledby="tier-guide-title"><div class="tier-guide-head"><h2 id="tier-guide-title">¿Quién atiende tu solicitud?</h2><p>Tu caso avanza por <strong>niveles de atención</strong>, llamados <em>tiers</em>. En cada solicitud verás en qué tier está y quién te responde.</p></div><ol class="tier-guide-steps">${[4, 3, 2, 1].map(level => `<li class="tier-${level}">${chip(level)}<strong>${TIERS[level].name}</strong><small>${TIERS[level].who}</small></li>`).join('')}</ol><p class="tier-guide-note">Si tu caso necesita más especialización, lo derivamos al siguiente tier y te avisamos en la conversación. No tienes que crear otra solicitud.</p></section>`;
  }
  // Cambio de estado separado de la edición: el agente modifica estados sin poder editar asunto ni descripción.
  const OPEN_STATUSES = ['Recibida', 'En curso', 'Planificada', 'En espera'];
  const statusForm = t => (t.permissions.status && t.status <= 4) ? `<form id="status-form" class="status-form"><label for="status-select">Cambiar estado</label><div class="status-row"><select id="status-select" name="status">${OPEN_STATUSES.map((s, i) => `<option value="${i + 1}"${t.status === i + 1 ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit" class="button subtle small">Guardar</button></div><small>Para cerrar el caso, registra una solución.</small><p id="status-error" class="inline-error" role="alert" hidden></p></form>` : '';
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
  const tierChip = t => chip(tierLevel(t));
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
      html += `<section class="panel escalate-panel tier-accent-${next}"><h2>Derivar al siguiente tier</h2><p class="muted">Si el caso supera la capacidad de este nivel, derívalo a ${chip(next)} <strong>${esc(TIERS[next].name)}</strong>. Se conservan el número, el historial y los archivos.</p><form id="escalate-form"><div class="field"><label for="escalate-reason">Motivo</label><textarea id="escalate-reason" name="reason" required minlength="10" maxlength="4000" placeholder="Qué se revisó, qué se intentó y por qué se necesita un nivel más especializado."></textarea><small>Queda registrado con tu nombre y la fecha. El cliente ve el cambio de tier, pero no este motivo.</small></div><p id="escalate-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button dark">Derivar a ${esc(TIERS[next].label)} <span aria-hidden="true">↑</span></button></form></section>`;
    } else if (isStaff() && level === 1 && state.user.role === 'agente') {
      html += `<section class="panel tier-last-note tier-accent-1"><h2>${chip(1)} Último nivel</h2><p class="muted">Tier I no deriva ni bloquea casos. Si tu solución no funciona o el cliente la rechaza, el caso vuelve a ti para que lo intentes de nuevo. El gestor puede intervenir si lo estima necesario.</p></section>`;
    }
    if (p.reassign) {
      html += `<details class="panel intervene-panel"><summary><span><strong>Intervenir como gestor</strong><small>Opcional. Mueve el caso a cualquier tier.</small></span></summary><form id="reassign-form"><div class="field"><label for="reassign-level">Nuevo tier</label><select id="reassign-level" name="level" required><option value="">Selecciona un tier</option>${[4, 3, 2, 1].map(l => `<option value="${l}"${l === level ? ' disabled' : ''}>${esc(tierLabel(l))}${l === level ? ' (actual)' : ''}</option>`).join('')}</select></div><div class="field"><label for="reassign-reason">Motivo</label><textarea id="reassign-reason" name="reason" required minlength="10" maxlength="4000" placeholder="Por qué mueves el caso."></textarea><small>Queda registrado en el historial. También puedes responder o registrar la solución tú mismo desde la conversación.</small></div><p id="reassign-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button dark">Mover caso</button></form></details>`;
    }
    return html;
  }
  function bindEscalation(t) {
    const escalate = document.getElementById('escalate-form');
    if (escalate) escalate.onsubmit = event => { event.preventDefault(); submit(escalate, async () => {
      const body = Object.fromEntries(new FormData(escalate));
      const data = await api('escalate', body, { id: t.id });
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
    state.ticket = t; const p = t.permissions;
    main.innerHTML = `<a class="breadcrumb" href="#/tickets">← Volver a solicitudes</a><div class="page-head detail-head"><div><p class="eyebrow">SOLICITUD #${t.id}</p><h1>${esc(t.title)}</h1><p class="lead">Creada el ${esc(date(t.created_at))}</p></div><div class="actions">${tierChip(t)}${badge(t)}<button id="refresh-ticket" class="button subtle small">Actualizar</button></div></div>${p.approve ? '<section class="approve-box"><h2>El equipo publicó una solución</h2><p>Revisa la respuesta. Puedes confirmar que está resuelto o indicar qué falta.</p><div class="actions"><button id="approve-solution" class="button">Sí, está resuelto</button><button id="reject-solution" class="button subtle">Necesito más ayuda</button></div><form id="reject-form" hidden style="margin-top:20px"><div class="field"><label for="reject-message">Cuéntanos qué falta por resolver</label><textarea id="reject-message" name="message" required minlength="5" maxlength="20000"></textarea></div><button type="submit" class="button">Enviar y reabrir solicitud</button></form></section>' : ''}<div class="detail-grid"><div>${p.edit ? `<section class="panel"><div class="panel-heading"><h2>Asunto y descripción</h2><button id="show-edit" class="button subtle small">Editar</button></div><p id="ticket-description" class="muted edit-hint">La descripción original aparece como primer mensaje de la conversación.</p>${p.edit ? `<form id="edit-form" hidden><div class="field"><label for="edit-title">Asunto</label><input id="edit-title" name="title" value="${esc(t.title)}" minlength="4" maxlength="200" required></div><div class="field"><label for="edit-description">Descripción</label><textarea id="edit-description" name="description" required minlength="10" maxlength="20000">${esc(t.description)}</textarea></div>${t.status <= 4 && !p.status ? `<div class="field"><label for="edit-status">Estado</label><select id="edit-status" name="status">${['Recibida','En curso','Planificada','En espera'].map((s, i) => `<option value="${i+1}" ${t.status === i+1 ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : ''}<p id="edit-error" role="alert" class="inline-error" hidden></p><div class="actions"><button type="submit" class="button">Guardar cambios</button><button id="cancel-edit" type="button" class="button subtle">Cancelar</button></div></form>` : ''}</section>` : ''}<section class="panel"><div class="panel-heading"><h2>Conversación</h2><small>${t.messages.length + 1} ${t.messages.length === 0 ? 'mensaje' : 'mensajes'}</small></div><div class="thread">${[initialMessage(t), ...[...t.messages, ...tierEvents(t)].sort((a, b) => String(a.date).localeCompare(String(b.date)))].map(m => messageHtml(m, t)).join('')}</div>${t.messages.length ? '' : '<p class="muted thread-empty">Tu solicitud fue recibida. Las respuestas del equipo aparecerán aquí.</p>'}${p.reply ? `<form id="reply-form" class="reply-form"><div class="field"><label for="message">Agregar una respuesta</label><textarea id="message" name="message" required maxlength="20000" placeholder="Escribe tu respuesta o agrega información sobre el caso…"></textarea></div>${p.private_reply ? '<label class="check-field"><input type="checkbox" id="private-reply" name="private" value="1"> Nota interna: visible solo para el equipo autorizado</label>' : ''}${fileField}<p id="reply-error" role="alert" class="inline-error" hidden></p><button type="submit" class="button">Enviar respuesta →</button></form>` : `<p class="welcome-note">${t.status === 6 ? 'Esta solicitud está cerrada. Si necesitas ayuda con un caso nuevo, crea otra solicitud.' : 'Tu perfil no permite agregar respuestas en este estado.'}</p>`}</section>${p.solve ? '<section class="panel"><h2>Proponer una solución</h2><p class="muted">La solución quedará visible para el cliente, que podrá revisarla.</p><form id="solve-form"><div class="field"><label for="solution">Qué se resolvió y cómo</label><textarea id="solution" name="message" required minlength="10" maxlength="20000"></textarea></div><p id="solve-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button">Registrar solución</button></form></section>' : ''}</div><aside><section class="panel"><h2>Detalles</h2><dl class="meta-list"><div><dt>Estado</dt><dd>${esc(t.status_label)}</dd></div>${tierRow(t)}<div><dt>Solicitante</dt><dd>${esc(t.requesters.join(', '))}</dd></div><div><dt>Última actividad</dt><dd>${esc(date(t.updated_at))}</dd></div><div><dt>Tipo</dt><dd>${t.type === 1 ? 'Incidente' : 'Solicitud de servicio'}</dd></div></dl>${statusForm(t)}${p.delete ? '<div class="danger-zone"><button id="delete-ticket">Enviar a la papelera</button></div>' : ''}</section>${sidePanels(t)}<section class="panel"><h2>Archivos adjuntos</h2>${t.attachments.length ? `<ul class="attachment-list">${t.attachments.map(a => `<li><a href="api?action=download&amp;id=${t.id}&amp;document=${a.id}" download>↓ ${esc(a.name)}</a></li>`).join('')}</ul>` : '<small>No hay archivos adjuntos.</small>'}</section></aside></div>`;
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
    if (!state.user) {
      const publicRoute = window.location.hash.slice(2);
      // Solo se llega al login o al registro eligiendo uno de los dos cuadrados del inicio.
      const chosen = !!INTENTS[state.intent];
      if (publicRoute === 'verificar') verify();
      else if (chosen && publicRoute === 'registro') register();
      else if (chosen && publicRoute === 'ingresar') login();
      else { if (publicRoute) history.replaceState(null, '', window.location.pathname + window.location.search + '#/'); welcome(); }
      return;
    }
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
    try { await api('logout', {}); state.user = null; state.ticket = null; state.services = null; state.query = ''; state.status = ''; state.offset = 0; state.intent = ''; try { sessionStorage.removeItem('eticket-intent'); } catch (_) { /* Optional memory. */ } const data = await api('session'); state.csrf = data.csrf; notice('Sesión cerrada.'); shell(); history.replaceState(null, '', window.location.pathname + window.location.search + '#/'); welcome(); }
    catch (error) { notice(error.message, true); }
    finally { event.target.disabled = false; }
  };
  let origin = new URLSearchParams(window.location.search).get('origen');
  try { if (origin === 'A' || origin === 'B') sessionStorage.setItem('eticket-origin', origin); origin = sessionStorage.getItem('eticket-origin'); } catch (_) { /* Optional memory. */ }
  if (origin === 'A' || origin === 'B') { const link = document.getElementById('origin-link'); link.href = ((window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081') + '/plugins/etickethub/front/return.php?origen=' + origin; link.hidden = false; }
  window.addEventListener('hashchange', () => { notice(state.flash); state.flash = ''; route(); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo(0,0); });
  api('session').then(data => { state.user = data.user; state.csrf = data.csrf; return route(); }).catch(error => { notice(error.message, true); main.innerHTML = '<section class="panel empty"><h1>Estamos preparando tu espacio</h1><p>La conexión con soporte no está disponible. Intenta recargar en unos momentos.</p><button id="reload" class="button">Recargar</button></section>'; document.getElementById('reload').onclick = () => window.location.reload(); });
})();