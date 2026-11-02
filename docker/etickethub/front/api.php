<?php
declare(strict_types=1);

// Loaded by GLPI's kernel. All data stays in GLPI; no service account or
// parallel ticket database. Native permissions are checked on every object.
require_once dirname(__DIR__) . '/inc/Portal.php';
global $DB;
$transaction = in_array($_GET['action'] ?? '', ['create', 'reply', 'edit', 'delete', 'solve', 'approve', 'save_schema'], true);
try {
    if ($transaction) $DB->beginTransaction();
    $response = EticketPortal::handle();
    if ($transaction) $DB->commit();
    return $response;
} catch (EticketPortalError $error) {
    if ($transaction) $DB->rollBack();
    return new Symfony\Component\HttpFoundation\JsonResponse(['error' => $error->getMessage()], $error->status);
} catch (Throwable $error) {
    if ($transaction) $DB->rollBack();
    error_log('eTicket portal: ' . $error->getMessage());
    return new Symfony\Component\HttpFoundation\JsonResponse(['error' => 'No pudimos completar la operación. Intenta nuevamente.'], 500);
}
