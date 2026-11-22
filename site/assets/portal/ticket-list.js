import { api, badge, canCreate, date, esc, main, skeleton, state } from './core.js';
import { tierChip, tierGuideHtml } from './tiers.js';

function ticketCards(tickets) {
  if (!tickets.length) return `<div class="empty"><span class="choice-icon" aria-hidden="true">▤</span><h2>No hay solicitudes para mostrar</h2><p>Cuando envíes una solicitud, podrás seguir sus avances aquí. Si estás buscando una, revisa los filtros.</p>${canCreate() ? '<a class="button subtle" href="#/nueva">Crear una solicitud</a>' : ''}</div>`;
  return tickets.map(t => `<a class="ticket-card" href="#/ticket/${t.id}"><span class="ticket-number">#${t.id}</span><div><strong>${esc(t.title)}</strong><small>Última actividad: ${esc(date(t.updated_at))}</small></div>${tierChip(t) ? `<span class="ticket-badges">${tierChip(t)}${badge(t)}</span>` : badge(t)}</a>`).join('');
}
async function dashboard(generation) {
  const staff = state.user.role !== 'cliente';
  main.innerHTML = `<p class="eyebrow">${staff ? 'MESA DE AYUDA' : 'TU ESPACIO DE SOPORTE'}</p><h1>Hola, ${esc(state.user.name.split(' ')[0])}<span class="brand-dot">.</span></h1><p class="lead">${staff ? 'Las conversaciones y solicitudes de tu equipo, en un solo lugar.' : '¿En qué podemos ayudarte hoy? Crea una solicitud o retoma una conversación con nuestro equipo.'}</p>${staff ? `<div class="role-info">${state.user.role === 'gestor' ? 'Perfil gestor: supervisas todas las solicitudes y puedes intervenir en cualquier caso cuando lo estimes necesario. Administras las cuentas, los tiers y el formulario desde Administración.' : 'Perfil agente: atiendes las solicitudes asignadas a ti o a tu equipo. Puedes responder, cambiar el estado, registrar la solución o escalar el caso al siguiente nivel.'}</div>` : ''}${staff ? '' : tierGuideHtml()}<div class="choice-grid">${canCreate() ? `<a class="choice" href="#/nueva"><span class="choice-icon" aria-hidden="true">${state.intent === 'servicio' ? '＋' : '!'}</span><h2>${state.intent === 'servicio' ? 'Pedir un servicio' : 'Reportar un problema'}</h2><p>${state.intent === 'servicio' ? 'Cuéntanos qué necesitas. Te guiaremos para enviarlo al equipo correcto.' : 'Cuéntanos qué está fallando. Te guiaremos para enviarlo al equipo correcto.'}</p><span>Comenzar solicitud →</span></a>` : ''}<a class="choice" href="#/tickets"><span class="choice-icon" aria-hidden="true">▤</span><h2>${state.user.role === 'agente' ? 'Solicitudes asignadas' : staff ? 'Todas las solicitudes' : 'Mis solicitudes'}</h2><p>Revisa avances, responde al equipo y consulta las soluciones.</p><span>Ver conversaciones →</span></a></div><section class="panel"><div class="panel-heading"><h2>Solicitudes recientes</h2><a href="#/tickets">Ver todas →</a></div><div id="recent-tickets">${skeleton("Cargando solicitudes", "list")}</div></section><p class="welcome-note">No necesitas crear otra solicitud para agregar información. Abre la conversación existente y escribe tu respuesta.</p>`;
  const data = await api('tickets');
  if (generation !== state.generation) return;
  const el = document.getElementById('recent-tickets'); el.className = 'ticket-list'; el.innerHTML = ticketCards(data.tickets.slice(0, 5));
  if (state.user.can_admin) {
    const adminChoice = document.createElement('a'); adminChoice.className = 'choice'; adminChoice.href = '#/administracion';
    adminChoice.innerHTML = '<span class="choice-icon" aria-hidden="true">⚙</span><h2>Administrar Eticket</h2><p>Crea las cuentas de tu equipo con su tier, personaliza el formulario de solicitudes y accede a GLPI.</p><span>Abrir administración →</span>';
    document.querySelector('.choice-grid').appendChild(adminChoice);
  }
}

