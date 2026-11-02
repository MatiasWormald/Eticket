<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
chdir('/var/www/html'); require 'vendor/autoload.php'; $kernel = new Glpi\Kernel\Kernel(); $kernel->boot();
global $DB, $CFG_GLPI;
$_SESSION['glpi_currenttime'] = date('Y-m-d H:i:s');
$_SESSION['glpiactive_entity'] = 0; $_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpiname'] = 'eticket-portal-seed'; $_SESSION['glpiID'] = 0;
$_SESSION['glpicronuserrunning'] = 'eticket-portal-seed';
$DB->beginTransaction();
try {
    Session::callAsSystem(function () use ($CFG_GLPI): void {
        foreach ([
            ['agente.demo', 'GLPI_DEMO_AGENT_PASSWORD', 'ETICKET Portal Agente', 'Agente'],
            ['gestor.demo', 'GLPI_DEMO_MANAGER_PASSWORD', 'ETICKET Portal Gestor', 'Gestor'],
            ['cliente2.demo', 'GLPI_DEMO_OTHER_PASSWORD', 'ETICKET Cliente externo', 'Otro cliente'],
        ] as [$name, $key, $role, $first]) {
            $password = getenv($key) ?: '';
            if ($password !== '123' && strlen($password) < 20) throw new RuntimeException('Ejecuta scripts/portal-demo.ps1.');
            $marker = 'Cuenta ficticia eTicket portal: ' . $name;
            $users = (new User())->find(['name' => $name]);
            if (count($users) > 1 || ($users && reset($users)['comment'] !== $marker)) throw new RuntimeException('Cuenta ajena a la demo: ' . $name);
            if ($users) { echo "Conservado $name\n"; continue; }
            $profiles = (new Profile())->find(['name' => $role]);
            if (count($profiles) !== 1) throw new RuntimeException('Perfil no disponible: ' . $role);
            $pid = (int) array_key_first($profiles);
            $uid = (new User())->add(['name' => $name, 'password' => $password, 'password2' => $password, 'is_active' => 1,
                'firstname' => $first, 'realname' => 'Demostración', 'language' => $CFG_GLPI['language'], 'comment' => $marker]);
            if (!$uid) throw new RuntimeException('No se pudo crear ' . $name);
            foreach ((new Profile_User())->find(['users_id' => $uid]) as $grant) {
                if (!(new Profile_User())->delete(['id' => $grant['id']], true)) throw new RuntimeException('No se pudo limitar ' . $name);
            }
            if (!(new Profile_User())->add(['users_id' => $uid, 'profiles_id' => $pid, 'entities_id' => 0, 'is_recursive' => $name === 'cliente2.demo' ? 0 : 1])
                || !(new User())->update(['id' => $uid, 'profiles_id' => $pid, 'entities_id' => 0])) throw new RuntimeException('No se pudo configurar ' . $name);
            echo "Creado $name: $role\n";
        }
    });
    $DB->commit();
} catch (Throwable $error) { $DB->rollBack(); throw $error; }
