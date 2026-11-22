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

## Mapa del código

| Si necesitas cambiar… | Empieza aquí |
|---|---|
| Rutas del portal y arranque de la sesión | [site/assets/portal.js](site/assets/portal.js) |
| Pantallas de acceso, registro, 2FA y perfil | [auth.js](site/assets/portal/auth.js) y [profile.js](site/assets/portal/profile.js) |
| Listado, creación y conversación de solicitudes | [ticket-list.js](site/assets/portal/ticket-list.js), [ticket-create.js](site/assets/portal/ticket-create.js) y [ticket-detail.js](site/assets/portal/ticket-detail.js) |
| Administración de cuentas y personalización de formularios | [admin-users.js](site/assets/portal/admin-users.js), [admin-form.js](site/assets/portal/admin-form.js) y [form-schema.js](site/assets/portal/form-schema.js) |
| Estilos del portal y de la guía | [portal.css](site/assets/portal.css), con secciones por pantalla y componente |
| Método HTTP, CSRF y despacho de acciones | [Portal.php](docker/etickethub/inc/Portal.php). Nginx envía `/api` a [front/api.php](docker/etickethub/front/api.php) dentro de GLPI |
| Acceso, cuentas, formularios y operaciones de tickets en GLPI | [Authentication.php](docker/etickethub/inc/Authentication.php), [Accounts.php](docker/etickethub/inc/Accounts.php), [Forms.php](docker/etickethub/inc/Forms.php) y [Tickets.php](docker/etickethub/inc/Tickets.php). [Tiers.php](docker/etickethub/inc/Tiers.php) traduce niveles a grupos de GLPI |
| Catálogo, entidades, reglas y perfiles iniciales | [config/hub.json](config/hub.json), [provision-hub.php](docker/provision-hub.php) y [configure-client-portal.php](docker/configure-client-portal.php) |

El frontend es JavaScript con módulos nativos del navegador. [core.js](site/assets/portal/core.js) concentra la sesión, el cliente HTTP y los elementos compartidos de interfaz. El servicio `api` de [docker-compose.yml](docker-compose.yml) es experimental. Las pantallas del portal se comunican con el plugin `etickethub` de GLPI mediante Nginx.

Para aplicar cambios del plugin en un entorno que ya está levantado, ejecuta `docker compose up -d --build glpi cron`. Nginx monta `site/` directamente, así que los cambios del frontend se sirven desde el directorio de trabajo.

### Datos y persistencia

| Volumen de Compose | Contenido |
|---|---|
| `db_data` | Base de MariaDB administrada por GLPI. Incluye usuarios, correos, perfiles, grupos, tickets y configuración del plugin. |
| `glpi_config` | Configuración de la instalación y claves con las que GLPI cifra credenciales. |
| `glpi_files` | Adjuntos y otros archivos administrados por GLPI. |
| `glpi_marketplace` | Plugins gestionados desde Marketplace. |

GLPI es la fuente de verdad. El plugin usa sus modelos PHP y sus comprobaciones de permisos. La estructura editable del formulario se guarda en la configuración de `plugin:etickethub` y sus servicios personalizados se vinculan a categorías nativas. Para respaldar o restaurar el entorno, combina la base de datos, la configuración y los archivos según la [guía de operación](docs/operacion.md).

## Roles y usuarios de prueba

| Usuario | Perfil | Contraseña en `.env.demo` |
|---|---|---|
| cliente.eticket | Crear y responder sus propias solicitudes | GLPI_DEMO_PASSWORD |
| agente.eticket | Atender tickets asignados a su usuario o equipo, cambiar estados y derivar | GLPI_DEMO_AGENT_PASSWORD |
| gestor.eticket | Administrar tickets, campos, formularios, usuarios y perfiles | GLPI_DEMO_MANAGER_PASSWORD |
| cliente2.demo | Segundo cliente para comprobar aislamiento | GLPI_DEMO_OTHER_PASSWORD |

Las claves se guardan en `.env.demo`, que está excluido de Git. En un entorno nuevo el script genera claves locales. Conserva las cuentas nuevas que ya existan y retira las cuentas anteriores marcadas como demostración. Si se cambió una contraseña desde GLPI, el archivo puede dejar de coincidir.

Administrador: `GLPI_ADMIN_USER` y `GLPI_ADMIN_PASSWORD` de `.env`. Cambiar ese archivo no modifica contraseñas de una base instalada.

Hay tres roles de uso: cliente, agente de atención y gestor administrador. El agente atiende los tickets asignados a su usuario o equipo. El gestor tiene los derechos del Super-Admin de GLPI y puede administrar cuentas, tiers y formularios desde **Administración**. La gestión de cuentas exige la reautenticación de GLPI.

El enlace **Crea una cuenta** solo registra clientes en GLPI. El gestor crea las cuentas de agente y gestor desde Administración. Al registrarse o iniciar sesión en Eticket, las cuentas con correo reciben un código de seis dígitos que vence en cinco minutos. Tras verificar el código, Eticket recuerda el navegador durante 24 horas y pide la contraseña en cada ingreso. Las políticas nativas de autenticación de GLPI se aplican al entrar directamente a GLPI.

Para entregar los códigos a buzones reales, configura el remitente y el transporte SMTP saliente en GLPI y comprueba el envío con su opción de correo de prueba. Si falla el envío durante el registro, se revierte la creación de la cuenta.

## Qué funciona en el portal

Inicio de sesión individual, ocho tipos de servicio, creación, búsqueda y paginación de solicitudes, estados en español, conversación pública y notas internas, adjuntos y descargas autorizadas, edición según permisos, propuesta de solución y aceptación o rechazo por el cliente. El portal solicita confirmación antes de eliminar definitivamente una cuenta o solicitud. Las cuentas archivadas con versiones anteriores dejan libre el correo para un nuevo registro.

Se permiten adjuntos PDF, PNG, JPG y TXT de hasta 10 MB. No hay actualización en tiempo real: el botón **Actualizar** consulta los últimos avances.

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

El frontend se carga desde `site/index.html` sin compilación. Para localizar las pantallas y las operaciones del backend, consulta el [mapa del código](#mapa-del-código).

```powershell
docker compose up -d --build --wait
docker compose logs --tail 100 glpi cron
docker compose down
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```

La configuración `config/hub.json` conserva los formularios nativos, grupos, categorías y SLA. El aprovisionamiento de clientes aplica la política de los dos perfiles dedicados del portal en cada arranque. Para roles distintos, crear otros perfiles desde la administración de GLPI y dar solo el alcance necesario.

Documentación: [uso](docs/uso-tickets.md), [arquitectura y roles](docs/portal-clientes.md), [configuración institucional](docs/configuracion.md), [QA](docs/qa.md), [operación y recuperación](docs/operacion.md).

Es un entorno local de desarrollo. Publicarlo requiere HTTPS, cookies Secure, correo y validación institucional de cuentas, MFA, respaldo, restauración y carga. Las comprobaciones locales no equivalen a una aprobación de producción.
