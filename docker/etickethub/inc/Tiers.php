<?php
declare(strict_types=1);

trait EticketPortalTiers {
    private static function tierGroups(): array {
        static $levels = null;
        if ($levels !== null) return $levels;
        $config = json_decode(file_get_contents('/usr/local/share/eticket/hub.json'), true, 512, JSON_THROW_ON_ERROR);
        $names = [4 => ['HD-L1-MESA'], 3 => $config['unit_groups'], 2 => ['TECHLEAD-L3', 'PROFESORES-L3'], 1 => ['CIO-L4', 'CE-L5']];
        $levels = [];
        foreach ($names as $level => $groups) {
            foreach ((new Group())->find(['name' => $groups, 'entities_id' => 0]) as $group) {
                $levels[(int) $group['id']] = ['level' => $level, 'group_label' => $group['name']];
            }
        }
        return $levels;
    }

    private static function ticketTier(Ticket $ticket): ?array {
        $levels = self::tierGroups();
        $tier = null;
        foreach ($ticket->getGroups(CommonITILActor::ASSIGN) as $assignment) {
            $group = $levels[$assignment['groups_id']] ?? null;
            if ($group && (!$tier || $group['level'] < $tier['level'])) $tier = $group;
        }
        return $tier;
    }

    private static function transfer(Ticket $ticket, int $target, string $reason): void {
        $groups = self::tierGroups();
        $targets = array_filter($groups, fn($group) => $group['level'] === $target);
        if ($target === 3) {
            $category = ITILCategory::getById($ticket->fields['itilcategories_id']);
            $responsible = (int) ($category->fields['groups_id'] ?? 0);
            if (isset($targets[$responsible])) $targets = [$responsible => $targets[$responsible]];
        }
        if (!$targets) self::fail('No hay un grupo de GLPI para ese tier.', 422);
        $groupId = array_key_first($targets);
        foreach ($ticket->getGroups(CommonITILActor::ASSIGN) as $assignment) {
            if ((int) $assignment['groups_id'] === $groupId) continue;
            if (isset($groups[$assignment['groups_id']]) && !(new Group_Ticket())->delete(['id' => $assignment['id']], true)) self::fail('GLPI no pudo retirar la asignación anterior.', 422);
        }
        if (!$ticket->isGroup(CommonITILActor::ASSIGN, $groupId)
            && !(new Group_Ticket())->add(['tickets_id' => $ticket->getID(), 'groups_id' => $groupId, 'type' => CommonITILActor::ASSIGN])) self::fail('GLPI no pudo asignar el grupo.', 422);
        if (!(new ITILFollowup())->add(['itemtype' => 'Ticket', 'items_id' => $ticket->getID(),
            'content' => self::html('Derivación a ' . $targets[$groupId]['group_label'] . ': ' . $reason), 'is_private' => 1])) self::fail('GLPI no pudo guardar el motivo.', 422);
    }

    private static function agentTier(int $id): ?int {
        $levels = self::tierGroups();
        foreach ((new Group_User())->find(['users_id' => $id]) as $membership) {
            if (isset($levels[$membership['groups_id']])) return $levels[$membership['groups_id']]['level'];
        }
        return null;
    }
}
