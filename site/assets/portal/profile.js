import { api, endSession, esc, main, notice, shell, state, submit } from './core.js';
import { chip } from './tiers.js';

const USER_ROLES = { cliente: 'Cliente', agente: 'Agente', gestor: 'Gestor' };
async function myProfile(generation) {
  const { profile } = await api('profile');
  if (generation !== state.generation) return;
  const glpi = (window.ETICKET_CONFIG || {}).glpiUrl || 'http://localhost:8081';
  main.innerHTML = `<h1>Mi perfil</h1><section class="panel"><form id="own-profile"><dl class="meta-list"><div><dt>Usuario</dt><dd>${esc(profile.login)}</dd></div><div><dt>Tipo de cuenta</dt><dd>${USER_ROLES[profile.role]}</dd></div>${profile.tier ? `<div><dt>Tier</dt><dd>${chip(profile.tier)}</dd></div>` : ''}</dl><div class="field"><label for="profile-name">Nombre completo</label><input id="profile-name" name="name" autocomplete="name" required minlength="3" maxlength="120" value="${esc(profile.name)}"></div><div class="field"><label for="profile-email">Correo electrónico</label><input id="profile-email" name="email" autocomplete="email" type="email" maxlength="255" value="${esc(profile.email)}"></div><div class="field"><label for="profile-password">${profile.mfa_enabled ? "Código de tu autenticador" : "Contraseña actual"}</label><input id="profile-password" name="password" ${profile.mfa_enabled ? 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"' : 'type="password" autocomplete="current-password" maxlength="4096"'} required></div><p id="profile-error" class="inline-error" role="alert" hidden></p><button type="submit" class="button">Guardar perfil</button></form></section><section class="panel"><h2>Verificación en dos pasos</h2><p>${profile.email ? "Eticket envía el código a tu correo al iniciar sesión." : "Agrega un correo para recibir los códigos de Eticket."}</p><a class="button subtle" href="${esc(glpi)}/front/preference.php" target="_blank" rel="noopener">Preferencias de GLPI</a></section>${profile.can_delete ? '<section class="panel"><h2>Eliminar mi cuenta</h2><p>Tu cuenta se eliminará de GLPI de forma permanente.</p><button id="delete-own" type="button" class="button danger">Eliminar mi cuenta</button><p id="delete-profile-error" class="inline-error" role="alert" hidden></p></section>' : ''}`;
  const form = document.getElementById('own-profile');
  form.onsubmit = event => {
    event.preventDefault();
    submit(form, async () => {
      const body = Object.fromEntries(new FormData(form));
      form.elements.password.value = '';
      const { profile: saved } = await api('save_profile', body);
      if (generation !== state.generation) return;
      state.user.name = saved.name;
      form.elements.name.value = saved.name;
      form.elements.email.value = saved.email;
      shell();
      notice('Perfil actualizado.');
    }, 'profile-error');
  };
  const remove = document.getElementById('delete-own');
  if (remove) remove.onclick = async () => {
    const password = form.elements.password.value;
    if (!password) { form.elements.password.reportValidity(); return; }
    if (!window.confirm('¿Eliminar tu cuenta de Eticket? Se cerrará tu sesión.')) return;
    form.elements.password.value = '';
    remove.disabled = true;
    try { await api('delete_profile', { password, confirm: true }); await endSession('Cuenta eliminada.'); }
    catch (error) {
      const feedback = document.getElementById('delete-profile-error');
      if (feedback) { feedback.textContent = error.message; feedback.hidden = false; }
    } finally { remove.disabled = false; }
  };
}

export { myProfile, USER_ROLES };
