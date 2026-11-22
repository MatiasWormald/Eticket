<?php
declare(strict_types=1);

use Symfony\Component\HttpFoundation\Response;

trait EticketPortalTickets {
    private static function ticket(int $id): Ticket {
        $t = new Ticket();
        if ($id < 1 || !$t->getFromDB($id) || $t->fields['is_deleted'] || !$t->can($id, READ)) self::fail('La solicitud no existe o no tienes acceso.', 404);
        return $t;
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

    private static function ticketAction(string $action, array $body): Response {
        global $DB;

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
}
