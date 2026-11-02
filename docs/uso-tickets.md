# Usar eTicket

Las cuatro cuentas de demostración de esta instalación usan la contraseña `123`, por configuración explícita del usuario. Las claves locales están sincronizadas en `.env.demo`.

Abre http://localhost:8080. No necesitas entrar a GLPI para crear, consultar o responder solicitudes.

## Probar como cliente

1. Ingresa como `cliente.demo`, usando `GLPI_DEMO_PASSWORD` de `.env.demo`.
2. Selecciona **Crear solicitud**, elige el servicio, escribe un asunto y describe el problema y su impacto.
3. Opcionalmente adjunta PDF, PNG, JPG o TXT de hasta 10 MB. No compartas claves ni información sensible.
4. Pulsa **Enviar solicitud**. Se abrirá la conversación con el número asignado por GLPI.
5. Desde **Mis solicitudes** busca por asunto o número, o filtra por estado. Puedes agregar respuestas y archivos. **Actualizar** consulta los últimos avances.
6. Cuando el equipo proponga una solución, selecciona **Sí, está resuelto** para cerrar o **Necesito más ayuda** para explicar qué falta y reabrirla.

## Probar la atención

Usa ventanas privadas o perfiles de navegador separados para cada cuenta. No compartas una misma sesión para representar dos usuarios a la vez.

- `agente.demo`: puede ver y responder los tickets dentro de sus entidades autorizadas. Las notas internas no aparecen al cliente. No puede crear, editar, resolver ni enviar a la papelera.
- `gestor.demo`: administrador general. Además de gestionar tickets, tiene la sección **Administración** para añadir, ordenar y quitar campos del formulario. Desde allí puede abrir GLPI, crear perfiles, asignar permisos, crear usuarios y configurar formularios nativos.
- `cliente2.demo`: otro cliente para comprobar que no ve solicitudes de `cliente.demo` ni sus adjuntos.

Las claves correspondientes están en `.env.demo`: `GLPI_DEMO_AGENT_PASSWORD`, `GLPI_DEMO_MANAGER_PASSWORD` y `GLPI_DEMO_OTHER_PASSWORD`.

La recuperación y la eliminación definitiva se hacen desde GLPI con el gestor administrador. El portal utiliza papelera para los tickets. El agente no puede administrar usuarios ni perfiles. `tecnico.demo` fue retirado: no puede iniciar sesión ni se recrea al preparar la demo.

## Preparar las cuentas

```powershell
docker compose up -d --build --wait
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

El script conserva las cuentas, contraseñas y tickets existentes. Hay tres tickets de ejemplo del cliente. No restablece contraseñas cambiadas desde GLPI. Para iniciar/detener, usa `docker compose up -d --wait` y `docker compose down`; no uses `down -v` para reiniciar.

La guía breve para usuarios está en http://localhost:8080/guia.html. El correo saliente y la notificación en tiempo real no están configurados; las respuestas se consultan dentro del portal.

## Personalizar la estructura y crear perfiles

1. Ingresa como `gestor.demo` con contraseña `123` y abre **Administración**.
2. En **Estructura de las solicitudes**, pulsa **Añadir campo**, escribe su nombre, elige texto corto, texto largo o lista, y marca si es obligatorio. Puedes ordenar o quitar campos.
3. Pulsa **Guardar estructura** y **Ver formulario**. Los cambios aparecen en nuevas solicitudes; el historial conserva las respuestas anteriores.
4. En **Crear y administrar perfiles**, se abre GLPI. Si solicita ingreso o confirmación de identidad, usa `gestor.demo` y `123`. Después usa **Añadir** para crear el perfil y configurar sus permisos.
5. En **Administrar usuarios**, crea o abre una cuenta y asigna su perfil y ámbito de entidades. El usuario debe volver a iniciar sesión para cargar los permisos nuevos.

Los campos base de servicio, asunto, descripción e impacto se mantienen. Los formularios nativos de GLPI se administran desde su acceso propio y no sustituyen los campos adicionales configurados en el portal.
