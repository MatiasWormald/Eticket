# Aceptación del piloto

Configuración de laboratorio, sin aprobación de producción. `scripts/check.ps1` verifica la base técnica. Para cada prueba institucional registrar fecha, versión, ejecutor, resultado y evidencia sin datos reales. Pendiente no significa aprobado.

La suite `scripts/check.ps1 -Integration` valida transaccionalmente los ocho destinos de formularios, contenido de respuestas, tipos, grupos, SLA de todas las prioridades y visibilidad de tickets para dos clientes y un alumno. Revierte usuarios/tickets sintéticos. Es evidencia técnica de laboratorio; no sustituye pruebas de adjuntos, sesiones HTTP, MFA, correo ni UAT institucional.

| ID | Prueba y aceptación | Estado institucional |
|---|---|---|
| INF-01 | PHP/extensiones/DB compatibles, raíz /public | Pendiente |
| INF-02 | HTTPS, DNS, cookies secure | Pendiente |
| CAT-01 | Cliente envía F01–F08: un ticket, tipo, categoría, grupo y respuestas correctos | Pendiente |
| SLA-01 | P1–P4 correctos al crear y al vencer, viernes/festivo/pendiente | Pendiente |
| SLA-02 | 50/75/90/100%, grupo y notificación correctos | Pendiente |
| RBAC-01 | Cliente A no accede a ticket ni adjunto de B por URL directa | Pendiente bloqueante |
| RBAC-02 | Alumno solo ve asignados; no administra usuarios/reglas/SLA/plugins | Pendiente bloqueante |
| RBAC-03 | Seguimiento privado invisible al cliente | Pendiente bloqueante |
| SEC-01 | Formularios y tickets exigen autenticación | Pendiente |
| SEC-02 | Sin acceso a config/files, listado de directorios ni debug | Pendiente |
| SEC-03 | Usuarios demo deshabilitados y MFA privilegiado probado | Pendiente |
| SEC-04 | API fuera del stack por defecto; prototipo responde 503 | Pendiente |
| SEC-05 | Adjuntos: 20 MB máximo y extensiones autorizadas | Pendiente |
| MAIL-01 | SMTP/receptor: crear, responder, seguir y notificar | Pendiente |
| CRON-01 | CLI ejecuta SLA y colas sin errores | Pendiente |
| BCP-01 | Restauración aislada: login/ticket/adjunto/historial, medir RTO/RPO | Pendiente bloqueante |
| PERF-01 | 5/10/25 usuarios, 1.000/10.000 tickets sintéticos, P95 ticket <3 s, errores <1% | Pendiente |
| UAT-01 | Crear, triage, asignar, seguir, resolver, validar y cerrar | Pendiente |
| GOV-01 | CIO y Security Lab aprueban piloto externo | Pendiente bloqueante |

Reproducibilidad: clonar en carpeta limpia, init + Compose, verificar y reaplicar aprovisionamiento sin duplicar formularios, grupos, perfiles o SLA. No usar dumps productivos.

No pasar a producción si falla segregación, adjuntos, MFA, restauración o revisión Security Lab. La configuración no certifica cumplimiento jurídico; privacidad y retención deben validarse institucionalmente.
