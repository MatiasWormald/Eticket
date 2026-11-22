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

export { BASE_FIELDS, BASE_TEXT_KEYS, baseOf };
