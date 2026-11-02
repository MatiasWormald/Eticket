# Portal propio y roles

## Arquitectura implementada

El cliente usa el frontend del Tech Hub en `site/index.html`, `site/assets/portal.css` y `site/assets/portal.js`. Nginx sirve la web y publica el backend del plugin GLPI en `/api`. El navegador no necesita cambiar de puerto ni de interfaz.

El plugin está en `docker/etickethub`. `front/api.php` carga el controlador `inc/Portal.php` dentro del kernel de GLPI; la base, usuarios, sesiones, adjuntos, estados y auditoría siguen siendo los de GLPI. No existe una cuenta técnica compartida ni una segunda base de tickets. Las mutaciones de tickets se ejecutan dentro de transacciones y los permisos se verifican en cada objeto.

Esta es una integración mediante plugin y clases nativas, no un cliente OAuth de la API REST pública. Las API REST/HL siguen deshabilitadas. El prototipo del directorio `api/` no se ejecuta por defecto ni participa del portal. Al migrar de GLPI 12.0.x, comprobar compatibilidad del plugin y repetir la suite.

## Acceso y protección

`Auth::login()` autentica cada cuenta con el mecanismo nativo de GLPI, conservando sus reglas de acceso. El navegador recibe una cookie de sesión HttpOnly/SameSite y un token CSRF específico del portal para las operaciones POST. No se almacena la contraseña ni un token de servicio en localStorage. La sesión cerrada deja de autorizar solicitudes.

El endpoint `session` inicia la sesión y entrega el token CSRF, sin datos de tickets al usuario anónimo. Solo `session` y `login` pueden utilizarse sin autenticación. Nginx limita intentos de acceso. Los datos mostrados en la interfaz se insertan como texto escapado.

Las cuentas con MFA utilizan el flujo nativo; el portal no lo omite. Si el ingreso redirige al desafío nativo, la pantalla de acceso ofrece abrir GLPI y después volver a eTicket. La integración del desafío de doble factor dentro de la interfaz propia no está implementada ni validada. HTTPS, cookies Secure y pruebas de SSO/MFA son trabajo del despliegue institucional.

## Roles recomendados

| Acción | Cliente | Agente | Gestor |
|---|---|---|---|
| Leer tickets | Solo los propios/autorizados por GLPI | Entidades autorizadas | Entidades autorizadas |
| Responder | Sus tickets abiertos | Sí | Sí |
| Notas internas | No | Sí | Sí |
| Crear | Para sí mismo | No | Para sí mismo |
| Editar asunto, descripción y estado | No | No | Sí |
| Proponer solución | No | No | Sí |
| Aceptar/rechazar solución | Si es solicitante | Si es solicitante | Si es solicitante |
| Enviar a papelera | No | No | Sí |
| Purgar definitivamente | No | No | Desde GLPI |
| Administrar usuarios y crear perfiles | No | No | Sí, en GLPI |

La separación es útil: atender conversaciones no requiere permisos administrativos. El gestor es administrador general y recibe los derechos del perfil nativo Super-Admin. El portal conserva la papelera; el gestor puede recuperar o purgar desde GLPI. `tecnico.demo` se retira del acceso, se marca inactivo y se envía a papelera sin purgar su historial.

Los perfiles `ETICKET Portal Agente` y `ETICKET Portal Gestor` se configuran al arrancar. Su política de derechos se aplica en cada inicio: para personalizar otros permisos, crear un perfil independiente en GLPI. Las autorizaciones de entidades de cada usuario se asignan desde GLPI; no otorgar acceso recursivo a la entidad raíz salvo que deba atender todo el entorno. Los usuarios demo de agente y gestor tienen ese ámbito para probar el laboratorio.

Las capacidades del frontend se calculan desde los permisos GLPI activos; no se confía en el rol enviado por el navegador. Las cuentas antiguas con perfiles distintos mantienen sus derechos nativos. Los usuarios que cambien de perfil o permisos deben cerrar sesión y volver a ingresar.

## Backend

