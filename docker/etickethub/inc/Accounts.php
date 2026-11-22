<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\Response;
use Glpi\Security\TOTPManager;

trait EticketPortalAccounts {
    private const PORTAL_PROFILES = [
        'cliente' => 'ETICKET Cliente externo',
        'agente' => 'ETICKET Portal Agente',
        'gestor' => 'ETICKET Portal Gestor',
    ];

    private static function staff(): bool { return Session::getCurrentInterface() === 'central'; }

    private static function admin(): bool {
        return self::staff() && Session::haveRight('config', UPDATE) && Session::haveRight('profile', CREATE);
    }

    private static function user(): ?array {
        $id = (int) Session::getLoginUserID();
        if (!$id) return null;
        $u = new User();
        if (!$u->getFromDB($id) || !$u->fields['is_active'] || $u->fields['is_deleted']) {
            Session::destroy(); return null;
        }
        $manage = self::staff() && Session::haveRight('ticket', UPDATE) && Session::haveRight('ticket', DELETE);
        return [
            'id' => $id, 'name' => trim($u->fields['firstname'] . ' ' . $u->fields['realname']) ?: $u->fields['name'],
            'login' => $u->fields['name'], 'role' => $manage ? 'gestor' : (self::staff() ? 'agente' : 'cliente'),
            'profile' => $_SESSION['glpiactiveprofile']['name'] ?? '',
            'can_create' => !self::staff() && Ticket::canCreate(), 'can_manage' => $manage,
            'can_admin' => self::admin(),
            'mfa_enabled' => (new TOTPManager())->is2FAEnabled($id),
            'admin_paths' => self::admin() ? ['home' => '/front/central.php', 'forms' => Glpi\Form\Form::getSearchURL(false), 'profiles' => Profile::getSearchURL(false), 'users' => User::getSearchURL(false)] : null,
        ];
    }

    private static function name(int $uid): string {
        if (!$uid) return 'Equipo de soporte';
        $u = new User();
        return $u->getFromDB($uid) ? (trim($u->fields['firstname'] . ' ' . $u->fields['realname']) ?: $u->fields['name']) : 'Equipo de soporte';
    }

