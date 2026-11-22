<?php
declare(strict_types=1);

trait EticketPortalForms {
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
}
