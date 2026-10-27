<?php
declare(strict_types=1);

use Glpi\Form\Form;
use Glpi\Form\Question;
use Glpi\Form\Section;
use Glpi\Form\AccessControl\FormAccessControl;
use Glpi\Form\AccessControl\ControlType\AllowList;
use Glpi\Form\AccessControl\ControlType\AllowListConfig;
use Glpi\Form\Destination\FormDestination;
use Glpi\Form\Destination\CommonITILField\RequestTypeField;
use Glpi\Form\Destination\CommonITILField\ITILCategoryField;
use Glpi\Form\Destination\CommonITILField\AssigneeField;
use Glpi\Form\Destination\CommonITILField\TitleField;
use Glpi\Form\QuestionType\QuestionTypeShortText;
use Glpi\Form\QuestionType\QuestionTypeLongText;

if (PHP_SAPI !== 'cli') { exit(1); }
chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';
$kernel = new Glpi\Kernel\Kernel();
$kernel->boot();
global $DB, $CFG_GLPI;
if (!$DB->connected || Update::isUpdateMandatory()) {
    throw new RuntimeException('Base no disponible o actualización pendiente. No se migra automáticamente.');
}
$_SESSION['glpi_currenttime'] = date('Y-m-d H:i:s');
$_SESSION['glpiactive_entity'] = 0;
$_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpiname'] = 'eticket-provision';
$_SESSION['glpiID'] = 0;
$language = getenv('GLPI_LANGUAGE') ?: 'es_MX';
if (!Glpi\Locale\LanguageRegistry::has($language)) {
    throw new RuntimeException('Idioma no soportado por GLPI: ' . $language);
}
$_SESSION['glpilanguage'] = $language;
$_SESSION['glpicronuserrunning'] = 'eticket-provision';

$cfg = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);

// Crear solamente lo que falta: las ediciones posteriores de los operadores se conservan.
function ensure(string $class, array $key, array $values = []): int {
    $item = new $class();
    $rows = $item->find($key);
    if (count($rows) > 1) { throw new RuntimeException("Identidad ambigua en $class: " . json_encode($key)); }
    if ($rows) { return (int) array_key_first($rows); }
    $id = $item->add($key + $values);
    if (!$id) { throw new RuntimeException("No se pudo crear $class: " . json_encode($key)); }
    if (!$item->getFromDB($id)) { throw new RuntimeException("No se pudo verificar $class #$id"); }
    foreach ($key as $field => $expected) {
        if ((string) ($item->fields[$field] ?? '') !== (string) $expected) {
            throw new RuntimeException("GLPI filtró el campo $field al crear $class; se revierte el aprovisionamiento.");
        }
    }
    echo "Creado $class #$id\n";
    return (int) $id;
}
function addRule(string $name, array $criteria, array $actions, int $rank): void {
    $r = new RuleTicket();
    $existing = $r->find(['name' => $name]);
    if ($existing) { return; }
    $id = ensure(RuleTicket::class, ['name' => $name], [
        'entities_id' => 0, 'is_recursive' => 1, 'is_active' => 1,
        'match' => 'AND', 'ranking' => $rank, 'condition' => 1,
        'description' => 'eTicket: aplica al crear; no sobrescribe asignaciones posteriores.',
    ]);
    foreach ($criteria as [$field, $condition, $value]) {
        ensure(RuleCriteria::class, ['rules_id' => $id, 'criteria' => $field, 'condition' => $condition, 'pattern' => (string) $value]);
    }
    foreach ($actions as $field => $value) {
        ensure(RuleAction::class, ['rules_id' => $id, 'field' => $field], ['action_type' => 'assign', 'value' => (string) $value]);
    }
}

