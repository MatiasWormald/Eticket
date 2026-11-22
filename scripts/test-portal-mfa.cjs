const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('./test-portal.cjs');

async function mailboxCode(email) {
  const inbox = process.env.ETICKET_TEST_MAILPIT_URL;
  assert(inbox, 'Set ETICKET_TEST_MAILPIT_URL to the SMTP test inbox API base URL');
  const search = new URL('/api/v1/search', inbox);
  search.searchParams.set('query', 'to:' + email);
  const { messages } = await (await fetch(search)).json();
  assert(messages?.length, 'the SMTP inbox should have received the code');
  const message = await (await fetch(new URL('/api/v1/message/' + messages[0].ID, inbox))).json();
  const code = message.Text.match(/\b[0-9]{6}\b/)?.[0];
  assert(code, 'the message should contain a six-digit code');
  return code;
}

async function main() {
  const client = new Client();
  const email = `qa.${randomUUID()}@example.test`;
  const password = 'PortalQA2026-local';
  await client.call('session');
  const registration = { name: 'Cliente temporal QA', email, password, consent: true, role: 'gestor', can_admin: true };
  const setup = await client.call('register', registration, {}, 201);
  assert.equal(setup.verification_required, true);
  assert.equal(setup.mfa.method, 'email');
  assert.equal(setup.mfa.secret, undefined);
  await client.call('tickets', undefined, {}, 401);
  assert.equal((await client.call('session')).mfa.destination, setup.mfa.destination);
  await client.call('resend_code', {}, {}, 429);
  await client.call('verify_login', { code: 'inválido' }, {}, 403);
  const enrolled = await client.call('verify_login', { code: await mailboxCode(email) });
  assert.equal(enrolled.user.role, 'cliente');
  assert.equal(enrolled.user.can_admin, false);
  assert.equal((await client.call('profile')).profile.email, email);

  const cookieName = 'eticket_mfa_remembered';
  const marker = client.cookies.get(cookieName);
  assert(marker);
  const remaining = Number(marker.split('.')[0]) - Math.floor(Date.now() / 1000);
  assert(remaining >= 86390 && remaining <= 86400, 'the browser marker expires after 24 hours');
  await client.call('logout', {});
  await client.call('session');
  await client.call('login', { username: email, password: 'incorrecta' }, {}, 401);
  const remembered = await client.call('login', { username: email, password });
  assert.equal(remembered.user.role, 'cliente');
  assert.equal(client.cookies.get(cookieName), marker, 'signing in again does not extend the marker');
  await client.call('logout', {});

  const otherBrowser = new Client();
  await otherBrowser.call('session');
  const login = await otherBrowser.call('login', { username: email, password });
  assert.equal(login.verification_required, true);
  assert.equal(login.mfa.method, 'email');
  assert.equal(login.mfa.secret, undefined);
  await otherBrowser.call('verify_login', { code: await mailboxCode(email) });
  await otherBrowser.call('verify_login', { code: '000000' }, {}, 409);
  await otherBrowser.call('delete_profile', { password, confirm: true });
  await otherBrowser.call('profile', undefined, {}, 401);
  await otherBrowser.call('session');
  await otherBrowser.call('register', registration, {}, 201);
  const recreated = await otherBrowser.call('verify_login', { code: await mailboxCode(email) });
  assert.notEqual(recreated.user.id, enrolled.user.id);
  await otherBrowser.call('delete_profile', { password, confirm: true });
  console.log('OK registro, verificación por correo, recuerdo de 24 horas, borrado y reutilización del correo');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
