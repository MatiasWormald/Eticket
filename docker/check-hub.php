<?php
declare(strict_types=1);
chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';
(new Glpi\Kernel\Kernel())->boot();
global $DB, $CFG_GLPI;
$checks = [
    'ocho formularios activos' => count((new Glpi\Form\Form())->find(['name' => ['LIKE', 'F0%'], 'is_active' => 1])) === 8,
    'seis unidades' => count((new Entity())->find(['entities_id' => 0, 'id' => ['>', 0]])) >= 6,
    'alumno sin visibilidad global' => false,
    'API deshabilitada' => empty($CFG_GLPI['enable_api']) && empty($CFG_GLPI['enable_hlapi']),
    'baseline registrada' => is_file(GLPI_VAR_DIR . '/_eticket-baseline.json'),
    'ocho SLA' => count((new SLA())->find(['name' => ['LIKE', 'ETICKET %']])) === 8,
    'trece grupos operacionales' => count((new Group())->find(['name' => ['HD-L1-MESA','SFL-L2','SFL-QA','SFL-PM','ODS-L2','REPOSITORIO-L2','IOT-L2','IA-L2','SECURITY-L2','PROFESORES-L3','TECHLEAD-L3','CIO-L4','CE-L5']])) === 13,
    'once perfiles institucionales' => count((new Profile())->find(['name' => ['LIKE', 'ETICKET %']])) === 11,
    'sin cuentas demo activas' => count((new User())->find(['name' => ['glpi','tech','normal','post-only'], 'is_active' => 1])) === 0,
    'sin entidades vacías' => count((new Entity())->find(['id' => ['>', 0], 'name' => ''])) === 0,
];
foreach (['bcmath','curl','dom','fileinfo','gd','intl','mbstring','mysqli','openssl','simplexml','xmlreader','xmlwriter','zlib'] as $extension) {
    $checks['extensión ' . $extension] = extension_loaded($extension);
}
$p1 = (new SLA())->find(['name' => 'ETICKET P1 TTR']);
$checks['P1 sin calendario hábil'] = $p1 && (int) reset($p1)['calendars_id'] === 0;
$profiles = (new Profile())->find(['name' => 'ETICKET Alumno Técnico']);
if ($profiles) {
    $profile = (int) array_key_first($profiles);
    $rights = (new ProfileRight())->find(['profiles_id' => $profile]);
    $checks['alumno sin visibilidad global'] = true;
    foreach ($rights as $right) {
        if ($right['name'] === 'ticket' && ((int) $right['rights'] & Ticket::READALL)) { $checks['alumno sin visibilidad global'] = false; }
        if (in_array($right['name'], ['user', 'profile', 'config', 'rule_ticket', 'plugin', 'slm']) && $right['rights']) { $checks['alumno sin visibilidad global'] = false; }
    }
}
foreach ($checks as $name => $ok) { echo ($ok ? 'OK ' : 'ERROR ') . $name . PHP_EOL; }
exit(in_array(false, $checks, true) ? 1 : 0);
