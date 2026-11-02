<?php
declare(strict_types=1);

function plugin_init_etickethub(): void {
    global $PLUGIN_HOOKS;
    $PLUGIN_HOOKS['csrf_compliant']['etickethub'] = true;
    \Glpi\Http\Firewall::addPluginStrategyForLegacyScripts(
        'etickethub', '#^/front/return\.php$#', \Glpi\Http\Firewall::STRATEGY_NO_CHECK
    );
    // This JSON entrypoint performs its own authentication and authorization.
    \Glpi\Http\Firewall::addPluginStrategyForLegacyScripts(
        'etickethub', '#^/front/api\.php$#', \Glpi\Http\Firewall::STRATEGY_NO_CHECK
    );
    foreach (['add_javascript', 'add_javascript_anonymous_page'] as $hook) {
        $PLUGIN_HOOKS[$hook]['etickethub'] = 'js/navigation.js';
    }
    foreach (['add_css', 'add_css_anonymous_page'] as $hook) {
        $PLUGIN_HOOKS[$hook]['etickethub'] = 'css/portal.css';
    }
}

function plugin_version_etickethub(): array {
    return [
        'name' => 'eTicket · Tech Hub', 'version' => '1.0.0',
        'author' => 'Tech Hub ULS', 'license' => 'GPLv3+',
        'homepage' => '', 'requirements' => ['glpi' => ['min' => '12.0.0', 'max' => '12.0.99']],
    ];
}