async function tickets(generation) {
  const heading = { cliente: 'Mis solicitudes', agente: 'Solicitudes asignadas', gestor: 'Todas las solicitudes' }[state.user.role] || 'Solicitudes';
  const lead = { agente: 'Los casos asignados a ti o a tu equipo, con su nivel de atención.', gestor: 'Supervisa todos los casos, su nivel y los que necesitan tu intervención.' }[state.user.role] || 'Todo lo que necesitas para seguir cada caso.';
  main.innerHTML = `<div class="page-head"><div><p class="eyebrow">CONVERSACIONES</p><h1>${heading}</h1><p class="lead">${lead}</p></div>${canCreate() ? '<a class="button" href="#/nueva">＋ Crear solicitud</a>' : ''}</div><section class="panel"><form id="filter-form" class="filters" role="search"><label class="visually-hidden" for="search">Buscar por asunto o número</label><input id="search" type="search" placeholder="Buscar por asunto o número…" value="${esc(state.query)}" maxlength="120"><label class="visually-hidden" for="status-filter">Filtrar por estado</label><select id="status-filter"><option value="">Todos los estados</option>${['Recibida', 'En curso', 'Planificada', 'En espera', 'Resuelta', 'Cerrada'].map((s, i) => `<option value="${i + 1}"${state.status === String(i + 1) ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit" class="button subtle">Buscar</button><button id="clear-filters" type="button" class="button subtle">Limpiar filtros</button></form><div id="ticket-results"></div><div id="pagination"></div></section>`;
  const form = document.getElementById('filter-form');
  const search = document.getElementById('search');
  const status = document.getElementById('status-filter');
  const clear = document.getElementById('clear-filters');
  const results = document.getElementById('ticket-results');
  const pagination = document.getElementById('pagination');
  let request = 0;

  async function loadResults() {
    const current = ++request;
    const { query, status, offset } = state;
    clear.disabled = !query && !status && !search.value;
    results.innerHTML = skeleton('Cargando solicitudes', 'list');
    pagination.replaceChildren();
    try {
      const data = await api('tickets', undefined, { q: query, status, offset });
      if (generation !== state.generation || current !== request) return;
      const filtered = query || status;
      results.innerHTML = `<p class="visually-hidden" role="status">${data.tickets.length} solicitudes en esta p?gina.</p><div class="ticket-list">${filtered && !data.tickets.length ? '<div class="empty"><h2>No hay coincidencias</h2><p>Cambia los filtros o l?mpialos para ver todas las solicitudes.</p></div>' : ticketCards(data.tickets)}</div>`;
      if (!offset && !data.has_more) return;
      pagination.innerHTML = `<div class="pagination"><button class="button subtle small" id="previous" ${offset === 0 ? 'disabled' : ''}>← Anterior</button><span>Página ${offset / 20 + 1}</span><button class="button subtle small" id="next" ${!data.has_more ? 'disabled' : ''}>Siguiente →</button></div>`;
      pagination.querySelector('#previous').onclick = () => { state.offset = offset - 20; loadResults(); };
      pagination.querySelector('#next').onclick = () => { state.offset = offset + 20; loadResults(); };
    } catch (error) {
      if (generation !== state.generation || current !== request) return;
      results.innerHTML = `<div class="empty"><p role="alert">${esc(error.message)}</p><button type="button" class="button subtle">Reintentar</button></div>`;
      results.querySelector('button').onclick = loadResults;
    }
  }

  function applyFilters() {
    state.query = search.value.trim();
    state.status = status.value;
    state.offset = 0;
    loadResults();
  }
  form.onsubmit = event => { event.preventDefault(); applyFilters(); };
  search.oninput = () => {
    clear.disabled = !search.value && !state.query && !status.value;
    if (!search.value && state.query) applyFilters();
  };
  status.onchange = applyFilters;
  clear.onclick = () => { search.value = ''; status.value = ''; applyFilters(); search.focus(); };
  await loadResults();
}

export { dashboard, tickets };
