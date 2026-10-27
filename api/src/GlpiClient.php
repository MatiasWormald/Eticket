<?php

require_once __DIR__ . '/config.php';

class GlpiClient
{
    private string $baseUrl;
    private string $user;
    private string $pass;
    private string $appToken;

    public function __construct()
    {
        $this->baseUrl = rtrim(GLPI_BASE_URL, '/');
        $this->user = GLPI_API_USER;
        $this->pass = GLPI_API_PASS;
        $this->appToken = GLPI_APP_TOKEN;
    }

    private function getSession(): array
    {
        if (is_file(SESSION_FILE)) {
            $data = json_decode(file_get_contents(SESSION_FILE), true);
            if (is_array($data) && !empty($data['session_token']) && !empty($data['expires_at']) && $data['expires_at'] > time() + 60) {
                return $data;
            }
        }

        $url = $this->baseUrl . '/apirest.php/initSession';
        $headers = [
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode($this->user . ':' . $this->pass),
        ];
        if ($this->appToken !== '') {
            $headers[] = 'App-Token: ' . $this->appToken;
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code >= 200 && $code < 300 && $resp) {
            $json = json_decode($resp, true);
            if (is_array($json) && !empty($json['session_token'])) {
                $session = [
                    'session_token' => $json['session_token'],
                    'expires_at' => time() + 1800,
                ];
                file_put_contents(SESSION_FILE, json_encode($session));
                return $session;
            }
        }

        throw new Exception('No se pudo iniciar sesión con GLPI API');
    }

    public function call(string $method, string $endpoint, ?array $payload = null): array
    {
        $session = $this->getSession();
        $url = $this->baseUrl . '/apirest.php/' . ltrim($endpoint, '/');

        $headers = [
            'Content-Type: application/json',
            'Session-Token: ' . $session['session_token'],
        ];
        if ($this->appToken !== '') {
            $headers[] = 'App-Token: ' . $this->appToken;
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));

        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        }

        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($resp === false) {
            throw new Exception('Error de conexión con GLPI');
        }

        $json = json_decode($resp, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($json)) {
            return ['status' => $code, 'data' => $json];
        }

        return ['status' => $code, 'data' => ['raw' => $resp]];
    }

    public function createTicket(array $input): array
    {
        return $this->call('POST', 'Ticket', ['input' => $input]);
    }

    public function getTickets(string $criteria = ''): array
    {
        $endpoint = 'search/Ticket';
        if ($criteria !== '') {
            $endpoint .= $criteria;
        }
        return $this->call('GET', $endpoint);
    }

    public function getTicket(int $id): array
    {
        return $this->call('GET', 'Ticket/' . $id);
    }

    public function addFollowup(int $ticketId, array $input): array
    {
        return $this->call('POST', 'Ticket/' . $ticketId . '/TicketFollowup', ['input' => $input]);
    }

    public function updateTicket(int $ticketId, array $input): array
    {
        return $this->call('PUT', 'Ticket/' . $ticketId, ['input' => $input]);
    }

    public function getUser(int $id): array
    {
        return $this->call('GET', 'User/' . $id);
    }
}
