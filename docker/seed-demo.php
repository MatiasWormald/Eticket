<?php
declare(strict_types=1);

// Ejecución explícita: nunca se carga contenido de demostración en cada inicio.
if (PHP_SAPI !== 'cli') { exit(1); }
chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';
$kernel = new Glpi\Kernel\Kernel();
$kernel->boot();
global $DB, $CFG_GLPI;
$name = getenv('GLPI_DEMO_USER') ?: 'cliente.demo';
$password = getenv('GLPI_DEMO_PASSWORD') ?: '';
if (strlen($password) < 20 || $name !== 'cliente.demo') {
    throw new RuntimeException('Ejecuta scripts/demo.ps1 para preparar las credenciales de demostración.');
}
$adminRows = (new User())->find(['name' => getenv('GLPI_ADMIN_USER') ?: 'admin', 'is_active' => 1]);
if (count($adminRows) !== 1) { throw new RuntimeException('Administrador no disponible.'); }
$_SESSION['glpiID'] = (int) array_key_first($adminRows);
$_SESSION['glpiname'] = 'eticket-demo-seed';
$_SESSION['glpi_currenttime'] = date('Y-m-d H:i:s');
$_SESSION['glpiactive_entity'] = 0;
$_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpicronuserrunning'] = 'eticket-demo-seed';
$_SESSION['glpilanguage'] = $CFG_GLPI['language'];

function addDemo(string $class, array $data): int {
    $id = Session::callAsSystem(fn() => (new $class())->add($data));
    if (!$id) { throw new RuntimeException('No se pudo crear ' . $class); }
    return (int) $id;
}
function demoId(string $class, string $name): int {
    $rows = (new $class())->find(['name' => $name]);
    if (count($rows) !== 1) { throw new RuntimeException('Falta o se repite ' . $class . ': ' . $name); }
    return (int) array_key_first($rows);
}

$examples = [
    [
        'name' => '[DEMO] Solicitud de acceso al repositorio de datos',
        'category' => 'Servicio', 'group' => 'HD-L1-MESA', 'type' => Ticket::DEMAND_TYPE,
        'status' => Ticket::INCOMING,
        'content' => '<p><strong>Ejemplo ficticio para demostración.</strong></p><p>Necesito acceso de lectura al repositorio de datos del proyecto de indicadores de sustentabilidad para revisar los informes disponibles.</p><p>Resultado esperado: ingresar con mi cuenta y consultar los documentos autorizados. No se adjuntan datos personales ni credenciales.</p>',
        'followup' => 'Hemos recibido tu solicitud. La mesa de ayuda revisará los permisos necesarios y te informará los siguientes pasos por este mismo ticket.',
    ],
    [
        'name' => '[DEMO] Error al descargar un informe del proyecto',
        'category' => 'Incidente', 'group' => 'SFL-L2', 'type' => Ticket::INCIDENT_TYPE,
        'status' => Ticket::ASSIGNED,
        'content' => '<p><strong>Ejemplo ficticio para demostración.</strong></p><p>Al seleccionar «Descargar informe» aparece un mensaje de error y no se genera el archivo PDF. El problema se repite al volver a ingresar.</p><p>Afecta la revisión de un informe; las demás funciones siguen disponibles. Solicitamos revisar la descarga y confirmar cuando vuelva a funcionar.</p>',
        'followup' => 'El equipo técnico reprodujo el problema y está revisando la generación del PDF. Publicaremos aquí los avances; por ahora no necesitas volver a enviar la solicitud.',
    ],
    [
        'name' => '[DEMO] Consulta sobre el seguimiento de mi proyecto',
        'category' => 'Consulta', 'group' => 'HD-L1-MESA', 'type' => Ticket::DEMAND_TYPE,
        'status' => Ticket::SOLVED,
        'content' => '<p><strong>Ejemplo ficticio para demostración.</strong></p><p>¿Dónde puedo consultar los avances y próximos hitos de mi proyecto sin acceder a la información técnica interna del equipo?</p>',
        'followup' => 'Puedes consultar los avances desde «Mis tickets». El equipo publicará en el ticket de seguimiento los hitos completados, próximos pasos y decisiones que requieran tu participación.',
        'solution' => '<p>Se explicó cómo ingresar al portal y consultar el ticket de seguimiento del proyecto.</p><p>Los avances y próximos hitos se comunicarán en los seguimientos públicos. La información técnica interna queda reservada al equipo.</p><p>Revisa esta respuesta y confirma si resuelve tu consulta.</p>',
    ],
];

