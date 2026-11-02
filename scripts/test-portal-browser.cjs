const { chromium } = require('../artifacts/portal-qa/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.demo'), 'utf8').split(/\r?\n/).filter(x => x.includes('=')).map(x => [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = [];
  const contexts = [];
  let manager, ticketId, originalSchema, schemaChanged = false, nativePage, nativeProfileId;
  async function account(username, key) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8080/');
    await page.getByLabel('Usuario', { exact: true }).fill(username);
    await page.getByLabel('Contraseña', { exact: true }).fill(env[key]);
    await page.getByRole('button', { name: 'Ingresar a mi espacio' }).click();
    await page.getByRole('heading', { name: /^Hola,/ }).waitFor();
    return page;
  }
  try {
    const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(anonymous);
    const landing = await anonymous.newPage(); await landing.goto('http://localhost:8080/');
    await landing.getByRole('heading', { name: 'Te damos la bienvenida' }).waitFor();
    await landing.screenshot({ path: path.join(root, 'artifacts/portal-qa/login-desktop.png'), fullPage: true });
    const client = await account('cliente.demo', 'GLPI_DEMO_PASSWORD');
    await client.screenshot({ path: path.join(root, 'artifacts/portal-qa/client-desktop.png'), fullPage: true });
    await client.setViewportSize({ width: 390, height: 844 });
    await client.screenshot({ path: path.join(root, 'artifacts/portal-qa/client-mobile.png'), fullPage: true });
    assert(await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile must not overflow');
    await client.getByRole('link', { name: 'Crear solicitud', exact: false }).first().click();
    await client.getByLabel('¿En qué necesitas ayuda?').selectOption('F01');
    await client.getByLabel('Asunto', { exact: true }).fill('[QA UI] prueba del portal');
    await client.getByLabel('¿Qué ocurre o qué necesitas?').fill('Prueba ficticia desde navegador. Necesito ayuda con el acceso al proyecto de prueba.');
    await client.getByRole('button', { name: 'Enviar solicitud' }).click();
    await client.waitForURL(/#\/ticket\/\d+$/);
    ticketId = Number(client.url().split('/').at(-1));
    await client.getByRole('heading', { name: '[QA UI] prueba del portal', exact: true }).waitFor();
    await client.getByLabel('Agregar una respuesta').fill('Respuesta sintética enviada desde el navegador.');
    await client.getByRole('button', { name: 'Enviar respuesta' }).click();
    await client.getByText('Respuesta sintética enviada desde el navegador.', { exact: true }).waitFor();
    await client.screenshot({ path: path.join(root, 'artifacts/portal-qa/ticket-mobile.png'), fullPage: true });
    const agent = await account('agente.demo','GLPI_DEMO_AGENT_PASSWORD');
    await agent.goto('http://localhost:8080/#/ticket/' + ticketId);
    await agent.getByLabel('Agregar una respuesta').waitFor();
    assert.equal(await agent.getByRole('button', { name: 'Editar', exact: true }).count(), 0);
    assert.equal(await agent.getByRole('button', { name: 'Enviar a la papelera', exact: true }).count(), 0);
    await agent.getByLabel('Agregar una respuesta').fill('El agente recibió la solicitud y está revisando el caso.');
    await agent.getByRole('button', { name: 'Enviar respuesta' }).click();
    await agent.getByText('El agente recibió la solicitud y está revisando el caso.', { exact: true }).waitFor();
    manager = await account('gestor.demo','GLPI_DEMO_MANAGER_PASSWORD');
    await manager.goto('http://localhost:8080/#/administracion');
    await manager.getByRole('heading', { name: 'Administración de eTicket', exact: true }).waitFor();
    originalSchema = await manager.evaluate(async () => (await (await fetch('/api?action=schema')).json()).schema);
    await manager.getByRole('button', { name: 'Añadir campo', exact: false }).click();
    const customField = manager.locator('.schema-field').last();
    await customField.getByLabel('Nombre del campo', { exact: true }).fill('Proyecto adicional QA navegador');
    await customField.getByLabel('Respuesta obligatoria', { exact: true }).check();
    await manager.getByRole('button', { name: 'Guardar estructura', exact: true }).click();
    await manager.getByRole('status').filter({ hasText: 'Estructura guardada' }).waitFor(); schemaChanged = true;
    await manager.screenshot({ path: path.join(root, 'artifacts/portal-qa/admin-desktop.png'), fullPage: true });
    await client.goto('http://localhost:8080/#/nueva');
    await client.getByLabel('Proyecto adicional QA navegador', { exact: true }).waitFor();
    assert(await client.getByLabel('Proyecto adicional QA navegador', { exact: true }).evaluate(el => el.required));
    await manager.locator('.schema-field').last().getByRole('button', { name: 'Quitar campo', exact: false }).click();
    await manager.getByRole('button', { name: 'Guardar estructura', exact: true }).click();
    await manager.getByRole('status').filter({ hasText: 'Estructura guardada' }).waitFor(); schemaChanged = false;
    const popup = manager.waitForEvent('popup');
    await manager.getByRole('link', { name: 'Crear y administrar perfiles', exact: false }).click();
    nativePage = await popup;
    await nativePage.waitForURL(url => url.origin === 'http://localhost:8081');
    await nativePage.waitForLoadState();
    if (await nativePage.locator('#login_name').isVisible()) {
      await nativePage.locator('#login_name').fill('gestor.demo');
      await nativePage.locator('#login_password').fill(env.GLPI_DEMO_MANAGER_PASSWORD);
      await nativePage.locator('button[type="submit"][name="submit"]').click();
      await nativePage.waitForURL(/front\/profile.php|ReAuth\/Prompt/);
    }
    if (new URL(nativePage.url()).pathname === '/ReAuth/Prompt') {
      await nativePage.locator('input[type="password"]').fill(env.GLPI_DEMO_MANAGER_PASSWORD);
      await nativePage.locator('button[type="submit"]').click();
      await nativePage.waitForURL(/front\/profile.php/);
    }
    await nativePage.screenshot({ path: path.join(root, 'artifacts/portal-qa/native-profiles.png'), fullPage: true });
    assert(nativePage.url().includes('localhost:8081/front/profile.php'), 'native GLPI profile management must be available to gestor: ' + new URL(nativePage.url()).pathname);
    const profileName = '[QA UI] perfil temporal ' + Date.now();
    const createProfile = await nativePage.request.post('http://localhost:8081/front/profile.form.php', { form: { add: '1', name: profileName, interface: 'helpdesk' }, headers: { Referer: 'http://localhost:8081/front/profile.php' } });
    assert(createProfile.status() < 400, 'gestor must be allowed to create native profiles');
    const profileQuery = new URLSearchParams({ 'criteria[0][field]': '1', 'criteria[0][searchtype]': 'contains', 'criteria[0][value]': profileName, reset: 'reset' });
    await nativePage.goto('http://localhost:8081/front/profile.php?' + profileQuery);
    const profileLink = nativePage.getByRole('link', { name: profileName, exact: true }).first(); await profileLink.waitFor();
    nativeProfileId = new URL(await profileLink.getAttribute('href'), nativePage.url()).searchParams.get('id');
    assert(Number(nativeProfileId) > 0);
    const removedProfile = await nativePage.request.post('http://localhost:8081/front/profile.form.php', { form: { purge: '1', id: nativeProfileId } });
    assert(removedProfile.status() < 400); nativeProfileId = null;
    await nativePage.close();
    await client.goto('http://localhost:8080/#/ticket/' + ticketId);
    await manager.goto('http://localhost:8080/#/ticket/' + ticketId);
    await manager.getByRole('button', { name: 'Editar', exact: true }).click();
    await manager.getByLabel('Asunto', { exact: true }).fill('[QA UI] solicitud revisada');
    await manager.getByRole('button', { name: 'Guardar cambios' }).click();
    await manager.getByRole('heading', { name: '[QA UI] solicitud revisada', exact: true }).waitFor();
    await manager.getByLabel('Qué se resolvió y cómo').fill('Se revisó el acceso y se confirmó la solución del incidente ficticio.');
    await manager.getByRole('button', { name: 'Registrar solución' }).click();
    await manager.getByText('Se revisó el acceso y se confirmó la solución del incidente ficticio.', { exact: true }).waitFor();
    await manager.screenshot({ path: path.join(root, 'artifacts/portal-qa/manager-desktop.png'), fullPage: true });
    await client.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await client.getByRole('button', { name: 'Sí, está resuelto', exact: true }).click();
    await client.getByText('Cerrada', { exact: true }).first().waitFor();
    await manager.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await manager.getByRole('button', { name: 'Enviar a la papelera', exact: true }).first().click();
    await manager.getByRole('dialog').getByRole('button', { name: 'Enviar a la papelera', exact: true }).click();
    await manager.waitForURL(/#\/tickets$/); ticketId = null;
    assert.deepEqual(errors, []);
    console.log('OK Chrome: roles, móvil, estructura editable, campos visibles al cliente, acceso GLPI, creación de perfiles, tickets y papelera. Sin errores JavaScript.');
  } finally {
    if (manager && schemaChanged && originalSchema) await manager.evaluate(async original => {
      const s = await (await fetch('/api?action=session')).json(); const current = (await (await fetch('/api?action=schema')).json()).schema;
      await fetch('/api?action=save_schema', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Eticket-CSRF': s.csrf }, body: JSON.stringify({ revision: current.revision, fields: original.fields }) });
    }, originalSchema).catch(() => {});
    if (nativePage && nativeProfileId) await nativePage.request.post('http://localhost:8081/front/profile.form.php', { form: { purge: '1', id: nativeProfileId } }).catch(() => {});
    if (manager && ticketId) {
      await manager.evaluate(async id => { const s = await (await fetch('/api?action=session')).json(); await fetch('/api?action=delete&id='+id,{method:'POST',headers:{'Content-Type':'application/json','X-Eticket-CSRF':s.csrf},body:'{}'}); }, ticketId).catch(() => {});
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
