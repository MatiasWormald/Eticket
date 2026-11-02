<?php
declare(strict_types=1);

// Fixed destinations configured by the operator; never an arbitrary redirect.
$origin = $_GET['origen'] ?? '';
$key = match ($origin) { 'A' => 'ETICKET_ORIGIN_A_URL', 'B' => 'ETICKET_ORIGIN_B_URL', default => 'ETICKET_SITE_URL' };
$url = getenv($key) ?: (getenv('ETICKET_SITE_URL') ?: 'http://localhost:8080');
$parts = parse_url($url);
if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
    || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
    || preg_match('/[\x00-\x20\x7f]/', $url)) {
    http_response_code(500);
    exit('La dirección de regreso no está configurada correctamente.');
}
header('Cache-Control: no-store');
header('Location: ' . $url, true, 302);
