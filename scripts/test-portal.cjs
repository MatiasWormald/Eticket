// End-to-end HTTP checks. Synthetic tickets are moved to the trash afterwards.
// Node 22+; start Docker and run scripts/demo.ps1 first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../.env.demo'), 'utf8').split(/\r?\n/).filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
const base = process.env.ETICKET_TEST_URL || 'http://localhost:8080/api';
class Client {
  cookies = new Map(); csrf = '';
  async call(action, body, params = {}, expected = 200) {
    const url = new URL(base); url.search = new URLSearchParams({ action, ...params });
    const headers = { Accept: 'application/json', Cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; ') };
    const options = { headers, redirect: 'manual' };
    if (body !== undefined) {
      options.method = 'POST'; headers['X-Eticket-CSRF'] = this.csrf;
      if (body instanceof FormData) options.body = body;
      else { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }
    const response = await fetch(url, options);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; this.cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    }
    const text = await response.text();
    assert.equal(response.status, expected, action + ': ' + text.slice(0, 500));
    if (action === 'download') return text;
    let data; try { data = JSON.parse(text); } catch (_) { throw Error(action + ': invalid JSON: ' + text.slice(0, 200)); }
    if (data.csrf) this.csrf = data.csrf;
    return data;
  }
  async login(username, key) {
    await this.call('session');
    const data = await this.call('login', { username, password: env[key] });
    return data.user;
  }
}
async function main() {
  const anonymous = new Client(), client = new Client(), other = new Client(), agent = new Client(), manager = new Client();
  await anonymous.call('tickets', undefined, {}, 401);
  await anonymous.call('login', { username: 'nobody', password: 'invalid' }, {}, 403);
  assert.equal((await client.login('cliente.demo', 'GLPI_DEMO_PASSWORD')).role, 'cliente');
  assert.equal((await other.login('cliente2.demo', 'GLPI_DEMO_OTHER_PASSWORD')).role, 'cliente');
  const agentUser = await agent.login('agente.demo', 'GLPI_DEMO_AGENT_PASSWORD');
  assert.equal(agentUser.role, 'agente'); assert.equal(agentUser.can_create, false);
  assert.equal((await manager.login('gestor.demo', 'GLPI_DEMO_MANAGER_PASSWORD')).role, 'gestor');
  console.log('OK sesiones individuales y roles');
  const ids = [];
  try {
    const services = (await client.call('services')).services;
    assert.equal(services.length, 8);
    const form = new FormData();
    form.set('service', 'F01'); form.set('title', '[QA PORTAL] incidente ' + Date.now());
    form.set('description', 'Descripción sintética de prueba. <script>alert("x")</script>');
    form.set('urgency', '3'); form.set('_users_id_requester', '1');
    form.set('file', new Blob(['Evidencia ficticia del portal.\n'], { type: 'text/plain' }), 'evidencia.txt');
    let ticket = (await client.call('create', form, {}, 201)).ticket; ids.push(ticket.id);
    assert(ticket.requesters.includes('Cliente Demostración'));
    assert.equal(ticket.attachments.length, 1, 'initial attachment must be listed');
    const documentId = ticket.attachments[0].id;
    assert.match(await client.call('download', undefined, { id: ticket.id, document: documentId }), /Evidencia ficticia/);
    console.log('OK creación, solicitante individual, adjunto y descarga');
    assert(!(await other.call('tickets')).tickets.some(t => t.id === ticket.id));
    for (const action of ['ticket', 'download']) await other.call(action, undefined, { id: ticket.id, document: documentId }, 404);
    for (const action of ['reply', 'edit', 'delete']) await other.call(action, { message: 'Intento ajeno', title: 'Intento', description: 'Intento no autorizado' }, { id: ticket.id }, 404);
    for (const action of ['edit', 'delete', 'solve']) await client.call(action, { title: 'Intento', description: 'Intento no autorizado', message: 'No autorizado' }, { id: ticket.id }, 403);
    console.log('OK aislamiento de clientes y permisos comprobados en servidor');
    const agentTicket = (await agent.call('ticket', undefined, { id: ticket.id })).ticket;
    assert.equal(agentTicket.permissions.reply, true); assert.equal(agentTicket.permissions.edit, false); assert.equal(agentTicket.permissions.delete, false);
    for (const action of ['edit', 'delete', 'solve']) await agent.call(action, { title: 'Cambio no autorizado', description: 'No se debe guardar este cambio', message: 'Solución no autorizada' }, { id: ticket.id }, 403);
    await agent.call('create', { service: 'F01', title: 'No autorizado', description: 'No se permite crear al agente' }, {}, 403);
    await agent.call('reply', { message: 'Respuesta pública de prueba.' }, { id: ticket.id });
    await agent.call('reply', { message: 'NOTA INTERNA QA NO VISIBLE AL CLIENTE', private: true }, { id: ticket.id });
    const privateForm = new FormData(); privateForm.set('message', 'Adjunto reservado del equipo.'); privateForm.set('private', '1');
    privateForm.set('file', new Blob(['Evidencia interna privada ' + Date.now()], { type: 'text/plain' }), 'interno.txt');
    const privateTicket = (await agent.call('reply', privateForm, { id: ticket.id })).ticket;
    const privateDoc = privateTicket.attachments.find(a => a.name.endsWith('interno.txt'));
    assert(privateDoc, 'agent must see its internal attachment');
    ticket = (await client.call('ticket', undefined, { id: ticket.id })).ticket;
    assert(ticket.messages.some(m => m.content.includes('Respuesta pública')));
    assert(!ticket.messages.some(m => m.content.includes('NOTA INTERNA')));
    assert(!ticket.attachments.some(a => a.id === privateDoc.id));
    await client.call('download', undefined, { id: ticket.id, document: privateDoc.id }, 404);
    console.log('OK agente responde, no hace CRUD, y se ocultan notas internas al cliente');
    const replyForm = new FormData(); replyForm.set('message', 'Agrego otra evidencia.');
    replyForm.set('file', new Blob(['Segunda evidencia ficticia.\n'], { type: 'text/plain' }), 'respuesta.txt');
    ticket = (await client.call('reply', replyForm, { id: ticket.id })).ticket;
    assert(ticket.attachments.length >= 2, 'reply attachment must be listed');
    await manager.call('edit', { title: '[QA PORTAL] actualizado', description: 'Descripción editada por el gestor de prueba.', status: 2 }, { id: ticket.id });
    ticket = (await manager.call('solve', { message: 'Solución de prueba registrada por el gestor.' }, { id: ticket.id })).ticket;
    assert.equal(ticket.status, 5);
    ticket = (await client.call('approve', { accept: false, message: 'Necesito que revisen un paso adicional.' }, { id: ticket.id })).ticket;
    assert.notEqual(ticket.status, 5); assert.notEqual(ticket.status, 6);
    await manager.call('solve', { message: 'Se completó la revisión adicional solicitada.' }, { id: ticket.id });
    ticket = (await client.call('approve', { accept: true }, { id: ticket.id })).ticket;
    assert.equal(ticket.status, 6);
    await manager.call('delete', {}, { id: ticket.id }); ids.splice(0, 1);
    await client.call('ticket', undefined, { id: ticket.id }, 404);
    console.log('OK adjunto en respuesta, edición, solución, reapertura, cierre y papelera');
    await client.call('logout', {}); await client.call('tickets', undefined, {}, 401);
    console.log('OK cierre de sesión invalida el acceso');
  } finally {
    for (const id of ids) await manager.call('delete', {}, { id }).catch(e => console.error('Cleanup: ' + e.message));
    for (const user of [other, agent, manager]) await user.call('logout', {}).catch(() => {});
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { Client };
