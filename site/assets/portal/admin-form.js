import { api, esc, notice, submit } from './core.js';
import { BASE_FIELDS, BASE_TEXT_KEYS, baseOf } from './form-schema.js';

function bindFormEditor(schema, services) {
  let revision = schema.revision;
  let fields = schema.fields.map(field => ({ ...field, options: [...field.options] }));
  let base = baseOf(schema);
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
  const catalog = () => services.filter(s => !s.custom);
  function serviceOptionsHtml(options) {
    const list = catalog();
    if (!list.length) return '<p class="muted admin-caption">No se pudieron cargar los servicios del catálogo.</p>';
    return `<fieldset class="base-options"><legend>Opciones de la lista</legend><p class="muted admin-caption base-options-note">Deja el nombre en blanco para usar el original. Las opciones ocultas no aparecen al crear una solicitud.</p>${list.map(s => { const own = options[s.id] || {}; const original = s.default_name || s.name; return `<div class="service-option"><div class="field"><label for="base-service-name-${esc(s.id)}">${esc(s.id)} · <span class="muted">original: ${esc(original)}</span></label><input id="base-service-name-${esc(s.id)}" value="${esc(own.name || original)}" maxlength="120" placeholder="${esc(original)}"></div><label class="check-field"><input type="checkbox" id="base-service-show-${esc(s.id)}" ${own.hidden ? '' : 'checked'}>Visible</label></div>`; }).join('')}${customServicesHtml(base.service.custom)}</fieldset>`;
  }
  function customServicesHtml(custom) {
    const rows = custom.map(c => `<div class="service-option custom-service" data-custom="${esc(c.id)}"><div class="field"><label for="base-custom-name-${esc(c.id)}">${c.isNew ? 'Servicio nuevo <span class="new-tag">sin guardar</span>' : 'Servicio agregado'}</label><input id="base-custom-name-${esc(c.id)}" value="${esc(c.name)}" data-min="2" maxlength="120" placeholder="Ej.: Préstamo de equipos"></div><div class="field custom-type"><label for="base-custom-type-${esc(c.id)}">Tipo</label><select id="base-custom-type-${esc(c.id)}"><option value="2"${c.type === 2 ? ' selected' : ''}>Solicitud</option><option value="1"${c.type === 1 ? ' selected' : ''}>Incidente</option></select></div><label class="check-field"><input type="checkbox" id="base-custom-show-${esc(c.id)}" ${c.hidden ? '' : 'checked'}>Visible</label><button type="button" class="button danger small custom-remove" data-remove-service="${esc(c.id)}">Eliminar servicio</button></div>`).join('');
    return `${rows}<div class="actions custom-add"><button type="button" class="button edit-action small" id="add-service"${custom.some(service => service.isNew) ? " disabled" : ""}>＋ Agregar servicio</button><span class="muted admin-caption">Guarda la estructura antes de agregar otro servicio. Eliminar un servicio quita su categoría de GLPI.</span></div>`;
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
    document.getElementById('schema-base').innerHTML = Object.entries(base).map(([key, value]) => `<details class="schema-field base-field" data-base="${key}"${open.has(key) ? ' open' : ''}><summary><span class="base-field-name">${BASE_FIELDS[key].name}</span><span class="base-field-label">${esc(value.label)}</span><span class="base-field-edit">Editar</span></summary><div class="base-field-body"><p class="muted admin-caption">${BASE_FIELDS[key].note}</p>${input(key, 'label', 'Pregunta o nombre del campo', 'data-min="2" maxlength="120"')}${'placeholder' in value ? input(key, 'placeholder', 'Texto de ejemplo dentro del campo', 'maxlength="200"', 'Se ve en gris mientras el campo está vacío. Puede quedar en blanco.') : ''}${input(key, 'hint', 'Texto de ayuda bajo el campo', 'maxlength="200"', 'Puede quedar en blanco.')}${value.list ? `<div class="field"><label for="base-${key}-list">Opciones de la lista, una por línea</label><textarea id="base-${key}-list" maxlength="2419">${esc(value.list.join('\n'))}</textarea><small>Entre 2 y 20 opciones.</small></div>` : ''}${key === 'service' ? serviceOptionsHtml(value.options) : value.options ? `<fieldset class="base-options"><legend>Opciones de impacto, de menor a mayor</legend>${Object.entries(value.options).map(([level, text], i) => `<div class="field"><label for="base-${key}-option-${level}">Nivel ${i + 1}</label><input id="base-${key}-option-${level}" value="${esc(text)}" data-min="2" maxlength="120"></div>`).join('')}</fieldset>` : ''}<div class="actions"><button type="button" class="button restore-action small" data-reset-base="${key}">Restablecer textos originales</button></div></div></details>`).join('');
  }
  function renderFields() {
    document.getElementById('schema-fields').innerHTML = fields.length ? fields.map((f, index) => `<fieldset class="schema-field"><legend>Campo ${index + 1}</legend><div class="form-row"><div class="field"><label for="label-${f.id}">Nombre del campo</label><input id="label-${f.id}" value="${esc(f.label)}" required minlength="2" maxlength="120" placeholder="Ej.: Proyecto relacionado"></div><div class="field"><label for="type-${f.id}">Tipo de respuesta</label><select id="type-${f.id}" data-field-type="${f.id}"><option value="text" ${f.type === 'text' ? 'selected' : ''}>Texto corto</option><option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>Texto largo</option><option value="select" ${f.type === 'select' ? 'selected' : ''}>Lista de opciones</option></select></div></div><div class="field" ${f.type === 'select' ? '' : 'hidden'}><label for="options-${f.id}">Opciones, una por línea</label><textarea id="options-${f.id}" maxlength="2500" ${f.type === 'select' ? 'required' : ''}>${esc(f.options.join('\n'))}</textarea><small>Entre 2 y 20 opciones distintas.</small></div><div class="schema-field-actions"><label class="check-field"><input type="checkbox" id="required-${f.id}" ${f.required ? 'checked' : ''}>Respuesta obligatoria</label><div class="actions"><button type="button" class="button subtle small" data-move="up" data-id="${f.id}" ${index === 0 ? 'disabled' : ''} aria-label="Subir campo ${index + 1}">↑</button><button type="button" class="button subtle small" data-move="down" data-id="${f.id}" ${index === fields.length - 1 ? 'disabled' : ''} aria-label="Bajar campo ${index + 1}">↓</button><button type="button" class="button danger small" data-remove="${f.id}" aria-label="Quitar campo ${index + 1}">Quitar campo</button></div></div></fieldset>`).join('') : '<p class="muted">No hay campos adicionales. El formulario utiliza los campos base.</p>';
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
    if (event.target.closest('#add-service') && !base.service.custom.some(service => service.isNew)) {
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

export { bindFormEditor };
