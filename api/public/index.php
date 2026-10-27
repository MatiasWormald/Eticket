<?php

// Nivel 1: no existe aún autenticación individual ni aislamiento de clientes.
// No activar estas rutas hasta implementar y aprobar los niveles 2/3.
http_response_code(503);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'Integración no habilitada. Utiliza el portal autenticado de GLPI.']);
exit;

require_once __DIR__ . '/../src/GlpiClient.php';

function jsonResponse($data, $status = 200)
{
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . ALLOW_ORIGIN);
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, Session-Token, App-Token');
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: ' . ALLOW_ORIGIN);
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, Session-Token, App-Token');
    http_response_code(204);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri = trim($uri, '/');

$client = new GlpiClient();

try {
    if ($uri === 'health') {
        jsonResponse(['ok' => true, 'time' => date('c')]);
    }

    if ($uri === 'crear-ticket' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $titulo = trim($body['titulo'] ?? '');
        $descripcion = trim($body['descripcion'] ?? '');
        $categoria = trim($body['categoria'] ?? '');
        $tipo = $body['tipo'] ?? 1;
        $solicitante = trim($body['solicitante'] ?? 'consulta');

        if ($titulo === '' || $descripcion === '') {
            jsonResponse(['error' => 'Faltan datos obligatorios (título y descripción)'], 400);
        }

        $input = [
            'name' => $titulo,
            'content' => $descripcion,
            'type' => (int)$tipo,
            '_users_id_requester' => 0,
        ];

        if ($categoria !== '') {
            $input['itilcategories_id'] = (int)$categoria;
        }

        $res = $client->createTicket($input);
        jsonResponse($res);
    }

    if ($uri === 'tickets' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $res = $client->getTickets();
        jsonResponse($res);
    }

    if (preg_match('#^ticket/([0-9]+)$#', $uri, $m) && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $res = $client->getTicket((int)$m[1]);
        jsonResponse($res);
    }

    if (preg_match('#^ticket/([0-9]+)/seguimiento$#', $uri, $m) && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $texto = trim($body['texto'] ?? '');
        if ($texto === '') {
            jsonResponse(['error' => 'Falta el texto del seguimiento'], 400);
        }
        $input = [
            'items_id' => (int)$m[1],
            'itemtype' => 'Ticket',
            'content' => $texto,
        ];
        $res = $client->addFollowup((int)$m[1], $input);
        jsonResponse($res);
    }

    if (preg_match('#^ticket/([0-9]+)/estado$#', $uri, $m) && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $estado = (int)($body['status'] ?? 1);
        $input = ['status' => $estado];
        $res = $client->updateTicket((int)$m[1], $input);
        jsonResponse($res);
    }

    jsonResponse(['error' => 'Ruta no encontrada', 'uri' => $uri], 404);
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
