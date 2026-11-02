<?php
declare(strict_types=1);

use Glpi\Helpdesk\Tile\GlpiPageTile;
use Glpi\Helpdesk\Tile\TilesManager;

if (PHP_SAPI !== 'cli') { exit(1); }
chdir('/var/www/html');
require 'vendor/autoload.php';
$kernel = new Glpi\Kernel\Kernel(); $kernel->boot();
global $DB;
$_SESSION['glpi_currenttime'] = date('Y-m-d H:i:s');
$_SESSION['glpiactive_entity'] = 0;
$_SESSION['glpiactiveentities'] = [0];
$_SESSION['glpiname'] = 'eticket-client-portal';
$_SESSION['glpiID'] = 0;
$_SESSION['glpicronuserrunning'] = 'eticket-client-portal';

$DB->beginTransaction();
try {
    Session::callAsSystem(function (): void {
        foreach ([
            'ETICKET Portal Agente' => Ticket::READALL,
            'ETICKET Portal Gestor' => Ticket::READALL | CREATE | UPDATE | DELETE | Ticket::ASSIGN,
        ] as $name => $ticketRights) {
            $profile = new Profile();
            $rows = $profile->find(['name' => $name]);
            if (count($rows) > 1) throw new RuntimeException('Perfil ambiguo: ' . $name);
            $id = $rows ? (int) array_key_first($rows) : $profile->add(['name' => $name, 'interface' => 'central', 'is_default' => 0]);
            if (!$id) throw new RuntimeException('No se pudo crear el perfil ' . $name);
            foreach (['ticket' => $ticketRights, 'followup' => ITILFollowup::SEEPUBLIC | ITILFollowup::SEEPRIVATE | ITILFollowup::ADDALLITEM, 'document' => Document_Item::SEEPRIVATE] as $right => $value) {
                $rows = (new ProfileRight())->find(['profiles_id' => $id, 'name' => $right]);
                $item = new ProfileRight();
                $ok = $rows ? $item->update(['id' => array_key_first($rows), 'rights' => $value]) : $item->add(['profiles_id' => $id, 'name' => $right, 'rights' => $value]);
                if (!$ok) throw new RuntimeException('No se pudo configurar el derecho ' . $right);
            }
            if ($name === 'ETICKET Portal Gestor') {
                // The gestor is the system administrator, as explicitly requested.
                // Copy the native Super-Admin rights, including forms, users and profiles.
                foreach ((new ProfileRight())->find(['profiles_id' => 4]) as $source) {
                    $existing = (new ProfileRight())->find(['profiles_id' => $id, 'name' => $source['name']]);
                    $right = new ProfileRight();
                    $ok = $existing
                        ? $right->update(['id' => array_key_first($existing), 'rights' => $source['rights']])
                        : $right->add(['profiles_id' => $id, 'name' => $source['name'], 'rights' => $source['rights']]);
                    if (!$ok) throw new RuntimeException('No se pudo configurar la administración del gestor.');
                }
            }
        }
        foreach ((new User())->find(['name' => 'tecnico.demo']) as $retired) {
            if (!$retired['is_deleted'] && !(new User())->delete(['id' => $retired['id']], false)) throw new RuntimeException('No se pudo retirar la cuenta de técnico.');
            if ($retired['is_active'] && !(new User())->update(['id' => $retired['id'], 'is_active' => 0])) throw new RuntimeException('No se pudo desactivar la cuenta de técnico.');
        }
        Config::setConfigurationValues('core', [
            'text_login' => '<h1>eTicket · Tech Hub</h1><p>Tu centro de ayuda. Ingresa para enviar una solicitud, consultar su estado o responder al equipo.</p><p>No tienes cuenta o no puedes ingresar: contacta a la persona que te dio acceso al servicio.</p>',
            'display_login_source' => 0,
        ]);
        $entity = new Entity();
        if (!$entity->update([
            'id' => 0, '_custom_helpdesk_home_title' => '¿En qué podemos ayudarte?',
            'custom_helpdesk_home_title' => Entity::HELPDESK_TITLE_CUSTOM,
            'enable_helpdesk_home_search_bar' => 0,
            'enable_helpdesk_service_catalog' => 1,
        ])) { throw new RuntimeException('No se pudo configurar la portada.'); }

        foreach (['ETICKET Cliente interno', 'ETICKET Cliente externo'] as $name) {
            $rows = (new Profile())->find(['name' => $name]);
            if (count($rows) !== 1) { throw new RuntimeException('Perfil cliente no disponible.'); }
            $profile = Profile::getById((int) array_key_first($rows));
            $tiles = [
                [GlpiPageTile::PAGE_SERVICE_CATALOG, 'Crear una solicitud', 'Cuéntanos qué necesitas. Elige el servicio y completa un formulario breve.', 'request-support'],
                [GlpiPageTile::PAGE_ALL_TICKETS, 'Mis solicitudes', 'Consulta avances, responde al equipo y revisa las soluciones de tus solicitudes.', 'tickets'],
            ];
            foreach ($tiles as [$page, $title, $description, $illustration]) {
                $found = false;
                foreach (TilesManager::getInstance()->getTilesForItem($profile) as $tile) {
                    if ($tile instanceof GlpiPageTile && $tile->fields['page'] === $page) { $found = true; break; }
                }
                if (!$found) {
                    TilesManager::getInstance()->addTile($profile, GlpiPageTile::class, compact('page', 'title', 'description', 'illustration'));
                }
            }
        }
    });
    $DB->commit();
} catch (Throwable $error) { $DB->rollBack(); throw $error; }

$plugin = new Plugin();
$plugin->checkPluginState('etickethub');
if (!$plugin->getFromDBbyDir('etickethub')) { throw new RuntimeException('Plugin eTicket no encontrado.'); }
if (!$plugin->isInstalled('etickethub')) {
    $plugin->install($plugin->getID());
    if (!$plugin->isInstalled('etickethub')) { throw new RuntimeException('No se pudo instalar la navegación eTicket.'); }
}
if (!$plugin->isActivated('etickethub') && !$plugin->activate($plugin->getID())) {
    throw new RuntimeException('No se pudo activar la navegación eTicket.');
}
echo "OK portada de clientes y navegación eTicket configuradas.\n";
