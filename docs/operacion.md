# Operación y recuperación

## Respaldo

`scripts/backup.ps1` detiene aplicación y cron, obtiene dump transaccional y copia `config`, `files`, `marketplace` y `plugins`. Luego reinicia los servicios. Incluye `.env` y claves: no versionar. Copiar a almacenamiento institucional segregado y cifrado. Programación, cifrado, copia externa y retención requieren conocer su infraestructura.

Se excluyen caché, sesiones, temporales y bloqueos; GLPI los recrea. Solo se reinician los servicios que estaban en ejecución antes de la copia.

Propuesta documental: diario, 7 diarios/4 semanales, RPO piloto 24 h y RTO 8 h. Aprobar y medir; no borrar copias automáticamente sin política.

## Restauración de ensayo

Usar otra carpeta y **todos** los comandos con `docker compose -p eticket-restore`, para no tocar los volúmenes originales. Copiar el `.env` del respaldo y cambiar puertos. Bloquear correo saliente en el entorno de recuperación.

1. Ejecutar `scripts/init.ps1` para obtener el mismo paquete, conservando claves respaldadas.
2. `docker compose -p eticket-restore up -d db --wait`.
3. `docker compose -p eticket-restore cp <respaldo>/database.sql db:/tmp/restore.sql`.
4. `docker compose -p eticket-restore exec -T db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" < /tmp/restore.sql'`.
5. `docker compose -p eticket-restore run --rm --no-deps --entrypoint tar -v '<ruta-absoluta-respaldo>:/backup:ro' glpi -xzf /backup/glpi-data.tgz -C /var/www/html`.
6. `docker compose -p eticket-restore up -d --wait`.
7. Verificar login, ticket, adjunto e historial; medir duración y documentar resultado. Borrar SQL temporal del contenedor de recuperación.

No ejecutar contra el proyecto original. Para producción conservar también versión de imágenes, proxy/TLS, correo y secretos externos. No hay restauración destructiva automática.

## Actualizar y diagnosticar

Respaldar, probar versión/digests nuevos en un entorno separado, migrar base oficialmente con responsable, QA y revisión de seguridad, luego publicar. El arranque detecta una migración pendiente y falla; no modifica automáticamente el esquema. No editar núcleo GLPI.

`docker compose ps` comprueba salud HTTP; cron espera GLPI saludable. `docker compose logs --tail 100 glpi cron` muestra fallos. Salud HTTP no demuestra entrega SMTP, ejecución de todos los SLA ni aislamiento de usuarios. Aplicar `docs/qa.md`.
