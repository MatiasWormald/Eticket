# eTicket · Tech Hub ULS

Portal propio de soporte con la estética del Tech Hub, GLPI 12.0.0 y MariaDB. Los clientes crean y siguen sus solicitudes sin salir de eTicket. El equipo puede atender desde el portal o desde GLPI.

## Iniciar

Requisitos: Docker Desktop con contenedores Linux y PowerShell. Puertos 8080 y 8081 disponibles.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init.ps1
docker compose up -d --build --wait
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

- Portal de clientes y atención: http://localhost:8080
- Administración nativa de GLPI: http://localhost:8081
- Guía para clientes: http://localhost:8080/guia.html

`init.ps1` conserva un `.env` existente y verifica el paquete oficial por SHA-256. Los datos persisten en volúmenes Docker. No uses `docker compose down -v` para reiniciar: elimina los datos.

## Roles y usuarios de prueba

| Usuario | Perfil | Contraseña en `.env.demo` |
|---|---|---|
| cliente.demo | Crear y responder sus propias solicitudes | GLPI_DEMO_PASSWORD |
| agente.demo | Leer y responder tickets de sus entidades autorizadas, incluyendo notas internas | GLPI_DEMO_AGENT_PASSWORD |
| gestor.demo | Administrador general: tickets, campos, formularios, usuarios y perfiles | GLPI_DEMO_MANAGER_PASSWORD |
| cliente2.demo | Segundo cliente para comprobar aislamiento | GLPI_DEMO_OTHER_PASSWORD |

Las claves se generan localmente; `.env.demo` está excluido de Git. El script conserva cuentas y claves existentes, y rechaza cuentas homónimas ajenas a la demostración. Si se cambió una contraseña desde GLPI, el archivo puede dejar de coincidir. No compartir cuentas de prueba en un entorno real.

Administrador: `GLPI_ADMIN_USER` y `GLPI_ADMIN_PASSWORD` de `.env`. Cambiar ese archivo no modifica contraseñas de una base instalada.

Hay tres roles de uso: cliente, agente de atención y gestor administrador. El agente consulta y responde; el gestor tiene los derechos del Super-Admin de GLPI, incluida la creación de perfiles y usuarios. El gestor puede editar la estructura del formulario desde **Administración**, y abrir GLPI para la configuración completa. `tecnico.demo` está retirado, desactivado y en papelera; no se vuelve a crear. Los derechos se comprueban en el servidor.

## Qué funciona en el portal

Inicio de sesión individual, ocho tipos de servicio, creación, búsqueda y paginación de solicitudes, estados en español, conversación pública y notas internas, adjuntos y descargas autorizadas, edición según permisos, propuesta de solución, aceptación o rechazo por el cliente y papelera para el gestor.

Se permiten adjuntos PDF, PNG, JPG y TXT de hasta 10 MB. No hay actualización en tiempo real: el botón **Actualizar** consulta los últimos avances. El correo saliente no está configurado.

La autenticación usa las cuentas y sesiones nativas de GLPI. Para cuentas con MFA, utilizar primero el acceso institucional de GLPI desde la pantalla de ingreso y volver al portal. La experiencia de doble factor dentro de la interfaz propia queda pendiente de implementación y validación.

## Arquitectura

`Navegador → Nginx /api → plugin etickethub → clases, permisos y almacenamiento de GLPI`.

El plugin local implementa un backend JSON con sesión individual, protección CSRF, comprobación de derechos sobre cada ticket y filtros nativos de privacidad de documentos. No utiliza una cuenta de servicio compartida, no expone claves al navegador y no duplica los tickets en otra base. Está fijado a GLPI 12.0.x; al actualizar GLPI se deben repetir las pruebas.

Las API públicas REST heredada/HL de GLPI permanecen deshabilitadas. El directorio `api/` es un prototipo antiguo bloqueado, fuera del stack por defecto: no es el backend de este portal. No iniciar el perfil `experimental-api` para usar eTicket.

## Integrar las páginas A y B

Los sitios externos pueden enlazar directamente a:

- `http://localhost:8080/?origen=A#/nueva`
- `http://localhost:8080/?origen=B#/tickets`

Completar `ETICKET_ORIGIN_A_URL` y `ETICKET_ORIGIN_B_URL` en `.env` cuando estén disponibles. `ETICKET_SITE_URL` es el destino de eTicket. Ejecutar `docker compose up -d --build --wait` después. Si no hay destino configurado, el regreso lleva a eTicket. Solo se admiten A/B, no URLs arbitrarias enviadas por el cliente.

## Comprobaciones

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1 -Integration
# Node 22+; crea tickets sintéticos y los envía a la papelera al terminar
node scripts/test-portal.cjs
node scripts/test-portal-navigation.cjs
# Solo desarrollo: modifica temporalmente y restaura la estructura
node scripts/test-portal-admin.cjs
```

Para pruebas reales de navegador con Chrome instalado:

```powershell
npm.cmd install --prefix artifacts/portal-qa --no-audit --no-fund playwright-core
node scripts/test-portal-browser.cjs
```

`CHROME_PATH` permite indicar otra ruta de Chrome/Chromium. Las capturas quedan en `artifacts/portal-qa`, excluido de Git. Las pruebas HTTP comprueban acceso entre clientes, permisos de agente/gestor, notas y adjuntos privados, solución, reapertura, cierre y papelera.

## Desarrollo y operación

El frontend está en `site/index.html` y `site/assets/portal.*`; no requiere compilación. El backend está en `docker/etickethub/inc/Portal.php`. Los cambios del plugin requieren reconstruir la imagen.

```powershell
docker compose up -d --build --wait
docker compose logs --tail 100 glpi cron
docker compose down
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```

La configuración `config/hub.json` conserva los formularios nativos, grupos, categorías y SLA. El aprovisionamiento de clientes aplica la política de los dos perfiles dedicados del portal en cada arranque. Para roles distintos, crear otros perfiles desde la administración de GLPI y dar solo el alcance necesario.

Documentación: [uso](docs/uso-tickets.md), [arquitectura y roles](docs/portal-clientes.md), [configuración institucional](docs/configuracion.md), [QA](docs/qa.md), [operación y recuperación](docs/operacion.md).

Es un entorno local de desarrollo. Publicarlo requiere HTTPS, cookies Secure, correo y validación institucional de cuentas, MFA, respaldo, restauración y carga. Las comprobaciones locales no equivalen a una aprobación de producción.