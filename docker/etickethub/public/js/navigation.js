(function () {
  'use strict';
  function mount() {
    if (document.getElementById('eticket-navigation')) return;
    // Never accept a return URL supplied by the browser. Only A/B identifiers.
    var params = new URLSearchParams(window.location.search);
    var incoming = params.get('origen');
    // GLPI carries the destination through its sign-in screen in "redirect".
    if (!incoming && params.get('redirect')) {
      try { incoming = new URL(params.get('redirect'), window.location.origin).searchParams.get('origen'); }
      catch (_) { /* Un destino inválido no aporta un origen. */ }
    }
    var origin = '';
    try {
      if (incoming === 'A' || incoming === 'B') sessionStorage.setItem('eticket-origin', incoming);
      origin = sessionStorage.getItem('eticket-origin') || '';
    } catch (_) { origin = incoming || ''; }
    var script = document.querySelector('script[src*="/etickethub/js/navigation.js"]');
    if (!script) return;
    var pluginBase = new URL('../', script.src);
    var root = new URL('../../', pluginBase);
    var nav = document.createElement('nav');
    nav.id = 'eticket-navigation';
    nav.setAttribute('aria-label', 'Navegación eTicket');
    var brand = document.createElement('a');
    brand.href = new URL('Helpdesk', root).href;
    brand.className = 'eticket-brand';
    brand.textContent = 'eTicket · Tech Hub';
    nav.appendChild(brand);
    var links = [
      ['Crear una solicitud', new URL('ServiceCatalog', root).href],
      ['Mis solicitudes', new URL('front/ticket.php?reset=reset', root).href],
      ['Volver a eTicket', new URL('front/return.php', pluginBase).href],
    ];
    if (origin === 'A' || origin === 'B') {
      links.push(['Volver al sitio de origen', new URL('front/return.php?origen=' + origin, pluginBase).href]);
    }
    links.forEach(function (entry) {
      var a = document.createElement('a');
      a.textContent = entry[0]; a.href = entry[1]; nav.appendChild(a);
    });
    document.body.prepend(nav);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
