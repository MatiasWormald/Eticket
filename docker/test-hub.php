<?php
declare(strict_types=1);
// Pruebas de integración con datos sintéticos y rollback incondicional.
use Glpi\Form\Form;
use Glpi\Form\AnswersHandler\AnswersHandler;
use Glpi\Form\AccessControl\FormAccessControlManager;
use Glpi\Form\DelegationData;

chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';
$kernel = new Glpi\Kernel\Kernel();
$kernel->boot();
global $DB;
$_SESSION['glpi_currenttime'] = date('Y-m-d H:i:s');
$_SESSION['glpiactive_entity'] = 0;
$_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpigroups'] = [];
$_SESSION['glpilanguage'] = 'es_CL';

function check(bool $ok, string $message): void {
    if (!$ok) { throw new RuntimeException($message); }
    echo "OK $message\n";
}
function asUser(int $uid, string $profileName): void {
    $rows = (new Profile())->find(['name' => $profileName]);
    $profile = new Profile();
    check($rows && $profile->getFromDB(array_key_first($rows)), 'perfil de prueba disponible');
    $_SESSION['glpiID'] = $uid;
    $_SESSION['glpiname'] = 'eticket-integration';
    $_SESSION['glpiactiveprofile'] = $profile->fields;
    $_SESSION['glpiactiveentities'] = [0];
    $_SESSION['glpiactive_entity'] = 0;
    $_SESSION['glpigroups'] = [];
    unset($_SESSION['glpicronuserrunning']);
}
$DB->beginTransaction();
try {
    $users = [];
    foreach (['a', 'b', 'alumno'] as $suffix) {
        $user = new User();
        $password = bin2hex(random_bytes(24));
        $id = Session::callAsSystem(fn() => $user->add([
            'name' => 'eticket-test-' . $suffix . '-' . bin2hex(random_bytes(6)),
            'password' => $password, 'password2' => $password, 'is_active' => 1,
        ]));
        check((bool) $id, 'usuario sintético creado dentro de transacción');
        $users[$suffix] = (int) $id;
    }
    asUser($users['a'], 'ETICKET Cliente interno');
    $handler = AnswersHandler::getInstance();
    // doSaveAnswers es la misma operación usada por saveAnswers, sin abrir
    // una transacción anidada que impediría revertir toda esta prueba.
    $save = new ReflectionMethod($handler, 'doSaveAnswers');
    $cfg = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);
    $tickets = [];
    foreach ($cfg['services'] as $service) {
        $rows = (new Form())->find(['name' => $service['code'] . ' — ' . $service['name']]);
        $form = new Form();
        check($rows && $form->getFromDB(array_key_first($rows)), $service['code'] . ' disponible');
        check(!FormAccessControlManager::getInstance()->allowUnauthenticatedAccess($form), $service['code'] . ' sin acceso anónimo');
        $answers = [];
        foreach ($form->getQuestions() as $q) { $answers[$q->getID()] = 'Evidencia sintética ' . $service['code']; }
        $set = $save->invoke($handler, $form, $answers, $users['a'], new DelegationData(), []);
        $created = array_values(array_filter($set->getCreatedItems(), fn($item) => $item instanceof Ticket));
        check(count($created) === 1, $service['code'] . ' crea exactamente un ticket');
        $ticket = $created[0];
        $ticket->getFromDB($ticket->getID());
        check((int) $ticket->fields['type'] === $service['type'], $service['code'] . ' tipo correcto');
        check(str_contains($ticket->fields['content'], 'Evidencia sintética'), $service['code'] . ' conserva las respuestas');
        $groupName = $service['code'] === 'F08' ? 'SECURITY-L2' : 'HD-L1-MESA';
        $groups = (new Group())->find(['name' => $groupName]);
        check($ticket->isGroup(CommonITILActor::ASSIGN, (int) array_key_first($groups)), $service['code'] . ' asigna grupo correcto');
        check($ticket->canViewItem(), 'cliente ve su ticket');
        check((int) $ticket->fields['slas_id_tto'] > 0 && (int) $ticket->fields['slas_id_ttr'] > 0, $service['code'] . ' aplica SLA TTO/TTR');
        if ($service['code'] === 'F08') { check((int) $ticket->fields['priority'] >= 4, 'seguridad tiene prioridad mínima High'); }
        $tickets[] = $ticket->getID();
    }
    foreach ($cfg['sla'] as $sla) {
        foreach ($sla['priorities'] as $priority) {
            $ticket = new Ticket();
            $id = Session::callAsSystem(fn() => $ticket->add([
                'name' => 'Prueba SLA sintética', 'content' => 'Sin datos reales',
                'entities_id' => 0, 'type' => Ticket::INCIDENT_TYPE,
                'priority' => $priority, '_users_id_requester' => $users['a'],
            ]));
            check((bool) $id, 'ticket sintético para prioridad ' . $priority);
            $ticket->getFromDB($id);
            $expected = (new SLA())->find(['name' => 'ETICKET ' . $sla['code'] . ' TTR']);
            check((int) $ticket->fields['slas_id_ttr'] === (int) array_key_first($expected), 'prioridad ' . $priority . ' usa ' . $sla['code']);
            check(!empty($ticket->fields['time_to_resolve']), 'vencimiento calculado para ' . $sla['code']);
        }
    }
    asUser($users['b'], 'ETICKET Cliente externo');
    foreach ($tickets as $id) {
        $ticket = new Ticket(); $ticket->getFromDB($id);
        check(!$ticket->canViewItem(), 'otro cliente no ve ticket ajeno');
    }
    asUser($users['alumno'], 'ETICKET Alumno Técnico');
    $ticket = new Ticket(); $ticket->getFromDB($tickets[0]);
    check(!$ticket->canViewItem(), 'alumno no ve ticket sin asignación');
    Session::callAsSystem(fn() => (new Ticket_User())->add(['tickets_id' => $ticket->getID(), 'users_id' => $users['alumno'], 'type' => CommonITILActor::ASSIGN]));
    $ticket = new Ticket(); $ticket->getFromDB($tickets[0]);
    check($ticket->canViewItem(), 'alumno ve ticket asignado');
    check(!Session::haveRight('user', UPDATE) && !Session::haveRight('profile', UPDATE) && !Session::haveRight('config', UPDATE), 'alumno sin administración');
    echo "Integración funcional completada; se revierten todos los datos sintéticos.\n";
} finally {
    $DB->rollBack();
}
