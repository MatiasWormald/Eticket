<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class EticketPortalError extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 400) { parent::__construct($message); }
}

final class EticketPortal {
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
            'can_create' => Ticket::canCreate(), 'can_manage' => $manage,
            'can_admin' => self::admin(),
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
            'type' => (int) $f['type'], 'urgency' => (int) $f['urgency'], 'category_id' => (int) $f['itilcategories_id']];
    }
    private static function permissions(Ticket $t): array {
        return [
            'reply' => $t->canAddFollowups() && (int) $t->fields['status'] !== Ticket::CLOSED,
            'edit' => self::staff() && $t->can($t->getID(), UPDATE),
            'delete' => self::staff() && $t->can($t->getID(), DELETE),
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
    private static function services(): array {
        $cfg = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);
        $result = [];
        foreach ($cfg['services'] as $s) {
            $rows = (new ITILCategory())->find(['name' => $s['category'], 'entities_id' => 0, 'itilcategories_id' => 0]);
            if (count($rows) === 1) $result[] = ['id' => $s['code'], 'name' => $s['name'], 'category_id' => (int) array_key_first($rows), 'type' => (int) $s['type']];
        }
        return $result;
    }
    private static function schema(): array {
        $config = Config::getConfigurationValues('plugin:etickethub', ['portal_schema']);
        $raw = $config['portal_schema'] ?? '{"fields":[]}';
        $schema = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        return ['fields' => $schema['fields'], 'revision' => hash('sha256', $raw)];
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
        Config::setConfigurationValues('plugin:etickethub', ['portal_schema' => json_encode(['fields' => $fields], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)]);
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
        $mutations = ['login', 'logout', 'create', 'reply', 'edit', 'delete', 'solve', 'approve', 'save_schema'];
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
        if ($action === 'session') return self::json(['user' => self::user(), 'csrf' => self::csrf()]);
        if ($action === 'login') {
            if (self::user()) self::fail('Cierra la sesión actual antes de cambiar de cuenta.', 409);
            $auth = new Auth();
            if (!isset($body['password']) || !is_string($body['password']) || $body['password'] === '' || strlen($body['password']) > 4096) self::fail('Completa la contraseña.');
            if (!$auth->login(self::text($body, 'username', 1, 255), $body['password'], true, false)) self::fail('Usuario o contraseña incorrectos, o cuenta sin acceso.', 401);
            $_SESSION['eticket_csrf'] = bin2hex(random_bytes(32));
            return self::json(['user' => self::user(), 'csrf' => self::csrf()]);
        }
        if (!self::user()) self::fail('Inicia sesión para continuar.', 401);
        if ($action === 'logout') { Session::destroy(); return self::json(['ok' => true]); }
        if ($action === 'services') return self::json(['services' => self::services()]);
        if ($action === 'schema') return self::json(['schema' => self::schema()]);
        if ($action === 'save_schema') return self::json(['schema' => self::saveSchema($body)]);
        if ($action === 'tickets') {
            $offset = max(0, min(100000, (int) ($_GET['offset'] ?? 0)));
            $q = mb_substr(trim((string) ($_GET['q'] ?? '')), 0, 120);
            $status = (int) ($_GET['status'] ?? 0);
            $where = ['is_deleted' => 0];
            if ($q !== '') $where['OR'] = ['name' => ['LIKE', '%' . $q . '%'], 'id' => ctype_digit($q) ? (int) $q : -1];
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
            if (!Ticket::canCreate()) self::fail('Tu perfil no permite crear solicitudes.', 403);
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
            if (!$permissions['delete']) self::fail('Tu perfil no permite enviar solicitudes a la papelera.', 403);
            if (!$t->delete(['id' => $t->getID()], false)) self::fail('No pudimos enviar la solicitud a la papelera.', 422);
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
