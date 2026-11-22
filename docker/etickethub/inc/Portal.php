<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Glpi\Security\ReAuth\PasswordReAuthStrategy;
use Glpi\Security\ReAuth\TOTPReAuthStrategy;
use Glpi\Security\ReAuth\ReAuthManager;
use Glpi\Security\TOTPManager;
use Glpi\Exception\AuthenticationFailedException;

final class EticketPortalError extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 400) { parent::__construct($message); }
}

final class EticketPortal {
    private const MFA_COOKIE = 'eticket_mfa_remembered';
    private const MFA_REMEMBER_SECONDS = 86400;
    private const PORTAL_PROFILES = [
        'cliente' => 'ETICKET Cliente externo',
        'agente' => 'ETICKET Portal Agente',
        'gestor' => 'ETICKET Portal Gestor',
    ];
    private static function fail(string $message, int $status = 400): never { throw new EticketPortalError($message, $status); }
    private static function plain(?string $html): string {
        return trim(html_entity_decode(strip_tags(str_replace(['</p>', '</h3>', '<br>', '<br/>', '<br />', '</div>'], "\n", $html ?? '')), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
    private static function html(string $text): string { return '<p>' . nl2br(htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')) . '</p>'; }
    private static function text(array $body, string $key, int $min, int $max): string {
        if (!isset($body[$key]) || !is_string($body[$key])) self::fail('Completa el campo ' . $key . '.');
        $text = trim($body[$key]);
        if (mb_strlen($text) < $min || mb_strlen($text) > $max) self::fail('Revisa el campo ' . $key . ' (' . $min . ' a ' . $max . ' caracteres).');
        return $text;
    }
    private static function csrf(): string {
        return $_SESSION['eticket_csrf'] ??= bin2hex(random_bytes(32));
    }
    private static function staff(): bool { return Session::getCurrentInterface() === 'central'; }
    private static function admin(): bool {
        return self::staff() && Session::haveRight('config', UPDATE) && Session::haveRight('profile', CREATE);
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
    private static function tierGroups(): array {
        static $levels = null;
        if ($levels !== null) return $levels;
        $config = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);
        $names = [4 => ['HD-L1-MESA'], 3 => $config['unit_groups'], 2 => ['TECHLEAD-L3', 'PROFESORES-L3'], 1 => ['CIO-L4', 'CE-L5']];
        $levels = [];
        foreach ($names as $level => $groups) {
            foreach ((new Group())->find(['name' => $groups, 'entities_id' => 0]) as $group) {
                $levels[(int) $group['id']] = ['level' => $level, 'group_label' => $group['name']];
            }
        }
        return $levels;
    }
    private static function ticketTier(Ticket $ticket): ?array {
        $levels = self::tierGroups();
        $tier = null;
        foreach ($ticket->getGroups(CommonITILActor::ASSIGN) as $assignment) {
            $group = $levels[$assignment['groups_id']] ?? null;
            if ($group && (!$tier || $group['level'] < $tier['level'])) $tier = $group;
        }
        return $tier;
    }
    private static function transfer(Ticket $ticket, int $target, string $reason): void {
        $groups = self::tierGroups();
        $targets = array_filter($groups, fn($group) => $group['level'] === $target);
        if ($target === 3) {
            $category = ITILCategory::getById($ticket->fields['itilcategories_id']);
            $responsible = (int) ($category->fields['groups_id'] ?? 0);
            if (isset($targets[$responsible])) $targets = [$responsible => $targets[$responsible]];
        }
        if (!$targets) self::fail('No hay un grupo de GLPI para ese tier.', 422);
        $groupId = array_key_first($targets);
        foreach ($ticket->getGroups(CommonITILActor::ASSIGN) as $assignment) {
            if ((int) $assignment['groups_id'] === $groupId) continue;
            if (isset($groups[$assignment['groups_id']]) && !(new Group_Ticket())->delete(['id' => $assignment['id']], true)) self::fail('GLPI no pudo retirar la asignación anterior.', 422);
        }
        if (!$ticket->isGroup(CommonITILActor::ASSIGN, $groupId)
            && !(new Group_Ticket())->add(['tickets_id' => $ticket->getID(), 'groups_id' => $groupId, 'type' => CommonITILActor::ASSIGN])) self::fail('GLPI no pudo asignar el grupo.', 422);
        if (!(new ITILFollowup())->add(['itemtype' => 'Ticket', 'items_id' => $ticket->getID(),
            'content' => self::html('Derivación a ' . $targets[$groupId]['group_label'] . ': ' . $reason), 'is_private' => 1])) self::fail('GLPI no pudo guardar el motivo.', 422);
    }
    private static function agentTier(int $id): ?int {
        $levels = self::tierGroups();
        foreach ((new Group_User())->find(['users_id' => $id]) as $membership) {
            if (isset($levels[$membership['groups_id']])) return $levels[$membership['groups_id']]['level'];
        }
        return null;
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
    private static function reauthenticateUsers(array $body): void {
        $manager = ReAuthManager::getInstance();
        if ($manager->isReAuthenticated()) return;
        $totp = $manager->isSelectedStrategy(TOTPReAuthStrategy::class);
        if (!$totp && !$manager->isSelectedStrategy(PasswordReAuthStrategy::class)) self::fail('Confirma tu identidad desde GLPI.', 403);
        if (($_SESSION['eticket_reauth_retry'] ?? 0) > time()) self::fail('Espera unos segundos antes de volver a intentar.', 429);
        $password = $body['password'] ?? '';
        if (!is_string($password) || $password === '' || strlen($password) > 4096) self::fail($totp ? 'Ingresa el código de tu autenticador.' : 'Ingresa tu contraseña.');
        $input = $totp ? ['totp_code' => [$password]] : ['user_input' => $password];
        if (!$manager->verify(new Request([], $input))) {
            $_SESSION['eticket_reauth_retry'] = time() + 5;
            self::fail($totp ? 'El código de tu autenticador no es válido.' : 'La contraseña no es correcta.', 403);
        }
        $manager->authenticate();
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
    private static function registeredMfaGroup(): int {
        $group = new Group();
        $criteria = ['name' => 'Eticket - Registro con 2FA', 'entities_id' => 0];
        $rows = $group->find($criteria);
        if (count($rows) > 1) throw new RuntimeException('El grupo de verificación de Eticket es ambiguo.');
        if ($rows) {
            $row = reset($rows);
            if (!(int) $row['2fa_enforced'] && !$group->update(['id' => $row['id'], '2fa_enforced' => 1])) throw new RuntimeException('No se pudo aplicar 2FA al grupo.');
            return (int) $row['id'];
        }
        $id = $group->add($criteria + ['2fa_enforced' => 1, 'is_requester' => 0, 'is_assign' => 0, 'is_watcher' => 0, 'is_notify' => 0]);
        if (!$id) throw new RuntimeException('No se pudo crear el grupo de verificación.');
        return (int) $id;
    }
    private static function assignRegisteredMfa(int $id, int $groupId): void {
        $membership = new Group_User();
        $input = ['users_id' => $id, 'groups_id' => $groupId];
        if (!$membership->find($input) && !$membership->add($input)) throw new RuntimeException('No se pudo aplicar 2FA a la cuenta.');
    }
    public static function configureRegisteredMfa(): void {
        $groupId = self::registeredMfaGroup();
        foreach ((new User())->find(['name' => ['LIKE', 'cliente.%'], 'is_deleted' => 0]) as $row) {
            if (preg_match('/^cliente\.[a-f0-9]{24}$/D', $row['name'])) self::assignRegisteredMfa((int) $row['id'], $groupId);
        }
    }
    private static function pendingMfa(): ?array {
        $pending = $_SESSION['eticket_mfa'] ?? null;
        if (!$pending || $pending['expires'] <= time()) {
            unset($_SESSION['eticket_mfa']);
            return null;
        }
        return $pending;
    }
    private static function publicMfa(?array $pending): ?array {
        if (!$pending) return null;
        if (isset($pending['email'])) {
            [$local, $domain] = explode('@', $pending['email'], 2);
            return ['method' => 'email', 'destination' => mb_substr($local, 0, 1) . '***@' . $domain,
                'retry_in' => max(0, $pending['sent_at'] + 60 - time())];
        }
        return ['setup' => isset($pending['secret']), 'secret' => $pending['secret'] ?? null, 'account' => $pending['username']];
    }
    private static function accountEmail(int $id): ?string {
        $addresses = (new UserEmail())->find(['users_id' => $id, 'is_default' => 1]);
        $email = reset($addresses)['email'] ?? '';
        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }
    private static function mailCodeHash(string $code, array $pending): string {
        $key = (new GLPIKey())->get();
        if (!$key) self::fail('La verificación por correo no está disponible.', 503);
        return hash_hmac('sha256', 'eticket-mail:' . $pending['identity']['user_id'] . ':' . $pending['nonce'] . ':' . $code, $key);
    }
    private static function sendMailCode(array $pending): array {
        global $CFG_GLPI;
        $sender = ($CFG_GLPI['from_email'] ?? '') ?: ($CFG_GLPI['admin_email'] ?? '');
        if (!filter_var($sender, FILTER_VALIDATE_EMAIL) || (int) $CFG_GLPI['smtp_mode'] === MAIL_MAIL || empty($CFG_GLPI['smtp_host'])) {
            self::fail('El servidor SMTP de Eticket aún no está configurado en GLPI.', 503);
        }
        $code = (string) random_int(100000, 999999);
        try {
            $mailer = new GLPIMailer();
            $mailer->getEmail()->from($sender)->to($pending['email'])->subject('Código de acceso a Eticket')
                ->text("Tu código de acceso a Eticket es $code. Vence en 5 minutos. Si no lo solicitaste, puedes ignorar este mensaje.");
            if (!$mailer->send()) self::fail('No pudimos enviar el código. Intenta nuevamente o contacta a soporte.', 503);
        } catch (Symfony\Component\Mailer\Exception\TransportExceptionInterface) {
            self::fail('No pudimos enviar el código. Intenta nuevamente o contacta a soporte.', 503);
        }
        $pending['nonce'] = bin2hex(random_bytes(16));
        $pending['code_hash'] = self::mailCodeHash($code, $pending);
        $pending['expires'] = time() + 300;
        $pending['sent_at'] = time();
        return $pending;
    }
    private static function mfaMarker(User $user, int $expires, ?string $email): ?string {
        $key = (new GLPIKey())->get();
        if (!$key || (!$email && empty($user->fields['2fa']))) return null;
        $signature = hash_hmac('sha256', json_encode([
            'eticket-mfa-v2', (int) $user->getID(), $expires, $user->fields['password'] ?? '', $user->fields['2fa'] ?? '', $email,
        ], JSON_THROW_ON_ERROR), $key);
        return $expires . '.' . $signature;
    }
    private static function remembersMfa(User $user, ?string $email): bool {
        $token = $_COOKIE[self::MFA_COOKIE] ?? '';
        if (!is_string($token) || !preg_match('/^([0-9]{1,10})\.[a-f0-9]{64}$/D', $token, $parts)) return false;
        $expires = (int) $parts[1];
        $now = time();
        if ($expires <= $now || $expires > $now + self::MFA_REMEMBER_SECONDS) return false;
        $expected = self::mfaMarker($user, $expires, $email);
        return $expected !== null && hash_equals($expected, $token);
    }
    private static function rememberMfa(Response $response, User $user, ?string $email): void {
        $expires = time() + self::MFA_REMEMBER_SECONDS;
        $token = self::mfaMarker($user, $expires, $email);
        if ($token !== null) {
            $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
                || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
            $response->headers->setCookie(Cookie::create(self::MFA_COOKIE, $token, $expires, '/api', null, $https, true, false, Cookie::SAMESITE_STRICT));
        }
    }
    private static function completeLogin(array $identity, array $backupCodes = []): Response {
        unset($_SESSION['eticket_mfa']);
        $_SESSION['mfa_pre_auth'] = $identity;
        $_SESSION['mfa_success'] = true;
        if (!(new Auth())->login('', '', true, false) || !($user = self::user())) self::fail('La cuenta no tiene acceso al portal.', 403);
        $_SESSION['eticket_csrf'] = bin2hex(random_bytes(32));
        return self::json(['user' => $user, 'csrf' => self::csrf(), 'backup_codes' => $backupCodes]);
    }
    private static function verifyLogin(array $body): Response {
        $pending = self::pendingMfa();
        if (!$pending || self::user()) self::fail('La verificación expiró. Vuelve a iniciar sesión.', 409);
        $identity = $pending['identity'];
        $id = $identity['user_id'];
        $user = User::getById($id);
        if (!$user || !$user->fields['is_active'] || $user->fields['is_deleted']) self::fail('La cuenta no tiene acceso al portal.', 403);
        $code = self::text($body, 'code', 6, 64);
        $totp = new TOTPManager();
        try { $totp->checkMFARateLimit($id); }
        catch (AuthenticationFailedException) { self::fail('Demasiados intentos. Vuelve a intentarlo más tarde.', 429); }
        $backupCodes = [];
        if (isset($pending['email'])) {
            if (self::accountEmail($id) !== $pending['email']) {
                unset($_SESSION['eticket_mfa']);
                self::fail('El correo cambió. Vuelve a iniciar sesión.', 409);
            }
            if (!ctype_digit($code) || strlen($code) !== 6 || !hash_equals($pending['code_hash'], self::mailCodeHash($code, $pending))) {
                self::fail('El código por correo no es válido.', 403);
            }
        } elseif (isset($pending['secret'])) {
            if ($totp->is2FAEnabled($id)) {
                unset($_SESSION['eticket_mfa']);
                self::fail('La verificación ya fue configurada. Vuelve a ingresar.', 409);
            }
            $algorithm = $totp->verifyCodeForSecret($code, $pending['secret']);
            if (!$algorithm) self::fail('El código no es válido. Usa el código actual de tu aplicación.', 403);
            if (!$totp->setSecretForUser($id, $pending['secret'], $algorithm)) self::fail('No pudimos activar la verificación.', 422);
            $backupCodes = $totp->regenerateBackupCodes($id);
        } elseif (!($totp->verifyCodeForUser($code, $id) || $totp->verifyBackupCodeForUser($code, $id))) {
            self::fail('El código no es válido. Revisa tu aplicación o tu código de recuperación.', 403);
        }
        $totp->clearMFAFailures($id);
        $response = self::completeLogin($identity, $backupCodes);
        self::rememberMfa($response, User::getById($id), $pending['email'] ?? null);
        return $response;
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
    private static function ticket(int $id): Ticket {
        $t = new Ticket();
        if ($id < 1 || !$t->getFromDB($id) || $t->fields['is_deleted'] || !$t->can($id, READ)) self::fail('La solicitud no existe o no tienes acceso.', 404);
        return $t;
    }
    private static function name(int $uid): string {
        if (!$uid) return 'Equipo de soporte';
        $u = new User();
        return $u->getFromDB($uid) ? (trim($u->fields['firstname'] . ' ' . $u->fields['realname']) ?: $u->fields['name']) : 'Equipo de soporte';
    }
    private static function summary(Ticket $t): array {
        $f = $t->fields;
        $statuses = [1 => 'Recibida', 2 => 'En curso', 3 => 'Planificada', 4 => 'En espera', 5 => 'Resuelta', 6 => 'Cerrada'];
        return ['id' => (int) $t->getID(), 'title' => self::plain($f['name']), 'status' => (int) $f['status'],
            'status_label' => $statuses[(int) $f['status']] ?? 'Recibida', 'created_at' => $f['date'], 'updated_at' => $f['date_mod'],
            'type' => (int) $f['type'], 'urgency' => (int) $f['urgency'], 'category_id' => (int) $f['itilcategories_id'], 'tier' => self::ticketTier($t)];
    }
    private static function permissions(Ticket $t): array {
        $update = self::staff() && $t->can($t->getID(), UPDATE);
        $open = (int) $t->fields['status'] <= Ticket::WAITING;
        $tier = self::ticketTier($t);
        return [
            'reply' => $t->canAddFollowups() && (int) $t->fields['status'] !== Ticket::CLOSED,
            'edit' => $update && Session::haveRight('ticket', DELETE),
            'status' => $update && $open,
            'escalate' => $update && $open && ($tier['level'] ?? 0) > 1,
            'reassign' => $update && $open && Session::haveRight('ticket', Ticket::ASSIGN),
            'delete' => self::staff() && $t->can($t->getID(), PURGE),
            'solve' => self::staff() && $t->canSolve(),
            'approve' => (int) $t->fields['status'] === Ticket::SOLVED && $t->canApprove(),
            'private_reply' => self::staff() && Session::haveRight('followup', ITILFollowup::SEEPRIVATE),
        ];
    }
    private static function details(Ticket $t): array {
        $data = self::summary($t) + ['description' => self::plain($t->fields['content']), 'permissions' => self::permissions($t)];
        $data['requesters'] = array_values(array_map(fn($a) => self::name((int) $a['users_id']), $t->getUsers(CommonITILActor::REQUESTER)));
        $data['messages'] = [];
        foreach ([ITILFollowup::class => 'reply', ITILSolution::class => 'solution'] as $class => $kind) {
            $dateField = $class === ITILSolution::class ? 'date_creation' : 'date';
            foreach ((new $class())->find(['itemtype' => 'Ticket', 'items_id' => $t->getID()], [$dateField, 'id']) as $row) {
                $item = new $class();
                if (!$item->can($row['id'], READ)) continue;
                $data['messages'][] = ['id' => (int) $row['id'], 'kind' => $kind, 'content' => self::plain($row['content']),
                    'author' => self::name((int) $row['users_id']), 'date' => $row[$dateField], 'private' => (bool) ($row['is_private'] ?? false)];
            }
        }
        usort($data['messages'], fn($a, $b) => [$a['date'], $a['id']] <=> [$b['date'], $b['id']]);
        $data['attachments'] = [];
        $seen = [];
        global $DB;
        foreach ($DB->request(['FROM' => Document_Item::getTable(), 'WHERE' => [
            $t->getAssociatedDocumentsCriteria(), ...Document_Item::getPrivacyRestrictionCriteria(),
        ]]) as $link) {
            $doc = new Document();
            if (!$doc->getFromDB($link['documents_id']) || $doc->fields['is_deleted'] || !$doc->canViewFile(['tickets_id' => $t->getID()])) continue;
            if (isset($seen[$doc->getID()])) continue;
            $seen[$doc->getID()] = true;
            $data['attachments'][] = ['id' => (int) $doc->getID(), 'name' => $doc->fields['filename']];
        }
        return $data;
    }
    private static function upload(array &$input): void {
        if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) return;
        $f = $_FILES['file'];
        if (is_array($f['name']) || $f['error'] !== UPLOAD_ERR_OK || $f['size'] > 10 * 1024 * 1024) self::fail('El archivo no se pudo subir. Máximo 10 MB.');
        $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
        $allowed = ['pdf' => ['application/pdf'], 'png' => ['image/png'], 'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'txt' => ['text/plain']];
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
        if (!isset($allowed[$ext]) || !in_array($mime, $allowed[$ext], true)) self::fail('Adjunta un PDF, imagen PNG/JPG o texto TXT válido.');
        $prefix = 'eticket_' . bin2hex(random_bytes(12)) . '_';
        $filename = $prefix . preg_replace('/[^A-Za-z0-9._-]/', '_', basename($f['name']));
        if (!move_uploaded_file($f['tmp_name'], GLPI_TMP_DIR . '/' . $filename)) self::fail('No pudimos guardar el adjunto.', 500);
        $input['_filename'] = [$filename];
        $input['_prefix_filename'] = [$prefix];
    }
    private static function services(bool $all = false): array {
        $cfg = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);
        $base = self::schema()['base']['service'] ?? [];
        $result = [];
        foreach ($cfg['services'] as $s) {
            if (!$all && !empty($base['options'][$s['code']]['hidden'])) continue;
            $rows = (new ITILCategory())->find(['name' => $s['category'], 'entities_id' => 0, 'itilcategories_id' => 0]);
            if (count($rows) === 1) $result[] = ['id' => $s['code'], 'name' => $s['name'], 'category_id' => (int) array_key_first($rows), 'type' => (int) $s['type']];
        }
        foreach ($base['custom'] ?? [] as $service) {
            if (($all || !$service['hidden']) && isset($service['category_id'])) {
                $result[] = $service + ['custom' => true];
            }
        }
        return $result;
    }
    private static function schema(): array {
        $config = Config::getConfigurationValues('plugin:etickethub', ['portal_schema']);
        $raw = $config['portal_schema'] ?? '{"fields":[]}';
        $schema = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        return ['fields' => $schema['fields'], 'base' => $schema['base'] ?? null, 'revision' => hash('sha256', $raw)];
    }
    private static function saveSchema(array $body): array {
        if (!self::admin()) self::fail('Solo el gestor administrador puede modificar la estructura.', 403);
        if (($body['revision'] ?? '') !== self::schema()['revision']) self::fail('Otro administrador cambió la estructura. Recarga antes de guardar.', 409);
        if (!isset($body['fields']) || !is_array($body['fields']) || !array_is_list($body['fields']) || count($body['fields']) > 20) self::fail('La estructura admite hasta 20 campos adicionales.');
        $fields = []; $ids = [];
        foreach ($body['fields'] as $field) {
            if (!is_array($field)) self::fail('Campo inválido.');
            $id = $field['id'] ?? '';
            if (!is_string($id) || !preg_match('/^field_[a-z0-9]{8,40}$/D', $id) || isset($ids[$id])) self::fail('Identificador de campo inválido o repetido.');
            $ids[$id] = true;
            $label = self::text($field, 'label', 2, 120);
            $type = $field['type'] ?? '';
            if (!in_array($type, ['text', 'textarea', 'select'], true)) self::fail('Tipo de campo no permitido.');
            $options = [];
            if ($type === 'select') {
                if (!is_array($field['options'] ?? null) || !array_is_list($field['options']) || count($field['options']) < 2 || count($field['options']) > 20) self::fail('Cada lista debe tener entre 2 y 20 opciones.');
                foreach ($field['options'] as $option) {
                    if (!is_string($option) || mb_strlen(trim($option)) < 1 || mb_strlen(trim($option)) > 120) self::fail('Opción inválida.');
                    $options[] = trim($option);
                }
                if (count(array_unique($options)) !== count($options)) self::fail('No repitas opciones de una lista.');
            }
            $fields[] = ['id' => $id, 'label' => $label, 'type' => $type, 'required' => !empty($field['required']), 'options' => $options];
        }
        $base = array_key_exists('base', $body) ? $body['base'] : self::schema()['base'];
        if ($base !== null && (!is_array($base) || strlen(json_encode($base, JSON_THROW_ON_ERROR)) > 32768)) self::fail('Configuración de campos base inválida.');
        if (isset($body['base'])) {
            foreach ($base as $key => $settings) {
                if (!in_array($key, ['service', 'kind', 'problem', 'title', 'description', 'urgency'], true) || !is_array($settings)) self::fail('Campo base inválido.');
                foreach (['label' => 120, 'hint' => 200, 'placeholder' => 200] as $field => $limit) {
                    if (array_key_exists($field, $settings)) self::text($settings, $field, $field === 'label' ? 2 : 0, $limit);
                }
                if (isset($settings['list'])) {
                    $list = $settings['list'];
                    if (!is_array($list) || !array_is_list($list) || count($list) < 2 || count($list) > 20) self::fail('Cada lista necesita entre 2 y 20 opciones.');
                    foreach ($list as $option) self::text(['option' => $option], 'option', 1, 120);
                    if (count(array_unique(array_map(fn($option) => mb_strtolower(trim($option)), $list))) !== count($list)) self::fail('No repitas opciones de una lista.');
                }
                if (isset($settings['options'])) {
                    if (!is_array($settings['options'])) self::fail('Opciones inválidas.');
                    foreach ($settings['options'] as $option) {
                        if ($key === 'service' && is_array($option)) self::text(['option' => $option['name'] ?? ''], 'option', 0, 120);
                        else self::text(['option' => $option], 'option', 2, 120);
                    }
                }
            }
            $custom = $base['service']['custom'] ?? [];
            if (!is_array($custom) || !array_is_list($custom) || count($custom) > 50) self::fail('Revisa los servicios adicionales.');
            $previous = array_column(self::schema()['base']['service']['custom'] ?? [], null, 'id');
            $services = [];
            $newCount = 0;
            foreach ($custom as $service) {
                if (!is_array($service)) self::fail('Servicio inválido.');
                $id = $service['id'] ?? null;
                if (!is_string($id) || !preg_match('/^custom_[a-f0-9]{12}$/D', $id) || isset($services[$id])) self::fail('Identificador de servicio inválido.');
                $name = self::text($service, 'name', 2, 120);
                $type = (int) ($service['type'] ?? 0);
                if (!in_array($type, [1, 2], true)) self::fail('Tipo de servicio inválido.');
                $category = new ITILCategory();
                $categoryId = (int) ($previous[$id]['category_id'] ?? 0);
                $input = ['name' => $name, 'is_helpdeskvisible' => (int) empty($service['hidden']), 'is_incident' => (int) ($type === 1), 'is_request' => (int) ($type === 2)];
                if ($categoryId) {
                    if (!$category->update(['id' => $categoryId] + $input)) self::fail('GLPI no pudo actualizar la categoría.', 422);
                } else {
                    if (++$newCount > 1) self::fail('Guarda un servicio nuevo a la vez.');
                    $categoryId = (int) $category->add($input + ['entities_id' => 0, 'is_recursive' => 1]);
                    if (!$categoryId) self::fail('GLPI no pudo crear la categoría del servicio.', 422);
                }
                $services[$id] = ['id' => $id, 'name' => $name, 'type' => $type, 'hidden' => !empty($service['hidden']), 'category_id' => $categoryId];
            }
            foreach (array_diff_key($previous, $services) as $removed) {
                $category = isset($removed['category_id']) ? ITILCategory::getById((int) $removed['category_id']) : null;
                if ($category && !$category->delete(['id' => $category->getID()], true)) self::fail('GLPI no pudo eliminar el servicio.', 422);
            }
            $base['service']['custom'] = array_values($services);
        }
        Config::setConfigurationValues('plugin:etickethub', ['portal_schema' => json_encode(['fields' => $fields, 'base' => $base], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)]);
        return self::schema();
    }
    private static function extraAnswers(array $body): string {
        $answers = $body['answers'] ?? [];
        if (is_string($answers)) $answers = json_decode($answers, true);
        if (!is_array($answers)) self::fail('Revisa los campos adicionales.');
        $content = '';
        foreach (self::schema()['fields'] as $field) {
            $value = $answers[$field['id']] ?? '';
            if (!is_string($value)) self::fail('Revisa el campo ' . $field['label'] . '.');
            $value = trim($value);
            if ($value === '' && $field['required']) self::fail('Completa el campo ' . $field['label'] . '.');
            if (mb_strlen($value) > ($field['type'] === 'textarea' ? 4000 : 255)) self::fail('El campo ' . $field['label'] . ' es demasiado largo.');
            if ($value !== '' && $field['type'] === 'select' && !in_array($value, $field['options'], true)) self::fail('Elige una opción válida para ' . $field['label'] . '.');
            if ($value !== '') $content .= '<h3>' . htmlspecialchars($field['label'], ENT_QUOTES, 'UTF-8') . '</h3>' . self::html($value);
        }
        return $content;
    }
    public static function handle(): Response {
        global $DB;
        $action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'session';
        $method = $_SERVER['REQUEST_METHOD'];
        $mutations = ['login', 'register', 'verify_login', 'resend_code', 'logout', 'create', 'reply', 'edit', 'delete', 'solve', 'approve', 'save_schema', 'status', 'save_user', 'delete_user', 'save_profile', 'delete_profile', 'escalate', 'reassign', 'reauth_users'];
        if (in_array($action, $mutations, true)) {
            if ($method !== 'POST') self::fail('Método no permitido.', 405);
            $csrf = $_SERVER['HTTP_X_ETICKET_CSRF'] ?? '';
            if (!is_string($csrf) || !hash_equals(self::csrf(), $csrf)) self::fail('Tu sesión cambió. Recarga la página e intenta nuevamente.', 403);
        } elseif ($method !== 'GET') self::fail('Método no permitido.', 405);
        $body = $_POST;
        if (str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) self::fail('Datos inválidos.');
        }
        if ($action === 'session') {
            $user = self::user();
            return self::json(['user' => $user, 'csrf' => self::csrf(), 'mfa' => $user ? null : self::publicMfa(self::pendingMfa())]);
        }
        if ($action === 'verify_login') return self::verifyLogin($body);
        if ($action === 'resend_code') {
            $pending = self::pendingMfa();
            if (self::user() || !isset($pending['email']) || self::accountEmail($pending['identity']['user_id']) !== $pending['email']) self::fail('Vuelve a iniciar sesión para solicitar un código.', 409);
            if ($pending['sent_at'] + 60 > time()) self::fail('Espera un minuto entre envíos.', 429);
            if (($pending['resends'] ?? 0) >= 3) self::fail('Se alcanzó el límite de reenvíos. Vuelve a iniciar sesión.', 429);
            $pending['resends'] = ($pending['resends'] ?? 0) + 1;
            $_SESSION['eticket_mfa'] = self::sendMailCode($pending);
            return self::json(['mfa' => self::publicMfa($_SESSION['eticket_mfa'])]);
        }
        if ($action === 'register') {
            if (self::user()) self::fail('Cierra la sesión actual antes de registrarte.', 409);
            unset($_SESSION['eticket_mfa']);
            $identity = self::registerClient($body);
            $email = self::accountEmail($identity['user_id']);
            if (!$email) self::fail('GLPI no pudo guardar el correo de la cuenta.', 422);
            session_regenerate_id(true);
            $_SESSION['eticket_mfa'] = self::sendMailCode(['identity' => $identity, 'email' => $email]);
            return self::json(['verification_required' => true, 'mfa' => self::publicMfa($_SESSION['eticket_mfa']), 'csrf' => self::csrf()], 201);
        }
        if ($action === 'login') {
            if (self::user()) self::fail('Cierra la sesión actual antes de cambiar de cuenta.', 409);
            unset($_SESSION['eticket_mfa']);
            $auth = new Auth();
            if (!isset($body['password']) || !is_string($body['password']) || $body['password'] === '' || strlen($body['password']) > 4096) self::fail('Completa la contraseña.');
            $login = self::text($body, 'username', 1, 255);
            if (filter_var($login, FILTER_VALIDATE_EMAIL) && !(new User())->find(['name' => $login, 'is_deleted' => 0])) {
                $owners = self::emailOwners($login);
                if (count($owners) === 1) $login = reset($owners)->fields['name'];
            }
            if (!$auth->validateLogin($login, $body['password'], true) || !$auth->applyValidatedLogin()) self::fail('Usuario o contraseña incorrectos, o cuenta sin acceso.', 401);
            $id = (int) $auth->user->getID();
            $username = $auth->user->fields['name'];
            $identity = ['user_id' => $id, 'username' => $username, 'auth_type' => $auth->getAuthType(), 'noauto' => true, 'remember_me' => false];
            $totp = new TOTPManager();
            $enabled = $totp->is2FAEnabled($id);
            $registered = preg_match('/^cliente\.[a-f0-9]{24}$/D', $username);
            $email = self::accountEmail($id);
            if ($registered && !$email) self::fail('La cuenta necesita un correo válido. Contacta a soporte.', 403);
            $required = $totp->get2FAEnforcement($id) !== TOTPManager::ENFORCEMENT_OPTIONAL;
            if (!$email && !$enabled && !$required) return self::completeLogin($identity);
            if (($email || $enabled) && self::remembersMfa($auth->user, $email)) return self::completeLogin($identity);
            session_regenerate_id(true);
            $pending = ['identity' => $identity, 'username' => $username, 'expires' => time() + 300];
            if ($email) $pending = self::sendMailCode($pending + ['email' => $email]);
            elseif (!$enabled) $pending['secret'] = $totp->createSecret();
            $_SESSION['eticket_mfa'] = $pending;
            return self::json(['verification_required' => true, 'mfa' => self::publicMfa($pending), 'csrf' => self::csrf()]);
        }
        $session = self::user();
        if (!$session) self::fail('Inicia sesión para continuar.', 401);
        if ($action === 'logout') { Session::destroy(); return self::json(['ok' => true]); }
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
        if ($action === 'services') return self::json(['services' => self::services(self::admin() && !empty($_GET['all']))]);
        if ($action === 'schema') return self::json(['schema' => self::schema()]);
        if ($action === 'save_schema') return self::json(['schema' => self::saveSchema($body)]);
        if ($action === 'tickets') {
            $offset = max(0, min(100000, (int) ($_GET['offset'] ?? 0)));
            $q = mb_substr(trim(is_string($_GET['q'] ?? null) ? $_GET['q'] : ''), 0, 120);
            $status = (int) ($_GET['status'] ?? 0);
            $where = ['is_deleted' => 0];
            if ($q !== '') {
                $where['OR'] = ['name' => ['LIKE', '%' . addcslashes($q, '\\%_') . '%']];
                if (preg_match('/^#?(\d+)$/D', $q, $number)) $where['OR']['id'] = (int) $number[1];
            }
            if ($status >= 1 && $status <= 6) $where['status'] = $status;
            $tickets = []; $visible = 0; $more = false;
            foreach ($DB->request(['FROM' => Ticket::getTable(), 'WHERE' => $where, 'ORDER' => ['id DESC']]) as $row) {
                $t = new Ticket();
                if (!$t->can($row['id'], READ)) continue;
                if ($visible++ < $offset) continue;
                if (count($tickets) === 20) { $more = true; break; }
                $tickets[] = self::summary($t);
            }
            return self::json(['tickets' => $tickets, 'has_more' => $more, 'offset' => $offset]);
        }
        if ($action === 'create') {
            if (self::staff() || !Ticket::canCreate()) self::fail('Tu perfil no permite crear solicitudes.', 403);
            $service = null;
            foreach (self::services() as $s) if ($s['id'] === ($body['service'] ?? '')) $service = $s;
            if (!$service) self::fail('Selecciona un servicio válido.');
            $input = ['name' => self::text($body, 'title', 4, 200), 'content' => self::html(self::text($body, 'description', 10, 20000)),
                'entities_id' => (int) $_SESSION['glpiactive_entity'], '_users_id_requester' => (int) Session::getLoginUserID(),
                'type' => $service['type'], 'itilcategories_id' => $service['category_id'], 'urgency' => max(1, min(5, (int) ($body['urgency'] ?? 3)))];
            $input['content'] .= self::extraAnswers($body);
            $t = new Ticket();
            if (!$t->can(-1, CREATE, $input)) self::fail('No puedes crear solicitudes en esta entidad.', 403);
            self::upload($input);
            $id = $t->add($input);
            if (!$id) self::fail('GLPI no pudo crear la solicitud. Revisa los campos.', 422);
            if (!self::ticketTier($t)) {
                $groups = array_filter(self::tierGroups(), fn($group) => $group['level'] === 4);
                if (!$groups || !(new Group_Ticket())->add(['tickets_id' => $id, 'groups_id' => array_key_first($groups), 'type' => CommonITILActor::ASSIGN])) self::fail('GLPI no pudo asignar la mesa de ayuda.', 422);
            }
            return self::json(['ticket' => self::details(self::ticket((int) $id))], 201);
        }
        $t = self::ticket((int) ($_GET['id'] ?? 0));
        $permissions = self::permissions($t);
        if ($action === 'ticket') return self::json(['ticket' => self::details($t)]);
        if ($action === 'download') {
            $docId = (int) ($_GET['document'] ?? 0);
            $allowed = array_column(self::details($t)['attachments'], 'id');
            $doc = new Document();
            if (!in_array($docId, $allowed, true) || !$doc->getFromDB($docId) || !$doc->canViewFile(['tickets_id' => $t->getID()])) self::fail('Adjunto no disponible.', 404);
            $response = $doc->getAsResponse();
            $response->headers->set('X-Content-Type-Options', 'nosniff');
            $response->headers->set('Cache-Control', 'private, no-store');
            return $response;
        }
        if ($action === 'reply') {
            if (!$permissions['reply']) self::fail('No puedes responder a esta solicitud.', 403);
            $private = !empty($body['private']);
            if ($private && !$permissions['private_reply']) self::fail('No puedes agregar notas internas.', 403);
            $input = ['itemtype' => 'Ticket', 'items_id' => $t->getID(), 'content' => self::html(self::text($body, 'message', 1, 20000)), 'is_private' => $private ? 1 : 0];
            self::upload($input);
            $reply = new ITILFollowup();
            if (!$reply->can(-1, CREATE, $input)) self::fail('No puedes responder a esta solicitud.', 403);
            if (!$reply->add($input)) self::fail('GLPI no pudo guardar la respuesta.', 422);
        } elseif ($action === 'escalate' || $action === 'reassign') {
            if (!$permissions[$action]) self::fail('Tu perfil no permite derivar esta solicitud.', 403);
            $level = self::ticketTier($t)['level'] ?? 0;
            $target = $action === 'escalate' ? $level - 1 : (int) ($body['level'] ?? 0);
            if ($target < 1 || $target > 4 || $target === $level) self::fail('Selecciona un tier distinto al actual.');
            self::transfer($t, $target, self::text($body, 'reason', 10, 2000));
            if ($action === 'escalate' && !(new Ticket())->can($t->getID(), READ)) return self::json(['ticket' => null]);
        } elseif ($action === 'status') {
            if (!$permissions['status']) self::fail('Tu perfil no permite cambiar el estado.', 403);
            $status = (int) ($body['status'] ?? 0);
            if (!in_array($status, [1, 2, 3, 4], true) || !Ticket::isAllowedStatus($t->fields['status'], $status)) self::fail('Cambio de estado no permitido.');
            if (!$t->update(['id' => $t->getID(), 'status' => $status])) self::fail('GLPI no pudo cambiar el estado.');
        } elseif ($action === 'edit') {
            if (!$permissions['edit']) self::fail('Tu perfil no permite editar solicitudes.', 403);
            $input = ['id' => $t->getID(), 'name' => self::text($body, 'title', 4, 200), 'content' => self::html(self::text($body, 'description', 10, 20000))];
            if (isset($body['status'])) {
                $status = (int) $body['status'];
                if (!in_array($status, [1, 2, 3, 4], true) || !Ticket::isAllowedStatus($t->fields['status'], $status)) self::fail('Cambio de estado no permitido. Para resolver registra una solución.');
                $input['status'] = $status;
            }
            if (!$t->update($input)) self::fail('No pudimos guardar los cambios.', 422);
        } elseif ($action === 'delete') {
            if (!$permissions['delete']) self::fail('Tu perfil no permite eliminar solicitudes definitivamente.', 403);
            if (!$t->delete(['id' => $t->getID()], true)) self::fail('No pudimos eliminar la solicitud.', 422);
            return self::json(['ok' => true]);
        } elseif ($action === 'solve') {
            if (!$permissions['solve']) self::fail('Tu perfil no permite resolver esta solicitud.', 403);
            $input = ['itemtype' => 'Ticket', 'items_id' => $t->getID(), 'content' => self::html(self::text($body, 'message', 10, 20000))];
            $solution = new ITILSolution();
            if (!$solution->can(-1, CREATE, $input) || !$solution->add($input)) self::fail('No pudimos registrar la solución.', 422);
        } elseif ($action === 'approve') {
            if (!$permissions['approve']) self::fail('No puedes revisar esta solución.', 403);
            $accept = ($body['accept'] ?? null) === true;
            $input = ['itemtype' => 'Ticket', 'items_id' => $t->getID(), 'is_private' => 0,
                'content' => self::html($accept ? 'La solución resuelve mi solicitud.' : self::text($body, 'message', 5, 20000)),
                $accept ? 'add_close' : 'add_reopen' => 1];
            $followup = new ITILFollowup();
            if (!$followup->can(-1, CREATE, $input) || !$followup->add($input)) self::fail('No pudimos actualizar la solución.', 422);
        } else self::fail('Ruta no encontrada.', 404);
        return self::json(['ticket' => self::details(self::ticket((int) $t->getID()))]);
    }
    private static function json(array $data, int $status = 200): JsonResponse {
        return new JsonResponse($data, $status, ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
    }
}
