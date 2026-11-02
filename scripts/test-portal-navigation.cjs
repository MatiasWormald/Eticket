// Run with: node scripts/test-portal-navigation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../docker/etickethub/public/js/navigation.js'), 'utf8');

function render(search, remembered = '', blockedStorage = false) {
  const elements = [];
  const memory = new Map([['eticket-origin', remembered]]);
  const document = {
    readyState: 'complete',
    getElementById: id => elements.find(item => item.id === id),
    querySelector: () => ({ src: 'http://localhost:8081/plugins/etickethub/js/navigation.js?v=123' }),
    createElement: () => ({ children: [], setAttribute() {}, appendChild(child) { this.children.push(child); } }),
    body: { prepend(item) { elements.push(item); } },
  };
  const context = vm.createContext({
    URL, URLSearchParams, document,
    window: { location: { search, origin: 'http://localhost:8081' } },
    sessionStorage: {
      setItem(key, value) { if (blockedStorage) throw Error('blocked'); memory.set(key, value); },
      getItem(key) { if (blockedStorage) throw Error('blocked'); return memory.get(key); },
    },
  });
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  assert.equal(elements.length, 1, 'navigation must not appear twice');
  return elements[0].children;
}

const direct = render('');
assert.equal(direct.length, 4);
assert.equal(direct[1].href, 'http://localhost:8081/ServiceCatalog');
assert.equal(direct[2].href, 'http://localhost:8081/front/ticket.php?reset=reset');
assert.equal(direct[3].href, 'http://localhost:8081/plugins/etickethub/front/return.php');
for (const origin of ['A', 'B']) {
  for (const query of ['?origen=' + origin, '?redirect=' + encodeURIComponent('/Helpdesk?origen=' + origin)]) {
    assert.equal(render(query).at(-1).href, 'http://localhost:8081/plugins/etickethub/front/return.php?origen=' + origin);
  }
  assert.equal(render('', origin).at(-1).textContent, 'Volver al sitio de origen');
}
assert.equal(render('?origen=https://example.org').length, 4, 'untrusted destination must not become a link');
assert.equal(render('?origen=A', '', true).length, 5, 'direct access must work with blocked storage');
console.log('OK navegación directa, regreso A/B, continuidad del login y almacenamiento bloqueado');
