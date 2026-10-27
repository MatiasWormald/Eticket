<?php

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$host = getenv('DB_HOST') ?: 'db';
$port = (int) (getenv('DB_PORT') ?: 3306);
$name = getenv('DB_NAME') ?: 'glpi';
$user = getenv('DB_USER') ?: 'glpi';
$pass = getenv('DB_PASSWORD') ?: 'glpi';
$admin = getenv('GLPI_ADMIN_USER') ?: 'admin';

$db = @new mysqli($host, $user, $pass, $name, $port);
if ($db->connect_errno) {
    fwrite(STDERR, "No se pudo conectar a la base de datos: {$db->connect_error}\n");
    exit(1);
}
$db->set_charset('utf8mb4');

$customCss = <<<'CSS'
:root,
[data-bs-theme="light"] {
  --tblr-primary-rgb: 200, 16, 46;
  --tblr-primary: #c8102e;
  --tblr-primary-fg: #ffffff;
  --tblr-link-color: #b30d28;
  --tblr-link-hover-color: #7f091d;
}

a,
.btn-link {
  color: #b30d28;
}

a:hover,
.btn-link:hover {
  color: #7f091d;
}

.btn-primary {
  --tblr-btn-bg: #c8102e;
  --tblr-btn-border-color: #c8102e;
  --tblr-btn-hover-bg: #a80d26;
  --tblr-btn-hover-border-color: #a80d26;
  --tblr-btn-active-bg: #8f0b20;
  --tblr-btn-active-border-color: #8f0b20;
}

.navbar-brand,
.main-header,
.page-header {
  letter-spacing: .01em;
}

.card {
  border-color: #e5e7eb;
}

.badge.bg-primary,
.text-bg-primary {
  background-color: #c8102e !important;
}

.form-control:focus,
.form-select:focus {
  border-color: #c8102e;
  box-shadow: 0 0 0 .25rem rgba(200, 16, 46, .18);
}

.pagination .page-item.active .page-link {
  background-color: #c8102e;
  border-color: #c8102e;
  color: #fff;
}
CSS;

$stmt = $db->prepare('UPDATE glpi_entities SET enable_custom_css = 1, custom_css_code = ? WHERE id = 0');
if ($stmt !== false) {
    $stmt->bind_param('s', $customCss);
    $stmt->execute();
    $stmt->close();
}

$check = $db->prepare(
    'SELECT 1
     FROM glpi_profiles_users pu
     INNER JOIN glpi_users u ON u.id = pu.users_id
     WHERE u.name = ? AND pu.profiles_id = 4
     LIMIT 1'
);
$adminIsSuperAdmin = false;
if ($check !== false) {
    $check->bind_param('s', $admin);
    $check->execute();
    $result = $check->get_result();
    $adminIsSuperAdmin = $result !== false && $result->num_rows > 0;
    $check->close();
}

if ($adminIsSuperAdmin) {
    foreach (['glpi', 'tech', 'normal', 'post-only'] as $defaultUser) {
        if ($defaultUser === $admin) {
            throw new RuntimeException('Utiliza un administrador diferente de las cuentas predeterminadas.');
        }
        // Deshabilitar preserva referencias e historial de instalaciones existentes.
        $disable = $db->prepare('UPDATE glpi_users SET is_active = 0 WHERE name = ?');
        $disable->bind_param('s', $defaultUser);
        $disable->execute();
        $disable->close();
    }
} else {
    throw new RuntimeException('No se encontró el administrador Super-Admin; no se continúa el aprovisionamiento.');
}

$db->close();
