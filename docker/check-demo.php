<?php
declare(strict_types=1);
chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';
$kernel = new Glpi\Kernel\Kernel(); $kernel->boot();
global $CFG_GLPI;
if ($CFG_GLPI['language'] !== 'es_MX') { throw new RuntimeException('Idioma global incorrecto'); }
$rows = (new User())->find(['name' => 'cliente.demo', 'is_active' => 1]);
if (count($rows) !== 1) { throw new RuntimeException('Cliente de demostración no disponible'); }
$user = reset($rows); $uid = (int) $user['id'];
if ($user['language'] !== 'es_MX') { throw new RuntimeException('Idioma del cliente incorrecto'); }
$grants = (new Profile_User())->find(['users_id' => $uid]);
if (count($grants) !== 1) { throw new RuntimeException('El cliente tiene perfiles adicionales'); }
$grant = reset($grants);
$profile = new Profile(); $profile->getFromDB($grant['profiles_id']);
if ($profile->fields['name'] !== 'ETICKET Cliente externo' || $grant['is_recursive']) { throw new RuntimeException('Perfil incorrecto'); }
$_SESSION['glpiID'] = $uid;
$_SESSION['glpiactiveprofile'] = $profile->fields;
$_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpiactive_entity'] = 0;
$_SESSION['glpigroups'] = [];
Session::loadLanguage('es_MX');
$labels = Ticket::getAllStatusArray();
$visible = [];
$statuses = [];
foreach ((new Ticket())->find(['is_deleted' => 0]) as $row) {
    $ticket = new Ticket(); $ticket->getFromDB($row['id']);
    if (!$ticket->canViewItem()) { continue; }
    if (!str_starts_with($row['name'], '[DEMO]')) { throw new RuntimeException('El cliente ve un ticket ajeno a la demostración'); }
    $visible[] = (int) $row['id'];
    $statuses[] = (int) $row['status'];
    echo '#' . $row['id'] . ' ' . $row['name'] . ' | ' . $labels[$row['status']] . PHP_EOL;
}
sort($statuses);
if (count($visible) !== 3 || $statuses !== [Ticket::INCOMING, Ticket::ASSIGNED, Ticket::SOLVED]) {
    throw new RuntimeException('Se esperaban tres ejemplos: nuevo, en curso y resuelto.');
}
echo "OK demostración en español y acceso restringido.\n";
