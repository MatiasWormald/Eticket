const main = document.getElementById('main');
const state = {
  user: null,
  csrf: '',
  mfa: null,
  generation: 0,
  intent: '',
  prefillUser: '',
  flash: '',
  query: '',
  status: '',
  offset: 0,
};
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
function skeleton(label, type = "page") {
  const lines = '<span></span><span></span><span></span>';
  return `<div class="skeleton skeleton-${type}" role="status"><span class="visually-hidden">${label}</span><div aria-hidden="true">${type === "page" ? '<div class="skeleton-heading"><span></span><span></span></div>' : ""}<div class="skeleton-block">${lines}</div><div class="skeleton-block">${lines}</div></div></div>`;
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
  if (response.status === 429 && action !== 'reauth_users') throw new Error(action === 'login' ? 'Has intentado ingresar varias veces. Espera un minuto antes de volver a intentar.' : 'Hiciste varios intentos seguidos. Espera un minuto antes de volver a intentar.');
  if (response.status === 413) throw new Error('El archivo supera el tamaño permitido. Adjunta uno de hasta 10 MB.');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && [502, 503, 504].includes(response.status)) throw new Error('El servicio de soporte no está disponible por el momento. Intenta nuevamente en unos instantes.');
  if (!contentType.includes('application/json')) throw new Error(action === 'login' ? 'No pudimos completar el acceso. Si tu cuenta utiliza doble factor, ingresa primero desde el acceso institucional de GLPI.' : 'El servicio devolvió una respuesta inesperada. Intenta nuevamente.');
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !PUBLIC_ACTIONS.includes(action)) { state.user = null; requestRoute(); }
    const error = new Error(data.error || 'No pudimos completar la operación.');
    error.status = response.status;
    throw error;
  }
  return data;
}
// El gestor supervisa e interviene, pero no crea solicitudes.
const canCreate = () => !!state.user && !!state.user.can_create && state.user.role !== 'gestor';
function shell() {
  const logged = !!state.user;
  document.getElementById('sidebar').hidden = !logged;
  document.getElementById('logout').hidden = !logged;
  document.getElementById('profile-link').hidden = !logged;
  if (!logged) return;
  const u = state.user;
  document.getElementById('account-name').textContent = u.name;
  document.getElementById('account-avatar').textContent = u.name.trim().slice(0, 2).toUpperCase();
  document.getElementById('account-role').textContent = { cliente: 'Cliente', agente: 'Agente de atención', gestor: u.can_admin ? 'Gestor administrador' : 'Gestor de tickets' }[u.role];
  document.getElementById('new-nav').hidden = !canCreate();
  document.getElementById('admin-nav').hidden = !u.can_admin;
  document.getElementById('tickets-nav-label').textContent = u.role === 'cliente' ? 'Mis solicitudes' : 'Solicitudes';
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

function requestRoute() {
  window.dispatchEvent(new Event('eticket:route'));
}

async function endSession(message) {
  Object.assign(state, { user: null, mfa: null, query: '', status: '', offset: 0, intent: '' });
  try { sessionStorage.removeItem('eticket-intent'); } catch (_) { /* Optional memory. */ }
  history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
  requestRoute();
  notice(message);
  state.csrf = (await api('session')).csrf;
}

export { main, state, INTENTS, esc, date, badge, fileField, notice, skeleton, api, canCreate, shell, submit, requestRoute, endSession };
