import { main, state, INTENTS, esc, notice, api, shell, submit, requestRoute } from './core.js';

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
        state.csrf = data.csrf || state.csrf; state.mfa = data.mfa; state.prefillUser = '';
        if (window.location.hash === '#/verificar') requestRoute(); else window.location.hash = '#/verificar';
        return;
      }
      state.user = data.user; state.csrf = data.csrf; state.prefillUser = '';
      if (!state.user) throw new Error('La cuenta no tiene un perfil de soporte activo.');
      document.getElementById('password').value = ''; notice(''); shell();
      if (window.location.hash === '#/inicio') requestRoute(); else window.location.hash = '#/inicio';
    }, 'login-error');
  };
}
function register() {
  main.innerHTML = `<section class="login-grid">${storyHtml('Crea tu cuenta y empieza hoy', 'Regístrate una sola vez para enviar solicitudes y seguir cada conversación con el equipo.')}<form id="register-form" class="login-form"><h2>Crea tu cuenta</h2><p>Completa tus datos para crear una cuenta de cliente en Eticket. En tu primer ingreso te enviaremos un código al correo.</p><div class="field"><label for="reg-name">Nombre completo</label><input id="reg-name" name="name" autocomplete="name" required minlength="3" maxlength="120" placeholder="Ej.: Camila Rojas"></div><div class="field"><label for="reg-email">Correo electrónico</label><input id="reg-email" name="email" type="email" autocomplete="email" required maxlength="255" placeholder="nombre@gmail.com"><small>Usa este correo para iniciar sesión.</small></div><div class="field"><label for="reg-password">Contraseña</label><div class="password-row"><input id="reg-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" aria-describedby="reg-password-hint"><button type="button" class="button subtle small" id="show-reg-password" aria-label="Mostrar contraseñas" aria-pressed="false">Mostrar</button></div><small id="reg-password-hint">Mínimo 8 caracteres. Combina letras y números, y no la uses en otros sitios.</small></div><div class="field"><label for="reg-password2">Repite la contraseña</label><input id="reg-password2" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></div><label class="check-field consent"><input type="checkbox" id="reg-consent" required><span>Acepto la <button type="button" class="link-button" data-open-privacy data-privacy-accept>política de privacidad</button> y el uso de mis datos para gestionar mis solicitudes.</span></label><p class="inline-error" id="register-error" role="alert" hidden></p><button type="submit" class="button">Crear cuenta <span aria-hidden="true">→</span></button><p class="login-switch">¿Ya tienes cuenta? <a href="#/ingresar">Inicia sesión</a></p></form></section>`;
  bindPasswordToggle('show-reg-password', ['reg-password', 'reg-password2']);
  document.getElementById('register-form').onsubmit = event => {
    event.preventDefault();
    submit(event.currentTarget, async () => {
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim().toLowerCase();
      const password = document.getElementById('reg-password').value;
      if (password !== document.getElementById('reg-password2').value) throw new Error('Las contraseñas no coinciden.');
      const data = await api('register', { name, email, password, consent: document.getElementById('reg-consent').checked });
      document.getElementById('reg-password').value = ''; document.getElementById('reg-password2').value = '';
      state.prefillUser = email;
      state.csrf = data.csrf;
      state.mfa = data.mfa;
      window.location.hash = '#/verificar';
    }, 'register-error');
  };
}
function verify() {
  const { setup, secret, account, method, destination, retry_in: retryIn } = state.mfa;
  if (method === 'email') {
    main.innerHTML = `<section class="login-grid">${storyHtml('Protege tu cuenta', 'Confirma tu acceso con el código que enviamos a tu correo.')}<form id="verify-form" class="login-form"><h2>Verifica tu correo</h2><p>Enviamos un código de 6 dígitos a <strong>${esc(destination)}</strong>. Vence en 5 minutos.</p><div class="field"><label for="verify-code">Código de verificación</label><input id="verify-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><p id="verify-error" class="inline-error" role="alert" hidden></p><button class="button" type="submit">Verificar y acceder</button><small>Eticket recordará esta verificación durante 24 horas en este navegador.</small><button id="resend-code" class="button subtle" type="button">Reenviar código</button><p><a href="#/ingresar">Volver a ingresar datos</a></p></form></section>`;
    const resend = document.getElementById('resend-code');
    const available = Date.now() + retryIn * 1000;
    function updateResend() {
      if (!resend.isConnected) return;
      const remaining = Math.ceil((available - Date.now()) / 1000);
      resend.disabled = remaining > 0;
      resend.textContent = remaining > 0 ? `Reenviar en ${remaining} s` : 'Reenviar código';
      if (remaining > 0) setTimeout(updateResend, 1000);
    }
    updateResend();
    resend.onclick = async () => {
      resend.disabled = true;
      try {
        const { mfa } = await api('resend_code', {});
        if (!resend.isConnected) return;
        state.mfa = mfa;
        verify();
        notice('Enviamos un código nuevo.');
      } catch (error) {
        notice(error.message, true);
        resend.disabled = false;
      }
    };
    bindVerify();
    return;
  }
  const heading = setup ? 'Configura la verificación en dos pasos' : 'Verificación en dos pasos';
  main.innerHTML = `<section class="login-grid">${storyHtml('Protege tu cuenta', 'Usa tu aplicación de autenticación para verificar el acceso a Eticket.')}<form id="verify-form" class="login-form"><h2>${heading}</h2>${setup ? `<p>En tu aplicación de autenticación, añade una cuenta basada en tiempo con el nombre <strong>${esc(account)}</strong> e introduce esta clave:</p><div class="field"><label for="mfa-secret">Clave de configuración</label><input id="mfa-secret" value="${esc(secret)}" readonly spellcheck="false" autocomplete="off"></div>` : '<p>Ingresa el código de tu aplicación o uno de tus códigos de recuperación.</p>'}<div class="field"><label for="verify-code">Código de verificación</label><input id="verify-code" name="code" autocomplete="one-time-code" ${setup ? 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6"' : 'maxlength="64"'} minlength="6" required></div><p class="inline-error" id="verify-error" role="alert" hidden></p><button type="submit" class="button">Verificar y acceder</button><small>Eticket recordará esta verificación durante 24 horas en este navegador.</small><p><a href="#/ingresar">Volver a ingresar datos</a></p></form></section>`;
  bindVerify();
}
function bindVerify() {
  const code = document.getElementById('verify-code');
  code.focus();
  document.getElementById('verify-form').onsubmit = event => {
    event.preventDefault();
    submit(event.currentTarget, async () => {
      const data = await api('verify_login', { code: code.value.trim() });
      if (!data.user) throw new Error('No pudimos iniciar tu sesión. Vuelve a ingresar tus datos.');
      state.user = data.user;
      state.csrf = data.csrf;
      state.mfa = null;
      if (!data.backup_codes?.length) { window.location.hash = '#/inicio'; return; }
      shell();
      main.innerHTML = `<section class="panel"><h1>Códigos de recuperación</h1><p>Guarda estos códigos en un lugar seguro. Cada uno se puede usar una vez si pierdes acceso a tu autenticador.</p><ul>${data.backup_codes.map(code => `<li><code>${esc(code)}</code></li>`).join('')}</ul><a class="button" href="#/inicio">Continuar a mi espacio</a></section>`;
      main.focus();
    }, 'verify-error');
  };
}

export { welcome, login, register, verify };
