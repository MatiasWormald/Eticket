// Local development only: temporarily changes the portal schema, then restores it.
const assert = require('node:assert/strict');
const { Client } = require('./test-portal.cjs');
async function main() {
  const manager = new Client(), agent = new Client(), client = new Client(), retired = new Client();
  assert.equal((await manager.login('gestor.demo', 'GLPI_DEMO_MANAGER_PASSWORD')).can_admin, true);
  assert.equal((await agent.login('agente.demo', 'GLPI_DEMO_AGENT_PASSWORD')).can_admin, false);
  assert.equal((await client.login('cliente.demo', 'GLPI_DEMO_PASSWORD')).can_admin, false);
  await retired.call('session');
  await retired.call('login', { username: 'tecnico.demo', password: '123' }, {}, 401);
  const original = (await manager.call('schema')).schema;
  let changed = false, id;
  try {
    const field = { id: 'field_qatest1234', label: 'Proyecto de prueba QA', type: 'select', required: true, options: ['Proyecto A', 'Proyecto B'] };
    for (const actor of [agent, client]) await actor.call('save_schema', { revision: original.revision, fields: [field] }, {}, 403);
    const schema = (await manager.call('save_schema', { revision: original.revision, fields: [field] })).schema; changed = true;
    await manager.call('save_schema', { revision: original.revision, fields: [] }, {}, 409);
    assert.equal((await client.call('schema')).schema.fields[0].label, field.label);
    const payload = { service: 'F01', title: '[QA ADMIN] estructura de prueba', description: 'Prueba sintética de campos adicionales.', urgency: 3 };
    await client.call('create', payload, {}, 400);
    await client.call('create', { ...payload, answers: { [field.id]: 'Valor inexistente' } }, {}, 400);
    const ticket = (await client.call('create', { ...payload, answers: { [field.id]: 'Proyecto B' } }, {}, 201)).ticket;
    id = ticket.id; assert(ticket.description.includes('Proyecto B')); assert(ticket.description.includes(field.label));
    await manager.call('save_schema', { revision: schema.revision, fields: original.fields }); changed = false;
    assert((await client.call('ticket', undefined, { id })).ticket.description.includes('Proyecto B'));
    console.log('OK gestor administrador, técnico retirado, estructura editable, permisos, validación y conservación del historial');
  } finally {
    if (changed) {
      const current = (await manager.call('schema')).schema;
      await manager.call('save_schema', { revision: current.revision, fields: original.fields });
    }
    if (id) await manager.call('delete', {}, { id });
    for (const actor of [manager, agent, client]) await actor.call('logout', {}).catch(() => {});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
