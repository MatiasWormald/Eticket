import { api, canCreate, esc, fileField, INTENTS, main, state, submit } from './core.js';
import { baseOf } from './form-schema.js';

const hintHtml = (text, id) => text ? `<small${id ? ` id="${id}"` : ''}>${esc(text)}</small>` : (id ? `<small id="${id}"></small>` : '');

async function newTicket(generation) {
  if (!canCreate()) { main.innerHTML = state.user.role === 'gestor' ? '<section class="panel"><h1>El gestor no crea solicitudes</h1><p>Supervisas todas las solicitudes y puedes intervenir en cualquiera cuando lo estimes necesario.</p><a class="button" href="#/tickets">Ver todas las solicitudes</a></section>' : '<section class="panel"><h1>Tu perfil es de atención</h1><p>Atiende las solicitudes asignadas desde tu bandeja: responde, cambia su estado, resuélvelas o derívalas.</p><a class="button" href="#/tickets">Ver solicitudes</a></section>'; return; }
  const [{ services: catalog }, { schema }] = await Promise.all([api('services'), api('schema')]);
  if (generation !== state.generation) return;
  const b = baseOf(schema);
  // En GLPI, "Quiero un servicio" es una solicitud (tipo 2) y "Tengo un problema" es un incidente (tipo 1).
  const intent = INTENTS[state.intent] ? state.intent : 'problema';
  const isService = intent === 'servicio';
  const wantedType = isService ? 2 : 1;
  const services = catalog.filter(s => Number(s.type || 2) === wantedType);
  const extra = isService ? { key: 'kind', prefix: 'Tipo de solución' } : { key: 'problem', prefix: 'Qué está fallando' };
  const ef = b[extra.key];
  const listField = `<div class="field"><label for="extra-choice">${esc(ef.label)}</label><select id="extra-choice" required><option value="">Selecciona una opción</option>${ef.list.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>${hintHtml(ef.hint)}</div>`;
  const urgencyField = isService ? '' : `<div class="field"><label for="urgency">${esc(b.urgency.label)}</label><select name="urgency" id="urgency">${Object.entries(b.urgency.options).map(([level, text]) => `<option value="${level}"${level === '3' ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>${hintHtml(b.urgency.hint)}</div>`;
  main.innerHTML = `<a class="breadcrumb" href="#/inicio">← Volver al inicio</a><p class="eyebrow">ESTAMOS PARA AYUDARTE</p><h1>${isService ? 'Pide un servicio' : 'Cuéntanos qué está fallando'}</h1><p class="lead">${isService ? 'Cuéntanos qué necesitas. Recibirás un número para seguir tu solicitud desde aquí.' : 'Describe el problema. Recibirás un número para seguir tu solicitud desde aquí.'}</p><div class="steps"><span><b>1</b> ${isService ? 'Elige el servicio' : 'Elige el tipo de problema'}</span><span><b>2</b> Describe tu solicitud</span><span><b>3</b> Envíala y sigue los avances</span></div><div class="form-layout"><form class="panel" id="create-form"><p class="intent-chip intent-fixed">Elegiste: <strong>${INTENTS[intent]}</strong> · <a href="#/nueva/${isService ? 'problema' : 'servicio'}">${isService ? 'Reportar un problema' : 'Pedir un servicio'}</a></p><div class="field"><label for="service">${isService ? esc(b.service.label) : '¿Qué tipo de problema es?'}</label><select name="service" id="service" required>${services.length === 1 ? '' : '<option value="">Selecciona una opción</option>'}${services.map(s => `<option value="${esc(s.id)}">${esc((b.service.options[s.id] || {}).name || s.name)}</option>`).join('')}</select>${hintHtml(isService ? b.service.hint : 'Si alguien podría estar accediendo a datos o cuentas sin permiso, elige el incidente de seguridad.', 'service-hint')}</div>${listField}<div class="field"><label for="title">${esc(b.title.label)}</label><input name="title" id="title" required minlength="4" maxlength="200" placeholder="${esc(b.title.placeholder)}">${hintHtml(b.title.hint)}</div><div class="field"><label for="description">${esc(b.description.label)}</label><textarea name="description" id="description" required minlength="10" maxlength="20000" placeholder="${esc(b.description.placeholder)}"></textarea>${hintHtml(b.description.hint)}</div>${urgencyField}${fileField}<p id="create-error" class="inline-error" role="alert" hidden></p><div class="actions"><button type="submit" class="button">Enviar solicitud →</button><a class="button subtle" href="#/inicio">Cancelar</a></div></form><aside class="panel form-hints"><span class="choice-icon" aria-hidden="true">?</span><h2>Una buena descripción ayuda</h2><ul>${isService ? '<li>Explica qué necesitas lograr y para cuándo.</li><li>Menciona el proyecto o la unidad relacionada.</li><li>Si tienes un ejemplo o referencia, adjúntalo.</li>' : '<li>Explica desde cuándo ocurre y a quién afecta.</li><li>Cuenta qué estabas haciendo cuando falló.</li><li>Agrega una captura del error, si la tienes.</li>'}<li>No incluyas claves ni información sensible.</li></ul><p>Después de enviar, podrás agregar más información en la conversación.</p></aside></div>`;
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

export { newTicket };
