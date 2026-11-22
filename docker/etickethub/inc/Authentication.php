<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Glpi\Security\ReAuth\PasswordReAuthStrategy;
use Glpi\Security\ReAuth\TOTPReAuthStrategy;
use Glpi\Security\ReAuth\ReAuthManager;
use Glpi\Security\TOTPManager;
use Glpi\Exception\AuthenticationFailedException;

trait EticketPortalAuthentication {
    private const MFA_COOKIE = 'eticket_mfa_remembered';
    private const MFA_REMEMBER_SECONDS = 86400;

    private static function csrf(): string {
        return $_SESSION['eticket_csrf'] ??= bin2hex(random_bytes(32));
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

    private static function authenticationAction(string $action, array $body): Response {
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
        self::fail('Ruta de autenticaci?n no encontrada.', 404);
    }
}
