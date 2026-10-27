# Validación técnica local — 26-10-2026

Versión: GLPI 12.0.0, paquete SHA-256 contrastado con el digest publicado en GitHub. Imágenes base fijadas en Compose/Dockerfile.

Comprobaciones realizadas:

- Construcción completa de las imágenes GLPI y cron.
- Arranque saludable del entorno principal en 8080/8081.
- Instalación desde cero en proyecto Docker separado, con volúmenes nuevos y puertos 18080/18081.
- Ocho formularios activos, seis entidades, trece grupos, once perfiles y ocho SLA.
- Reaplicación de la baseline sin duplicar esos registros.
- Formularios F01–F08: un ticket por envío, respuestas conservadas, tipo, grupo y SLA correctos.
- Mapeo SLA y cálculo de vencimiento para las seis prioridades nativas.
- Cliente ve tickets propios; otro cliente no los ve. Alumno sin asignación no ve el ticket, y asignado sí; sin administración global.
- Cuenta demo inactiva, API nativa deshabilitada, formularios sin acceso anónimo.
- Respaldo de SQL/configuración/archivos y restauración en el entorno aislado; comprobaciones de baseline correctas tras restaurar.
- Sintaxis PHP, PowerShell, JavaScript, JSON, Compose y revisión de archivos excluidos de Git.

Los usuarios y tickets sintéticos de la suite se revierten con una transacción. Los escenarios de adjuntos, correo real, MFA, sesiones de navegador, calendarios institucionales, escalamiento temporizado, carga y UAT continúan pendientes según `qa.md`. Esta evidencia no certifica producción ni cumplimiento normativo.