    private static function accountEmail(int $id): ?string {
        $addresses = (new UserEmail())->find(['users_id' => $id, 'is_default' => 1]);
        $email = reset($addresses)['email'] ?? '';
        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    private static function portalUsers(): array {
        $users = [];
        if (!Session::haveAccessToEntity(0) || !User::canView()) return $users;
        foreach (self::PORTAL_PROFILES as $role => $profile) {
            $profileId = array_key_first((new Profile())->find(['name' => $profile]));
            if (!$profileId) continue;
            foreach ((new Profile_User())->find(['profiles_id' => $profileId, 'entities_id' => 0]) as $grant) {
                $id = (int) $grant['users_id'];
                $user = User::getById($id);
                if (!$user || $user->fields['is_deleted'] || !$user->can($id, READ)) continue;
                $emails = (new UserEmail())->find(['users_id' => $id, 'is_default' => 1]);
                $users[$id] = ['id' => $id, 'name' => self::name($id), 'email' => reset($emails)['email'] ?? '',
                    'login' => $user->fields['name'], 'active' => (bool) $user->fields['is_active'], 'role' => $role,
                    'tier' => $role === 'agente' ? self::agentTier($id) : null];
            }
        }
        return $users;
    }

    private static function saveUser(array $body): array {
        $role = $body['role'] ?? '';
        if (!is_string($role) || !isset(self::PORTAL_PROFILES[$role])) self::fail('Selecciona un tipo de cuenta.');
        $entity = 0;
        if (!Session::haveAccessToEntity($entity)) self::fail('Cambia a la entidad raíz para administrar cuentas del portal.', 403);
        $id = (int) ($body['id'] ?? 0);
        $existing = $id ? (self::portalUsers()[$id] ?? null) : null;
        $login = self::text($body, 'login', 3, 60);
        $email = strtolower(self::text($body, 'email', 3, 255));
        if (!preg_match('/^[a-z0-9._-]+$/D', $login) || !filter_var($email, FILTER_VALIDATE_EMAIL)) self::fail('Revisa el usuario y correo.');
        self::checkAvailableEmail($email, $id);
        if ($id && (!$existing || $existing['login'] !== $login)) self::fail('Cuenta no disponible.', 404);
        $active = !$id || ($body['active'] ?? false) === true;
        if ($id === (int) Session::getLoginUserID() && (!$active || $role !== 'gestor')) self::fail('No puedes cambiar tu propio acceso.');
        $profile = array_key_first((new Profile())->find(['name' => self::PORTAL_PROFILES[$role]]));
        if (!$profile) self::fail('El perfil de GLPI no está disponible.', 503);
        $levels = self::tierGroups();
        $tier = (int) ($body['tier'] ?? 0);
        $groups = array_filter($levels, fn($group) => $group['level'] === $tier);
        if ($role === 'agente' && !$groups) self::fail('Selecciona un tier disponible.');
        $user = new User();
        $emailId = $id ? (int) array_key_first((new UserEmail())->find(['users_id' => $id, 'is_default' => 1])) : 0;
        $input = ['name' => $login, 'firstname' => self::text($body, 'name', 3, 120), 'realname' => '',
            '_useremails' => [$emailId => $email], '_default_email' => $emailId, 'is_active' => (int) $active, 'entities_id' => $entity];
        if ($id) {
            if (!$user->can($id, UPDATE) || !$user->update(['id' => $id] + $input)) self::fail('GLPI no pudo actualizar la cuenta.', 422);
        } else {
            $createContext = $input + ['_profiles_id' => $profile, '_entities_id' => $entity];
            if (!$user->can(-1, CREATE, $createContext)) self::fail('Tu perfil no permite crear cuentas.', 403);
            $password = $body['password'] ?? '';
            if (!is_string($password) || strlen($password) < 8 || strlen($password) > 128) self::fail('Revisa la contraseña temporal.');
            $id = (int) $user->add($input + ['password' => $password, 'password2' => $password]);
            if (!$id) self::fail('GLPI no pudo crear la cuenta. Revisa si el usuario ya existe.', 422);
        }
        if (!$existing || $existing['role'] !== $role) {
            $profileNames = array_column((new Profile())->find(), 'name', 'id');
            foreach ((new Profile_User())->find(['users_id' => $id, 'entities_id' => $entity]) as $grant) {
                if ((!$existing || in_array($profileNames[$grant['profiles_id']] ?? '', self::PORTAL_PROFILES, true))
                    && !(new Profile_User())->delete(['id' => $grant['id']], true)) self::fail('No se pudo actualizar el perfil anterior.', 422);
            }
            if (!(new Profile_User())->add(['users_id' => $id, 'profiles_id' => $profile, 'entities_id' => $entity, 'is_recursive' => 0])
                || !$user->update(['id' => $id, 'profiles_id' => $profile])) self::fail('GLPI no pudo asignar el perfil.', 422);
        }
        if (!$existing || $existing['tier'] !== ($role === 'agente' ? $tier : null)) {
            foreach ((new Group_User())->find(['users_id' => $id]) as $membership) {
                if (isset($levels[$membership['groups_id']]) && !(new Group_User())->delete(['id' => $membership['id']], true)) self::fail('No se pudo actualizar el grupo anterior.', 422);
            }
            if ($role === 'agente' && !(new Group_User())->add(['users_id' => $id, 'groups_id' => array_key_first($groups)])) self::fail('GLPI no pudo asignar el grupo.', 422);
        }
        return self::portalUsers()[$id] ?? throw new RuntimeException('No se pudo volver a leer la cuenta.');
    }

    private static function profileInput(array $body, int $id): array {
        $name = self::text($body, 'name', 3, 120);
        $rawEmail = $body['email'] ?? '';
        if (!is_string($rawEmail)) self::fail('Revisa el correo.');
        $email = mb_strtolower(trim($rawEmail));
        if (strlen($email) > 255 || ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL))) self::fail('Revisa el correo.');
        if ($email !== '') self::checkAvailableEmail($email, $id);
        $emailId = $id ? (int) array_key_first((new UserEmail())->find(['users_id' => $id, 'is_default' => 1])) : 0;
        $input = ['firstname' => $name, 'realname' => ''];
        if ($emailId || $email !== '') $input += ['_useremails' => [$emailId => $email], '_default_email' => $emailId];
        return $input;
    }

    private static function emailOwners(string $email): array {
        $owners = [];
        foreach ((new UserEmail())->find(['email' => $email]) as $address) {
            $id = (int) $address['users_id'];
            $user = User::getById($id);
            if ($user && !$user->fields['is_deleted']) $owners[$id] = $user;
        }
        return $owners;
    }

    private static function checkAvailableEmail(string $email, int $id): void {
        $owners = self::emailOwners($email);
        unset($owners[$id]);
        if ($owners) self::fail('El correo ya está asociado a una cuenta.', 409);
    }

    private static function registerClient(array $body): array {
        if (($body['consent'] ?? false) !== true) self::fail('Acepta la política de privacidad.');
        self::text($body, 'email', 3, 255);
        $password = $body['password'] ?? '';
        if (!is_string($password) || strlen($password) < 8 || strlen($password) > 128) self::fail('La contraseña debe tener entre 8 y 128 caracteres.');
        $input = self::profileInput($body, 0);
        $profile = array_key_first((new Profile())->find(['name' => self::PORTAL_PROFILES['cliente']]));
        if (!$profile) self::fail('El registro no está disponible en este momento.', 503);
        return Session::callAsSystem(function () use ($input, $profile, $password): array {
            $user = new User();
            $username = 'cliente.' . bin2hex(random_bytes(12));
            $id = (int) $user->add($input + ['name' => $username, 'password' => $password,
                'password2' => $password, 'is_active' => 1]);
            if (!$id) self::fail('GLPI no pudo crear la cuenta. Revisa los requisitos de la contraseña.', 422);
            foreach ((new Profile_User())->find(['users_id' => $id]) as $grant) {
                if (!(new Profile_User())->delete(['id' => $grant['id']], true)) self::fail('GLPI no pudo configurar la cuenta.', 422);
            }
            if (!(new Profile_User())->add(['users_id' => $id, 'profiles_id' => $profile, 'entities_id' => 0, 'is_recursive' => 0])
                || !$user->update(['id' => $id, 'profiles_id' => $profile, 'entities_id' => 0])) self::fail('GLPI no pudo asignar el perfil de cliente.', 422);
            self::assignRegisteredMfa($id, self::registeredMfaGroup());
            return ['user_id' => $id, 'username' => $username, 'auth_type' => Auth::DB_GLPI, 'noauto' => true, 'remember_me' => false];
        });
    }

    private static function mayDeleteSelf(int $id): bool {
        if (self::staff()) return false;
        $grants = (new Profile_User())->find(['users_id' => $id]);
        if (!$grants) return false;
        foreach ($grants as $grant) {
            $profile = Profile::getById((int) $grant['profiles_id']);
            if (!$profile || !in_array($profile->fields['name'], ['ETICKET Cliente externo', 'ETICKET Cliente interno'], true)) return false;
        }
        return true;
    }

    private static function ownProfile(array $session): array {
        $id = $session['id'];
        $emails = (new UserEmail())->find(['users_id' => $id, 'is_default' => 1]);
        return [
            'name' => $session['name'], 'login' => $session['login'], 'role' => $session['role'],
            'email' => reset($emails)['email'] ?? '', 'tier' => $session['role'] === 'agente' ? self::agentTier($id) : null,
            'can_delete' => self::mayDeleteSelf($id),
            'mfa_enabled' => $session['mfa_enabled'],
        ];
    }

    private static function retireUser(User $user): void {
        $input = ['id' => $user->getID()];
        if (!$user->delete($input, true) || User::getById((int) $input['id'])
            || (new UserEmail())->find(['users_id' => $input['id']])) self::fail('GLPI no pudo eliminar definitivamente la cuenta.', 422);
    }

    private static function accountAction(string $action, array $body, array $session): Response {
        if ($action === 'profile') return self::json(['profile' => self::ownProfile($session)]);
        if ($action === 'save_profile' || $action === 'delete_profile') {
            $id = $session['id'];
            if ($action === 'delete_profile' && !self::mayDeleteSelf($id)) self::fail('Tu perfil no permite eliminar tu cuenta.', 403);
            self::reauthenticateUsers($body);
            $user = User::getById($id);
            if ($action === 'delete_profile') {
                if (($body['confirm'] ?? null) !== true) self::fail('Confirma que quieres eliminar tu cuenta.');
                Session::callAsSystem(fn() => self::retireUser($user));
                Session::destroy();
                return self::json(['ok' => true]);
            }
            if (!$user->update(['id' => $id] + self::profileInput($body, $id))) self::fail('GLPI no pudo guardar el perfil.', 422);
            return self::json(['profile' => self::ownProfile(self::user())]);
        }
        if (in_array($action, ['users', 'save_user', 'delete_user', 'reauth_users'], true)) {
            if (!self::admin()) self::fail('Solo el gestor administrador puede administrar cuentas.', 403);
            if ($action === 'reauth_users') { self::reauthenticateUsers($body); return self::json(['ok' => true]); }
            if (User::isUserReauthenticationNeeded()) self::fail('Confirma tu identidad para administrar cuentas.', 428);
            if ($action === 'delete_user') {
                $id = (int) ($body['id'] ?? 0);
                if ($id === $session['id']) self::fail('No puedes eliminar tu propia cuenta.', 403);
                if (!isset(self::portalUsers()[$id])) self::fail('Cuenta no disponible.', 404);
                $user = User::getById($id);
                if (!$user->can($id, PURGE)) self::fail('Tu perfil no permite eliminar esta cuenta definitivamente.', 403);
                self::retireUser($user);
                return self::json(['ok' => true]);
            }
            return $action === 'users' ? self::json(['users' => array_values(self::portalUsers())]) : self::json(['user' => self::saveUser($body)]);
        }
        self::fail('Ruta de cuentas no encontrada.', 404);
    }
}