$DB->beginTransaction();
try {
    $profile = demoId(Profile::class, 'ETICKET Cliente externo');
    $users = (new User())->find(['name' => $name]);
    if (count($users) > 1) { throw new RuntimeException('Cuenta de demostración ambigua.'); }
    if (!$users) {
        $uid = addDemo(User::class, [
            'name' => $name, 'password' => $password, 'password2' => $password,
            'realname' => 'Demostración', 'firstname' => 'Cliente',
            'language' => $CFG_GLPI['language'], 'is_active' => 1,
            'comment' => 'Cuenta ficticia para presentar eTicket. Sin datos ni correo reales.',
        ]);
        // Quitar cualquier autorización predeterminada creada automáticamente.
        foreach ((new Profile_User())->find(['users_id' => $uid]) as $grant) {
            if (!(new Profile_User())->delete(['id' => $grant['id']], true)) { throw new RuntimeException('No se pudo limitar el perfil de demostración.'); }
        }
        addDemo(Profile_User::class, ['users_id' => $uid, 'profiles_id' => $profile, 'entities_id' => 0, 'is_recursive' => 0]);
        if (!Session::callAsSystem(fn() => (new User())->update(['id' => $uid, 'profiles_id' => $profile, 'entities_id' => 0]))) {
            throw new RuntimeException('No se pudo fijar el perfil del cliente de demostración.');
        }
    } else {
        $uid = (int) array_key_first($users);
        if (reset($users)['comment'] !== 'Cuenta ficticia para presentar eTicket. Sin datos ni correo reales.') {
            throw new RuntimeException('Ya existe cliente.demo y no pertenece a esta demostración. No se modifica.');
        }
        // No restablecer contraseña ni cambios hechos durante una presentación.
    }
    foreach ($examples as $example) {
        // GLPI registra al operador como creador: identificar por el solicitante,
        // no por users_id_recipient, que puede cambiar durante la creación.
        $existing = array_filter((new Ticket())->find(['name' => $example['name'], 'is_deleted' => 0]), function (array $row) use ($uid): bool {
            $ticket = new Ticket();
            $ticket->getFromDB($row['id']);
            return $ticket->isUser(CommonITILActor::REQUESTER, $uid);
        });
        if (count($existing) > 1) { throw new RuntimeException('Ejemplo duplicado.'); }
        if ($existing) { echo 'Conservado #' . array_key_first($existing) . ': ' . $example['name'] . PHP_EOL; continue; }
        $id = addDemo(Ticket::class, [
            'name' => $example['name'], 'content' => $example['content'],
            'entities_id' => 0, 'type' => $example['type'],
            'urgency' => 3, 'impact' => 3, 'priority' => 3,
            'users_id_recipient' => $uid, '_users_id_requester' => $uid,
            'itilcategories_id' => demoId(ITILCategory::class, $example['category']),
        ]);
        $group = demoId(Group::class, $example['group']);
        if (!Session::callAsSystem(fn() => (new Ticket())->update([
            'id' => $id, '_groups_id_assign' => $group,
            'status' => $example['status'] === Ticket::SOLVED ? Ticket::ASSIGNED : $example['status'],
        ]))) { throw new RuntimeException('No se pudo actualizar el ticket de ejemplo.'); }
        addDemo(ITILFollowup::class, ['itemtype' => 'Ticket', 'items_id' => $id, 'content' => $example['followup'], 'is_private' => 0]);
        if (isset($example['solution'])) {
            addDemo(ITILSolution::class, ['itemtype' => 'Ticket', 'items_id' => $id, 'content' => $example['solution']]);
        }
        echo "Creado #$id: " . $example['name'] . PHP_EOL;
    }
    $DB->commit();
} catch (Throwable $error) { $DB->rollBack(); throw $error; }
echo "Demostración preparada. Usuario: cliente.demo. Contraseña local en .env.demo.\n";