$DB->beginTransaction();
try {
$root = new Entity();
if ($root->getFromDB(0) && in_array($root->fields['name'], ['Root entity', 'Root Entity', 'Entidad raíz', 'Entidad Raíz'])) {
    if (!$root->update(['id' => 0, 'name' => $cfg['root']])) {
        throw new RuntimeException('No se pudo identificar la entidad raíz del Hub.');
    }
}
$groups = [];
foreach ($cfg['groups'] as $name) {
    $groups[$name] = ensure(Group::class, ['name' => $name, 'entities_id' => 0], [
        'is_recursive' => 1, 'is_assign' => 1, 'is_requester' => 0, 'is_watcher' => 1,
        'is_task' => 1, 'is_manager' => 1,
    ]);
}
$unitIndex = 0;
foreach ($cfg['units'] as $name => $categories) {
    ensure(Entity::class, ['name' => $name, 'entities_id' => 0]);
    $group = $groups[$cfg['unit_groups'][$unitIndex++]];
    $parent = ensure(ITILCategory::class, ['name' => $name, 'itilcategories_id' => 0, 'entities_id' => 0], [
        'is_recursive' => 1, 'is_helpdeskvisible' => 1, 'groups_id' => $group,
    ]);
    foreach ($categories as $category) {
        $categoryId = ensure(ITILCategory::class, ['name' => $category, 'itilcategories_id' => $parent, 'entities_id' => 0], [
            'is_recursive' => 1, 'is_helpdeskvisible' => 1, 'groups_id' => $group,
        ]);
        addRule('ETICKET unidad ' . $name . '/' . $category, [['itilcategories_id', 0, $categoryId]], ['_groups_id_assign' => $group], 100 + $categoryId);
    }
}
foreach ($cfg['pending_reasons'] as $name) {
    ensure(PendingReason::class, ['name' => $name], ['comment' => 'Piloto: sin resolución automática por falta de respuesta.']);
}
// GLPI 12 reemplaza las antiguas categorías KB por una estructura de artículos.
// La base de conocimiento se prepara con el equipo, sin publicar contenido ficticio.

// Derechos explícitos, sin copiar privilegios administrativos de perfiles de fábrica.
$roles = [
    'ETICKET Cliente interno' => ['helpdesk', Ticket::READMY | CREATE],
    'ETICKET Cliente externo' => ['helpdesk', Ticket::READMY | CREATE],
    'ETICKET Alumno Técnico' => ['central', Ticket::READASSIGN | Ticket::OWN | UPDATE],
    'ETICKET QA' => ['central', Ticket::READASSIGN | Ticket::OWN | UPDATE],
    'ETICKET Mesa de Ayuda' => ['central', Ticket::READALL | CREATE | UPDATE | Ticket::ASSIGN],
    'ETICKET Profesor Supervisor' => ['central', Ticket::READGROUP | Ticket::READASSIGN | UPDATE | Ticket::ASSIGN],
    'ETICKET Tech Lead' => ['central', Ticket::READGROUP | Ticket::READASSIGN | UPDATE | Ticket::ASSIGN],
    'ETICKET PM' => ['central', Ticket::READGROUP | Ticket::READASSIGN | UPDATE],
    'ETICKET Security Analyst' => ['central', Ticket::READGROUP | Ticket::READASSIGN | UPDATE | Ticket::ASSIGN],
    'ETICKET CIO Hub' => ['central', Ticket::READALL | CREATE | UPDATE | Ticket::ASSIGN],
    'ETICKET CE' => ['central', Ticket::READALL],
];
$profileIds = [];
foreach ($roles as $name => [$interface, $tickets]) {
    $existingProfile = (new Profile())->find(['name' => $name]);
    $id = ensure(Profile::class, ['name' => $name], ['interface' => $interface, 'is_default' => 0]);
    $profileIds[] = $id;
    if ($existingProfile) { continue; }
    $rights = ['ticket' => $tickets, 'followup' => ITILFollowup::SEEPUBLIC | ITILFollowup::ADDMY | ITILFollowup::UPDATEMY, 'knowbase' => READ];
    if ($interface === 'central' && $name !== 'ETICKET CE') {
        $rights['followup'] |= ITILFollowup::ADD_AS_TECHNICIAN | ITILFollowup::ADD_AS_GROUP | ITILFollowup::SEEPRIVATE;
        $rights += ['task' => CommonITILTask::SEEPUBLIC | CommonITILTask::SEEPRIVATE | CommonITILTask::ADD_AS_TECHNICIAN | CommonITILTask::UPDATEMY];
    }
    if (in_array($name, ['ETICKET PM', 'ETICKET CIO Hub', 'ETICKET Tech Lead'])) {
        $rights += ['project' => READ | CREATE | UPDATE, 'projecttask' => READ | CREATE | UPDATE, 'statistic' => READ];
    }
    if ($name === 'ETICKET CE') { $rights = ['ticket' => $tickets, 'statistic' => READ]; }
    foreach ($rights as $right => $value) {
        // Profile::post_addItem puede crear filas con rights=0.
        $rows = (new ProfileRight())->find(['profiles_id' => $id, 'name' => $right]);
        if ($rows && (int) reset($rows)['rights'] === 0) {
            if (!(new ProfileRight())->update(['id' => array_key_first($rows), 'rights' => $value])) {
                throw new RuntimeException('No se pudo inicializar derecho ' . $right);
            }
        } elseif (!$rows) {
            ensure(ProfileRight::class, ['profiles_id' => $id, 'name' => $right], ['rights' => $value]);
        }
    }
}

$calendar = ensure(Calendar::class, ['name' => 'CAL-HUB-OPERACIONAL', 'entities_id' => 0], ['is_recursive' => 1]);
foreach ([1,2,3,4,5] as $day) {
    ensure(CalendarSegment::class, ['calendars_id' => $calendar, 'day' => $day, 'begin' => '08:00:00', 'end' => '18:00:00']);
}
$slm = ensure(SLM::class, ['name' => 'ETICKET SLA PILOTO', 'entities_id' => 0], ['is_recursive' => 1, 'calendars_id' => $calendar]);
$continuousSlm = ensure(SLM::class, ['name' => 'ETICKET SLA PILOTO CONTINUO', 'entities_id' => 0], ['is_recursive' => 1, 'calendars_id' => 0]);
$slaIds = [];
foreach ($cfg['sla'] as $sla) {
    $ids = [];
    foreach (['TTO' => SLM::TTO, 'TTR' => SLM::TTR] as $kind => $type) {
        $minutes = $sla[strtolower($kind) . '_minutes'];
        $ids[$kind] = ensure(SLA::class, ['name' => 'ETICKET ' . $sla['code'] . ' ' . $kind, 'entities_id' => 0], [
            'is_recursive' => 1, 'slms_id' => $sla['business_hours'] ? $slm : $continuousSlm, 'type' => $type,
            'number_time' => $minutes, 'definition_time' => 'minute',
            'calendars_id' => $sla['business_hours'] ? $calendar : 0,
            'use_ticket_calendar' => 0,
            'comment' => 'Objetivo piloto no contractual. Jornada: 10 horas. Festivos pendientes de validación.',
        ]);
        // GLPI mide execution_time respecto del vencimiento (negativo = antes).
        foreach ([50,75,100] as $pct) {
            $level = ensure(SlaLevel::class, ['name' => 'ETICKET ' . $sla['code'] . ' ' . $kind . ' ' . $pct . '%', 'slas_id' => $ids[$kind]], [
                'execution_time' => -(int) round($minutes * 60 * (1 - $pct / 100)),
                'is_active' => 1, 'entities_id' => 0, 'is_recursive' => 1, 'match' => 'AND',
            ]);
            ensure(SlaLevelAction::class, ['slalevels_id' => $level, 'field' => 'recall'], ['action_type' => 'send', 'value' => '1']);
            if ($pct === 100 || ($kind === 'TTR' && $pct === 75)) {
                ensure(SlaLevelAction::class, ['slalevels_id' => $level, 'field' => '_groups_id_assign'], [
                    'action_type' => 'assign', 'value' => (string) $groups[$kind === 'TTO' || $pct === 75 ? 'TECHLEAD-L3' : 'CIO-L4'],
                ]);
            }
        }
        if ($kind === 'TTR' && in_array($sla['code'], ['P1', 'P2'])) {
            $level = ensure(SlaLevel::class, ['name' => 'ETICKET ' . $sla['code'] . ' TTR 90%', 'slas_id' => $ids[$kind]], [
                'execution_time' => -(int) round($minutes * 60 * .1), 'is_active' => 1,
                'entities_id' => 0, 'is_recursive' => 1, 'match' => 'AND',
            ]);
            ensure(SlaLevelAction::class, ['slalevels_id' => $level, 'field' => '_groups_id_assign'], ['action_type' => 'assign', 'value' => (string) $groups['CIO-L4']]);
        }
    }
    $slaIds[$sla['code']] = $ids;
    foreach ($sla['priorities'] as $priority) {
        addRule('ETICKET SLA prioridad ' . $priority, [['priority', 0, $priority]], ['slas_id_tto' => $ids['TTO'], 'slas_id_ttr' => $ids['TTR']], 500 + $priority);
    }
}

foreach ($cfg['services'] as $service) {
    $security = $service['code'] === 'F08';
    $group = $groups[$security ? 'SECURITY-L2' : 'HD-L1-MESA'];
    $category = ensure(ITILCategory::class, ['name' => $service['category'], 'itilcategories_id' => 0, 'entities_id' => 0], [
        'is_recursive' => 1, 'is_helpdeskvisible' => 1, 'groups_id' => $group,
    ]);
    $actions = ['_groups_id_assign' => $group, 'type' => $service['type']];
    addRule('ETICKET servicio ' . $service['code'], [['itilcategories_id', 0, $category]], $actions, $security ? 900 : 50 + (int) substr($service['code'], 1));
    if ($security) {
        foreach ([1, 2, 3] as $lowPriority) {
            addRule('ETICKET seguridad mínimo High ' . $lowPriority,
                [['itilcategories_id', 0, $category], ['priority', 0, $lowPriority]],
                ['priority' => 4, 'slas_id_tto' => $slaIds['P2']['TTO'], 'slas_id_ttr' => $slaIds['P2']['TTR']],
                901 + $lowPriority);
        }
    }
    $form = ensure(Form::class, ['name' => $service['code'] . ' — ' . $service['name'], 'entities_id' => 0], [
        'is_recursive' => 1, 'is_active' => 1,
        'description' => 'Atención Hub Tech ULS. Acceso autenticado. No incluyas contraseñas ni datos innecesarios.',
        'header' => $security ? 'Informa también al responsable institucional si el incidente está ocurriendo. El ticket no sustituye el procedimiento de ciberseguridad.' : 'Describe tu solicitud. No incluyas contraseñas ni datos personales innecesarios.',
    ]);
    $sectionRows = (new Section())->find(['forms_forms_id' => $form]);
    if (!$sectionRows) { throw new RuntimeException('Formulario sin sección'); }
    $section = (int) array_key_first($sectionRows);
    ensure(Question::class, ['forms_sections_id' => $section, 'name' => 'Asunto'], ['type' => QuestionTypeShortText::class, 'is_mandatory' => 1, 'vertical_rank' => 0]);
    ensure(Question::class, ['forms_sections_id' => $section, 'name' => 'Descripción y resultado esperado'], ['type' => QuestionTypeLongText::class, 'is_mandatory' => 1, 'vertical_rank' => 1]);
    ensure(Question::class, ['forms_sections_id' => $section, 'name' => 'Unidad, servicio o proyecto relacionado'], ['type' => QuestionTypeShortText::class, 'is_mandatory' => 1, 'vertical_rank' => 2]);
    ensure(Question::class, ['forms_sections_id' => $section, 'name' => 'Urgencia y personas afectadas'], ['type' => QuestionTypeLongText::class, 'vertical_rank' => 3]);
    $destinations = (new FormDestination())->find(['forms_forms_id' => $form]);
    foreach ($destinations as $destination) {
        $existing = json_decode($destination['config'], true);
        if ($existing) { continue; }
        $config = [
            RequestTypeField::getKey() => ['strategy' => 'specific_value', 'specific_request_type' => $service['type']],
            ITILCategoryField::getKey() => ['strategy' => 'specific_value', 'specific_itilcategory_id' => $category],
            AssigneeField::getKey() => ['strategies' => ['specific_values'], 'specific_itilactors_ids' => ['groups_id-' . $group]],
            TitleField::getKey() => ['value' => $service['code'] . ' — ' . $service['name']],
        ];
        if (!(new FormDestination())->update(['id' => $destination['id'], 'config' => $config])) { throw new RuntimeException('Destino no actualizado'); }
    }
    // La lista por defecto de GLPI permite todos los usuarios AUTENTICADOS.
    // Se reemplaza por perfiles concretos del piloto; jamás AnonymousAccess.
    $access = (new FormAccessControl())->find(['forms_forms_id' => $form, 'strategy' => AllowList::class]);
    foreach ($access as $policy) {
        if (!(new FormAccessControl())->update([
            'id' => $policy['id'], 'is_active' => 1,
            '_config' => new AllowListConfig(profile_ids: array_merge([4], $profileIds)),
        ])) { throw new RuntimeException('No se pudo restringir formulario'); }
    }
}
// API cerrada en el nivel 1, aun si existía una configuración experimental.
Config::setConfigurationValues('core', ['enable_api' => 0, 'enable_hlapi' => 0, 'language' => $language]);
$DB->update('glpi_crontasks', ['mode' => CronTask::MODE_EXTERNAL], ['name' => ['slaticket', 'queuednotification', 'watcher']]);
$DB->commit();
} catch (Throwable $error) {
    $DB->rollBack();
    throw $error;
}
$report = ['baseline' => $cfg['baseline'], 'glpi_version' => GLPI_VERSION, 'date' => date(DATE_ATOM), 'level' => 1];
file_put_contents(GLPI_VAR_DIR . '/_eticket-baseline.json', json_encode($report, JSON_PRETTY_PRINT));
echo "Baseline eTicket aplicada; correo, cuentas nominales, feriados y UAT requieren configuración institucional.\n";
