# Configuración y decisiones pendientes

Fuente: PDF de niveles y documento de implementación entregados en la carpeta confidencial. Los originales se excluyen de Git.

## Entidades y perfiles

Se crean las seis unidades del Hub como entidades hijas. Grupos y categorías recursivos de la raíz permiten triage transversal. **Crear entidades no mueve ni segrega tickets automáticamente**: revisar entidad de destino al asignar cada cliente/unidad.

Para cada cuenta asignar perfil y entidad explícitos, sin recursividad para alumnos/clientes. Clientes externos confidenciales requieren una entidad propia y pruebas de acceso cruzado. El cliente ve tickets donde es solicitante; no habilitar lectura por grupo. El formulario compartido crea en su entidad: no utilizarlo para expedientes confidenciales entre entidades sin validar el destino.

| Perfil | Capacidad inicial |
|---|---|
| Cliente interno / externo | Crear y seguir tickets propios, KB autorizada |
| Alumno Técnico / QA | Tickets asignados, seguimientos, tareas, solución propuesta |
| Mesa de Ayuda | Triage y asignación dentro de entidades autorizadas |
| Profesor Supervisor / Tech Lead | Tickets de grupo/asignados y supervisión |
| PM | Tickets de grupo/asignados y proyectos |
| Security Analyst | Tickets de su grupo/asignados |
| CIO Hub | Tickets y proyectos dentro de su alcance |
| CE | Lectura de tickets y estadísticas |

Ninguno recibe administración global de usuarios, reglas, SLA o plugins. Super-Admin queda separado. No asignar perfiles de fábrica más amplios a alumnos. Crear personas reales y poblar grupos L1–L5: grupos vacíos no reciben correo.

El permiso nativo de tickets asignados incluye asignación personal **o a un grupo del usuario**. Para restringir a un alumno a asignaciones personales, no incorporarlo a grupos de atención compartidos. Validar pertenencias y entidades antes de habilitarlo; la prueba automática usa un alumno sin grupos compartidos.

## Formularios

F01 incidente, F02 servicio, F03 requerimiento, F04 consulta, F05 sugerencia, F06 nuevo proyecto, F07 seguimiento de proyecto, F08 incidente de seguridad. Todos exigen autenticación, asunto, descripción y unidad/proyecto; incluyen contexto de urgencia. El contenido recoge respuestas. El cliente no elige Major.

F06 crea una solicitud; el proyecto se crea tras aprobación. F07 comunica avances en ticket y se vincula manualmente al proyecto interno. F08 asigna Security Lab. Los prototipos públicos de creación/consulta se bloquean en Nginx y PHP; levantar el perfil `experimental-api` no habilita operaciones.

## SLA piloto

| Hub | Prioridad GLPI | TTO | TTR | Calendario |
|---|---|---|---|---|
| P1 | 6 Major | 30 min | 4 h | Continuo |
| P2 | 4/5 | 2 h | 8 h | Hábil |
| P3 | 3 | 4 h | 20 h | Hábil |
| P4 | 1/2 | 10 h | 50 h | Hábil |

Jornada propuesta: 08–18, 10 horas. Dos días hábiles equivalen a 20 horas efectivas y cinco a 50. Son objetivos piloto, no contractuales ni promesa de guardia 24/7. **Agregar festivos y cierres institucionales** antes del piloto. La matriz nativa calcula urgencia × impacto; L1 valida impacto y reserva Major para críticos.

Recordatorios al 50/75/100%. TTO vencido escala a Tech Lead; TTR 75% a Tech Lead, 90% P1/P2 a CIO y vencimiento a CIO. Los destinatarios efectivos dependen de las notificaciones GLPI, membresías y SMTP; probar supervisor y PM. Seguridad aplica P2 inicial, sujeto a elevar por triage.

Pendientes: OLA por grupo (no se especifican tiempos internos), SLA de proyecto según planificación, SLA específico de seguridad, avisos PM/CE y calendario de contingencia. No se inventan compromisos institucionales.

## Información necesaria para el piloto

- Dominio, VPS/VM, TLS, responsables de parches y continuidad.
- Directorio institucional o altas nominativas, responsables reales de grupos y MFA privilegiado.
- SMTP y receptor IMAP/OAuth institucional; pruebas de entrada, respuesta y notificaciones. No se activa envío sin estas credenciales.
- Festivos, horarios y aprobación operacional de SLA/OLA.
- Reglas cliente/dominio → entidad. No otorgar permisos por correo no verificado.
- Campos específicos por formulario, vínculos de proyectos y tableros CIO/PM/Tech Lead.
- Logo oficial, FAQ revisada, política de privacidad/retención y procedimiento de incidentes.
- Tipos de adjuntos permitidos: límite PHP 20 MB ya definido; validar rechazo de ejecutables en GLPI. No hay antivirus configurado.

No se configuran purgas ni resolución automática por silencio. Los seguimientos internos deben marcarse privados y comprobarse con cuenta cliente. Los tickets no sustituyen el procedimiento institucional de ciberseguridad.
