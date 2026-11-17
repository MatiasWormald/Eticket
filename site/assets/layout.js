/* Pie de página y política de privacidad, compartidos por index.html y guia.html.
   Los nombres del equipo y el correo de contacto se pueden editar en config.js. :) */
(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const config = window.ETICKET_CONFIG || {};

  // ---- Pie de página --------------------------------------------------------
  const footer = document.getElementById('site-footer');
  if (footer) {
    const team = Array.isArray(config.team) ? config.team.filter(m => m && m.name) : [];
    // Solo se aceptan enlaces http(s) para que un valor mal escrito no ejecute código.
    const safeUrl = url => (typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : '');
    const member = m => { const url = safeUrl(m.url); return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(m.name)}<span class="visually-hidden"> (se abre en otra pestaña)</span></a>` : `<span>${esc(m.name)}</span>`}</li>`; };
    const image = config.footerImage || 'assets/logo-techhub-uls.png';
    const imageAlt = config.footerImageAlt || 'Tech Hub ULS';
    footer.innerHTML = `<div class="footer-inner"><div class="footer-brand"><img src="${esc(image)}" alt="${esc(imageAlt)}"><p><strong>Eticket</strong> es el centro de ayuda del Tech Hub de la Universidad de La Serena. Un solo lugar para pedir ayuda y seguir tus solicitudes.</p></div><div class="footer-col"><h2>Equipo de desarrollo</h2><ul class="footer-team">${team.length ? team.map(member).join('') : '<li><span>Equipo Tech Hub ULS</span></li>'}</ul></div><div class="footer-col"><h2>Ayuda</h2><ul><li><a href="guia.html">Guía de ayuda</a></li><li><button type="button" class="link-button" data-open-privacy>Política de privacidad</button></li>${config.contactEmail ? `<li><a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a></li>` : ''}</ul></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Tech Hub ULS · Universidad de La Serena</span><span>Eticket · Conectamos preguntas con soluciones.</span></div>`;
  }

  // ---- Política de privacidad (modal) ---------------------------------------
  const dialog = document.createElement('dialog');
  dialog.id = 'privacy-dialog'; dialog.className = 'privacy-dialog'; dialog.setAttribute('aria-labelledby', 'privacy-title');
  dialog.innerHTML = `<div class="privacy-head"><h2 id="privacy-title">Política de privacidad</h2><button type="button" class="privacy-close" data-close-privacy aria-label="Cerrar">×</button></div>
    <div class="privacy-body" tabindex="0">
      <p class="muted">Última actualización: noviembre de 2026</p>
      <p>En Eticket, el centro de ayuda del Tech Hub de la Universidad de La Serena, cuidamos los datos que nos entregas. Aquí te explicamos qué datos usamos y para qué.</p>
      <h3>1. Qué datos recogemos</h3>
      <ul><li>Tu nombre y tu correo electrónico, al crear tu cuenta.</li><li>Tu contraseña, que se guarda cifrada. Nadie del equipo puede verla.</li><li>Lo que escribes en tus solicitudes y los archivos que adjuntas.</li><li>Registros técnicos básicos, como la fecha y hora de tus inicios de sesión.</li></ul>
      <h3>2. Para qué los usamos</h3>
      <ul><li>Atender tus solicitudes y avisarte de sus avances.</li><li>Confirmar que eres tú con un código que enviamos a tu correo al iniciar sesión.</li><li>Mejorar el servicio con estadísticas generales que no te identifican.</li></ul>
      <h3>3. Quién puede verlos</h3>
      <p>Solo el equipo de soporte que atiende tu caso, según el nivel de atención (tier) en que esté. No vendemos ni cedemos tus datos a terceros, salvo que la ley lo exija.</p>
      <h3>4. Cuánto tiempo los guardamos</h3>
      <p>Mientras tu cuenta esté activa y durante el plazo que la universidad defina para conservar el historial de atención.</p>
      <h3>5. Tus derechos</h3>
      <p>Puedes pedir ver, corregir o eliminar tus datos, u oponerte a su uso, conforme a la Ley N.º 19.628 sobre protección de la vida privada y la normativa vigente. Para hacerlo, crea una solicitud en este portal o escribe al contacto indicado en el pie de página.</p>
      <h3>6. Cómo te cuidas tú</h3>
      <p>No compartas tu contraseña ni tu código de verificación, y no adjuntes claves ni información sensible en tus solicitudes.</p>
    </div>
    <div class="actions privacy-actions"><button type="button" class="button subtle" data-close-privacy>Cerrar</button><button type="button" class="button" id="privacy-accept" hidden>Acepto la política</button></div>`;
  document.body.appendChild(dialog);
  let opener = null;
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-open-privacy]');
    if (trigger) {
      // Desde el registro, "Acepto la política" marca la casilla de consentimiento.
      event.preventDefault(); opener = trigger;
      document.getElementById('privacy-accept').hidden = !trigger.hasAttribute('data-privacy-accept');
      dialog.showModal(); dialog.querySelector('.privacy-body').scrollTop = 0;
      return;
    }
    if (event.target.closest('[data-close-privacy]') || event.target === dialog) dialog.close();
  });
  document.getElementById('privacy-accept').onclick = () => { const box = document.getElementById('reg-consent'); if (box) box.checked = true; dialog.close(); };
  dialog.addEventListener('close', () => { if (opener && document.contains(opener)) opener.focus(); opener = null; });
})();