`/api?action=...` admite consultas GET para sesión, servicios, listado, detalle y descarga; y POST para login, logout, crear, responder, editar, proponer solución, aceptar/rechazar y papelera. Toda escritura requiere `X-Eticket-CSRF`. Los campos permitidos se construyen explícitamente: el navegador no puede enviar un solicitante, entidad o permiso arbitrario.

El listado tiene páginas de 20 solicitudes y búsqueda por asunto o número. Se filtra con los permisos nativos antes de devolver cada registro. Los estados se presentan como Recibida, En curso, Planificada, En espera, Resuelta y Cerrada. Para resolver se registra una solución; el cambio a cerrado depende de su aceptación por el solicitante.

Los adjuntos admitidos son PDF, PNG, JPG y TXT de hasta 10 MB, con validación de extensión y MIME. Se agregan mediante los mecanismos de documentos de GLPI. La lectura utiliza los criterios nativos de asociación y privacidad de documentos y exige acceso al ticket; los adjuntos de notas internas no se entregan al cliente.

Las solicitudes se crean con las categorías del catálogo F01–F08 de `config/hub.json`, por lo que GLPI mantiene las reglas de grupo y SLA. No se duplican los formularios nativos: ambos canales crean tickets en el mismo motor. El formulario propio recoge asunto, descripción, servicio e impacto; la descripción debe incluir la unidad o proyecto relacionado.

## Sitios A y B

Enlaces que pueden usar los sitios externos cuando estén listos:

- Crear desde A: `http://localhost:8080/?origen=A#/nueva`
- Consultar desde B: `http://localhost:8080/?origen=B#/tickets`
- Inicio: `http://localhost:8080/?origen=A`

Configurar `ETICKET_SITE_URL`, `ETICKET_ORIGIN_A_URL` y `ETICKET_ORIGIN_B_URL` en `.env` y recrear con `docker compose up -d --build --wait`. El origen se recuerda en la pestaña. Solo A y B son identificadores válidos; el destino viene de configuración del servidor. Si falta un destino, el regreso lleva al inicio de eTicket.

## Pruebas

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
node scripts/test-portal.cjs
node scripts/test-portal-navigation.cjs
powershell -ExecutionPolicy Bypass -File scripts/check.ps1 -Integration
```

La prueba HTTP usa cuentas individuales, intenta lectura y escritura cruzada, verifica permisos de agente/gestor y privacidad de notas/adjuntos, descarga archivos y recorre solución/rechazo/aceptación/papelera. Crea información sintética y la envía a la papelera al terminar; no purga registros. Requiere Node 22+.

La prueba opcional de navegador es `scripts/test-portal-browser.cjs`. Instalar su dependencia con `npm.cmd install --prefix artifacts/portal-qa --no-audit --no-fund playwright-core`. Ejecuta Chrome en modo headless y captura escritorio/móvil. `CHROME_PATH` permite indicar el ejecutable. Los resultados se guardan en `artifacts/portal-qa`, excluido de Git.

No están implementados correo saliente ni notificación en tiempo real. La sección Administración permite configurar los campos adicionales del portal y abre GLPI para crear perfiles, gestionar usuarios y realizar recuperación/purga con la cuenta de gestor.
## Estructura configurable del portal

**Administración → Estructura de las solicitudes** permite al gestor agregar, ordenar y quitar hasta 20 campos adicionales: texto corto, texto largo o listas de 2 a 20 opciones. Cada campo puede ser obligatorio. Servicio, asunto, descripción e impacto se mantienen como base.

El esquema se guarda en la configuración de GLPI, contexto `plugin:etickethub`, clave `portal_schema`. El backend valida los tipos, opciones y obligatoriedad. Los agentes y clientes reciben 403 al intentar modificarlo. Las etiquetas y respuestas se incorporan al contenido del ticket al crearlo; quitar un campo no borra datos históricos. Los formularios nativos de GLPI se configuran por separado desde su enlace en Administración.

El endpoint `schema` consulta la estructura; `save_schema` la guarda con CSRF, comprobación de administrador y una revisión para detectar cambios desde otra pantalla. `node scripts/test-portal-admin.cjs` comprueba el retiro del técnico, los roles y el esquema, y restaura su configuración al terminar. Debe ejecutarse solo en desarrollo porque modifica temporalmente los campos.
