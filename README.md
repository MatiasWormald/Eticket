# eTicket · Hub Tech ULS

Entorno de desarrollo compartible: sitio de **nivel 1**, GLPI **12.0.0 estable** y MariaDB. El sitio informa y deriva al portal autenticado de GLPI. Los prototipos de API de niveles 2/3 están bloqueados.

## Iniciar

Requisitos: Git, PowerShell y Docker Desktop con contenedores Linux en ejecución. Puertos 8080 y 8081 disponibles.

```powershell
git clone https://github.com/MatiasWormald/Eticket.git
cd Eticket
powershell -ExecutionPolicy Bypass -File scripts/init.ps1
docker compose up -d --build --wait
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
# Opcional: formularios, prioridades y permisos con datos sintéticos revertidos
powershell -ExecutionPolicy Bypass -File scripts/check.ps1 -Integration
```

`init.ps1` genera claves aleatorias si no existe `.env`, descarga el paquete oficial fijado y comprueba SHA-256. Conserva un `.env` existente. Cada integrante tiene sus propios secretos y volúmenes.

| Servicio | Dirección |
|---|---|
| Sitio y centro de consultas | http://localhost:8080 |
| GLPI | http://localhost:8081 |
| MariaDB | Solo red Docker |

Administrador: `GLPI_ADMIN_USER` (por defecto `admin`) y `GLPI_ADMIN_PASSWORD` de `.env`. Cambiar `.env` no cambia contraseñas de una base ya instalada: hacerlo desde GLPI. No se crea una cuenta cliente compartida; dar de alta usuarios nominativos.

## Demostración en español

La interfaz usa `es_MX` (español con mayor cobertura en el paquete incluido), conservando la zona horaria `America/Santiago`. El idioma global se aplica también a bases ya instaladas; las preferencias explícitas de otras cuentas se conservan. Después de cambiar idioma, cerrar sesión y volver a entrar.

Para preparar ejemplos ficticios, ejecutar una vez:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

Esto crea `cliente.demo` con perfil de cliente externo, sin permisos administrativos, y tres tickets `[DEMO]` en español: solicitud de acceso, incidente de descarga y consulta resuelta, con seguimientos públicos. Ingresar a GLPI con esa cuenta y abrir **Mis tickets**. La contraseña se genera en `.env.demo`, excluido de Git. No usar una contraseña institucional para la demostración.

Repetir el comando conserva los tickets existentes y sus cambios; no duplica ejemplos ni restablece contraseñas. No se cargan ejemplos automáticamente al instalar. Si ya existe `cliente.demo` ajeno a esta demostración, el script se detiene sin modificarlo. Para dejar de usar la demostración, desactivar su cuenta desde GLPI; no purgar datos sin revisión.

## Configuración

La fuente editable es [config/hub.json](config/hub.json). [docker/provision-hub.php](docker/provision-hub.php) utiliza las clases nativas de GLPI, sin modificar su núcleo, para crear:

- Seis entidades, trece grupos operacionales L1–L5 y categorías por unidad.
- Once perfiles institucionales; clientes con tickets propios y alumnos con tickets asignados.
- Ocho formularios autenticados F01–F08 y sus destinos; seguridad deriva a Security Lab.
- Calendario lunes–viernes 08:00–18:00, SLA TTO/TTR P1–P4 y escalamiento.
- Razones de pendiente; base de conocimiento pendiente de contenido institucional revisado.

Los registros funcionales existentes se conservan. En cada inicio se refuerzan el tema corporativo, las cuentas demo inactivas, el cierre de API, el acceso al catálogo y el modo CLI de las tareas críticas. Cambiar JSON no migra valores ya creados: requiere un cambio explícito probado. El arranque no migra automáticamente versiones de base de datos.

Detalles: [configuración y pendientes](docs/configuracion.md), [pruebas](docs/qa.md), [operación y recuperación](docs/operacion.md).

## Trabajo en equipo

```powershell
git switch -c feat/descripcion-del-cambio
# Editar y verificar
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
git add README.md config docker scripts docs site api .github .gitignore .gitattributes .dockerignore docker-compose.yml .env.example
git diff --cached --stat
git commit -m "Configura baseline GLPI para Hub Tech ULS"
git push -u origin feat/descripcion-del-cambio
```

Repositorio del equipo: [MatiasWormald/Eticket](https://github.com/MatiasWormald/Eticket). Es público; solo contiene código y configuración reproducible. Trabajar en ramas y revisar cambios mediante pull requests.

Git excluye `.env`, respaldos, documentos confidenciales de origen, `glpi/` extraído y el paquete descargado. El repositorio conserva configuración, scripts, sitio y documentación técnica. No compartir dumps productivos para trabajar; utilizar datos sintéticos.

En Linux/macOS puede ejecutarse `scripts/init.ps1` con `pwsh`. Alternativa: copiar `.env.example`, reemplazar las tres contraseñas y descargar/verificar el paquete indicado en ese script antes de ejecutar Compose.

## Operación

```powershell
docker compose ps
docker compose logs --tail 100 glpi cron
docker compose down
docker compose up -d --wait
# Después de editar config/hub.json o docker/
docker compose up -d --build --wait
# Respaldo consistente: detiene brevemente GLPI
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```

Los datos persisten en los volúmenes `db_data`, `glpi_config`, `glpi_files` y `glpi_marketplace`. **`docker compose down -v` borra los datos** y no es un procedimiento de actualización. Ante un fallo, revisar logs antes de intervenir los volúmenes.

## Alcance y versión

El PDF del plan exige nivel 1 inicial y aprobación CIO/Security Lab antes de niveles 2/3. La API heredada se conserva como prototipo bloqueado: todavía carece de autenticación individual y aislamiento suficiente.

Los documentos del 06-09-2026 proponen GLPI 11.0.8 y rechazan 12 RC. El paquete existente es **12.0.0 final**, estable desde el 07-10-2026; se conserva y no se hace downgrade. [Release oficial](https://github.com/glpi-project/glpi/releases/tag/12.0.0).

SHA-256 del paquete contrastado con la release oficial: `90c81d1742f5e345756089a83e7c72848bbcae130ea449c8d32f52ad63dece91`. Las bases PHP/MariaDB/Nginx se fijan por digest; los parches requieren actualizar esos valores y repetir QA.

Entorno local HTTP enlazado a loopback. El piloto institucional requiere VPS/VM, DNS, HTTPS, correo, MFA, cuentas nominativas, restauración y aprobación del Hub. Instalar no equivale a aprobar producción.
