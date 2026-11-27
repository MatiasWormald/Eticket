import { api, canCreate, endSession, esc, INTENTS, main, notice, shell, skeleton, state } from './portal/core.js';
import { login, register, verify, welcome } from './portal/auth.js';
import { administration } from './portal/admin.js';
import { myProfile } from './portal/profile.js';
import { newTicket } from './portal/ticket-create.js';
import { detail } from './portal/ticket-detail.js';
import { dashboard, tickets } from './portal/ticket-list.js';

async function route() {
  const generation = ++state.generation;
  shell();
  if (!state.user) {
    const publicRoute = window.location.hash.slice(2);
    // Solo se llega al login o al registro eligiendo uno de los dos cuadrados del inicio.
    const chosen = !!INTENTS[state.intent];
    if (publicRoute === 'verificar' && state.mfa) verify();
    else if (chosen && publicRoute === 'registro') register();
    else if (chosen && publicRoute === 'ingresar') login();
    else {
      if (publicRoute) history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
      welcome();
    }
    return;
  }
  const routeName = window.location.hash.slice(2) || (window.location.pathname.includes('crear-consulta') ? 'nueva' : window.location.pathname.includes('panel-atencion') ? 'tickets' : 'inicio');
  const selectedIntent = /^nueva\/(servicio|problema)$/.exec(routeName);
  if (selectedIntent && canCreate()) {
    state.intent = selectedIntent[1];
    try { sessionStorage.setItem('eticket-intent', state.intent); } catch (_) { /* Optional memory. */ }
  }
  const activeNav = routeName.startsWith('ticket/') ? 'tickets' : selectedIntent ? 'nueva' : routeName;
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === activeNav;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  main.innerHTML = skeleton("Cargando la página");
  try {
    if (routeName === 'nueva' || selectedIntent) await newTicket(generation);
    else if (routeName === 'administracion') await administration(generation);
    else if (routeName === 'perfil') await myProfile(generation);
    else if (routeName === 'tickets') await tickets(generation);
    else if (/^ticket\/\d+$/.test(routeName)) await detail(Number(routeName.split('/')[1]), generation);
    else await dashboard(generation);
  } catch (error) {
    if (generation !== state.generation || !state.user) return;
    main.innerHTML = `<section class="panel empty"><h1>No pudimos abrir esta página</h1><p>${esc(error.message)}</p><div class="actions actions-center"><button id="retry" class="button">Intentar nuevamente</button><a class="button subtle" href="#/inicio">Volver al inicio</a></div></section>`;
    document.getElementById('retry').onclick = () => route();
  }
}

window.addEventListener('eticket:route', route);
document.getElementById('logout').onclick = async event => {
  event.currentTarget.disabled = true;
  try { await api('logout', {}); await endSession('Sesión cerrada.'); }
  catch (error) { notice(error.message, true); }
  finally { event.target.disabled = false; }
};

function configureOriginLink() {
  let origin = new URLSearchParams(window.location.search).get('origen');
  try {
    if (origin === 'A' || origin === 'B') sessionStorage.setItem('eticket-origin', origin);
    origin = sessionStorage.getItem('eticket-origin');
  } catch (_) { /* Optional memory. */ }
  if (origin !== 'A' && origin !== 'B') return;
  const link = document.getElementById('origin-link');
  const glpi = window.ETICKET_CONFIG?.glpiUrl || 'http://localhost:8081';
  link.href = glpi + '/plugins/etickethub/front/return.php?origen=' + origin;
  link.hidden = false;
}

window.addEventListener('hashchange', () => {
  notice(state.flash);
  state.flash = '';
  route();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

async function start() {
  configureOriginLink();
  try {
    const { user, csrf, mfa } = await api('session');
    Object.assign(state, { user, csrf, mfa });
    if (user) document.documentElement.dataset.eticketSession = 'known';
    else document.documentElement.removeAttribute('data-eticket-session');
    try {
      if (user) sessionStorage.setItem('eticket-known-session', '1');
      else sessionStorage.removeItem('eticket-known-session');
    } catch (_) {}
    await route();
  } catch (error) {
    notice(error.message, true);
    main.innerHTML = '<section class="panel empty"><h1>Estamos preparando tu espacio</h1><p>La conexión con soporte no está disponible. Intenta recargar en unos momentos.</p><button id="reload" class="button">Recargar</button></section>';
    document.getElementById('reload').onclick = () => window.location.reload();
  }
}

start();
