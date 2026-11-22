<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

require_once __DIR__ . '/Authentication.php';
require_once __DIR__ . '/Accounts.php';
require_once __DIR__ . '/Tiers.php';
require_once __DIR__ . '/Forms.php';
require_once __DIR__ . '/Tickets.php';

final class EticketPortalError extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 400) { parent::__construct($message); }
}

final class EticketPortal {
    use EticketPortalAuthentication, EticketPortalAccounts, EticketPortalTiers, EticketPortalForms, EticketPortalTickets;

    // Acciones POST y requisito de transacción para sus escrituras en GLPI.
    private const MUTATIONS = [
        'login' => false,
        'logout' => false,
        'register' => true,
        'verify_login' => true,
        'resend_code' => false,
        'reauth_users' => false,
        'save_profile' => true,
        'delete_profile' => true,
        'save_user' => true,
        'delete_user' => true,
        'save_schema' => true,
        'create' => true,
        'reply' => true,
        'edit' => true,
        'delete' => true,
        'solve' => true,
        'approve' => true,
        'status' => true,
        'escalate' => true,
        'reassign' => true,
    ];

    public static function requiresTransaction(mixed $action): bool {
        return is_string($action) && (self::MUTATIONS[$action] ?? false);
    }

    public static function handle(): Response {
        $action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'session';
        $method = $_SERVER['REQUEST_METHOD'];
        if (isset(self::MUTATIONS[$action])) {
            if ($method !== 'POST') self::fail('Método no permitido.', 405);
            $csrf = $_SERVER['HTTP_X_ETICKET_CSRF'] ?? '';
            if (!is_string($csrf) || !hash_equals(self::csrf(), $csrf)) self::fail('Tu sesión cambió. Recarga la página e intenta nuevamente.', 403);
        } elseif ($method !== 'GET') self::fail('Método no permitido.', 405);
        $body = $_POST;
        if (str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
            $body = json_decode(file_get_contents('php://input'), true);
            if (!is_array($body)) self::fail('Datos inválidos.');
        }

        if (in_array($action, ['session', 'login', 'register', 'verify_login', 'resend_code'], true)) {
            return self::authenticationAction($action, $body);
        }

        $session = self::user();
        if (!$session) self::fail('Inicia sesión para continuar.', 401);
        if ($action === 'logout') { Session::destroy(); return self::json(['ok' => true]); }

        return match ($action) {
            'profile', 'save_profile', 'delete_profile', 'users', 'save_user', 'delete_user', 'reauth_users' => self::accountAction($action, $body, $session),
            'services' => self::json(['services' => self::services(self::admin() && !empty($_GET['all']))]),
            'schema' => self::json(['schema' => self::schema()]),
            'save_schema' => self::json(['schema' => self::saveSchema($body)]),
            default => self::ticketAction($action, $body),
        };
    }

    private static function fail(string $message, int $status = 400): never { throw new EticketPortalError($message, $status); }

    private static function json(array $data, int $status = 200): JsonResponse {
        return new JsonResponse($data, $status, ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    private static function text(array $body, string $key, int $min, int $max): string {
        if (!isset($body[$key]) || !is_string($body[$key])) self::fail('Completa el campo ' . $key . '.');
        $text = trim($body[$key]);
        if (mb_strlen($text) < $min || mb_strlen($text) > $max) self::fail('Revisa el campo ' . $key . ' (' . $min . ' a ' . $max . ' caracteres).');
        return $text;
    }

    private static function plain(?string $html): string {
        return trim(html_entity_decode(strip_tags(str_replace(['</p>', '</h3>', '<br>', '<br/>', '<br />', '</div>'], "\n", $html ?? '')), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    private static function html(string $text): string { return '<p>' . nl2br(htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')) . '</p>'; }
}
