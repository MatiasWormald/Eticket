# ¿Por qué usar el enfoque híbrido (Tech Hub + GLPI)?

## Comparativa rápida

| Razón | Explicación |
|---|---|
| 1. Menor mantenimiento | GLPI se encarga de reglas, SLA, asignaciones, notificaciones, plantillas, escalamientos, etc. Tú no tienes que programar eso. |
| 2. Funcionalidad probada | Es un sistema usado en universidades, gobiernos y empresas. Tiene todo lo necesario para una mesa de ayuda ITIL. |
| 3. Seguridad y permisos | Ya trae perfiles, entidades, grupos, MFA (si se activa), mínimo privilegio y trazabilidad. Todo probado. |
| 4. Reportes e indicadores | GLPI tiene dashboards, estadísticas, backlog, tiempos de respuesta/resolución, SLA cumplido, etc. Tu panel no los tiene. |
| 5. Escalabilidad | Si mañana piden añadir reglas por categoría, asignación por grupo, horarios, plantillas de respuesta, OLA, etc., GLPI ya lo tiene. |
| 6. Reducción de riesgo | Si GLPI lanza una nueva versión con correcciones de seguridad, solo actualizas. Con tu API propia, necesitas revisar compatibilidad. |
| 7. Entrenamiento más fácil | Hay documentación, tutoriales y experiencia en el mercado. Es un estándar. |
| 8. Base de conocimiento | GLPI trae FAQ / Base de conocimiento / Service Catalog completo. Tu sitio solo muestra páginas estáticas. |
| 9. Tareas / cron / correos | Las notificaciones por correo, cola de tareas, recordatorios y eventos se activan automáticamente en GLPI. |
| 10. Ahorro de tiempo y costo | Puedes entregar el proyecto hoy usando lo existente, en lugar de duplicar funcionalidades que ya están resueltas. |

## Recomendación de uso por rol

| Rol | Dónde entrar | Razón |
|---|---|---|
| Usuario/Funcionario (quien consulta) | Tech Hub (`http://localhost:8080/crear-consulta.html`) | Más amigable, con marca Hub Tech ULS, formulario simple y claro. |
| Técnico / Mesa de Ayuda | GLPI (`http://localhost:8081`) | Tiene todo para atender: cola, seguimiento, plantillas, SLA, asignación, escalamientos. |
| Administrador / Supervisor | GLPI (`http://localhost:8081`) | Configuración, reglas, grupos, reportes, indicadores y gestión completa. |

## Frase para el cliente

*"Le damos cara al GLPI. El sitio del Tech Hub es la puerta de entrada para crear consultas, y la mesa de ayuda trabaja con GLPI, que es el sistema gestor de tickets preparado para atender, medir y dar seguimiento."*
