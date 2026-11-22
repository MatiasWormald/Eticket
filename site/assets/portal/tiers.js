import { esc } from './core.js';

// ---- Niveles de soporte (tiers) ---------------------------------------
// Numeración del flujo: 4 = atención inicial … 1 = soporte experto.
// Cada tier tiene un color (clases .tier-4 … .tier-1 en portal.css). El cliente
// también ve el tier para saber con quién está hablando.
const TIERS = {
  4: { label: 'Tier IV', name: 'Atención inicial', who: 'La mesa de ayuda recibe tu caso y resuelve lo más común.' },
  3: { label: 'Tier III', name: 'Soporte intermedio', who: 'Un equipo especializado de la unidad que corresponde a tu caso.' },
  2: { label: 'Tier II', name: 'Soporte avanzado', who: 'Especialistas con más experiencia revisan los casos complejos.' },
  1: { label: 'Tier I', name: 'Soporte experto', who: 'El nivel experto atiende los casos más críticos.' },
};
const tierLabel = level => (TIERS[level] ? `${TIERS[level].label} · ${TIERS[level].name}` : 'Sin nivel asignado');
const tierLevel = t => (t && t.tier && TIERS[t.tier.level] ? t.tier.level : 0);
const chip = (level, extra = '') => (TIERS[level] ? `<span class="tier-chip tier-${level}${extra}" title="${esc(tierLabel(level))}">${TIERS[level].label}</span>` : '');
function tierGuideHtml() {
  return `<section class="tier-guide" aria-labelledby="tier-guide-title"><div class="tier-guide-head"><h2 id="tier-guide-title">¿Quién atiende tu solicitud?</h2><p>Tu caso avanza por <strong>niveles de atención</strong>, llamados <em>tiers</em>. En cada solicitud verás en qué tier está y quién te responde.</p></div><ol class="tier-guide-steps">${[4, 3, 2, 1].map(level => `<li class="tier-${level}">${chip(level)}<strong>${TIERS[level].name}</strong><small>${TIERS[level].who}</small></li>`).join('')}</ol><p class="tier-guide-note">Si tu caso necesita más especialización, lo derivamos al siguiente tier y te avisamos en la conversación. No tienes que crear otra solicitud.</p></section>`;
}
const tierChip = t => chip(tierLevel(t));

export { TIERS, tierLabel, tierLevel, chip, tierChip, tierGuideHtml };
