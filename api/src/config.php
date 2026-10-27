<?php

define('GLPI_BASE_URL', getenv('GLPI_INTERNAL_URL') ?: 'http://glpi');
define('GLPI_API_USER', getenv('GLPI_API_USER') ?: '');
define('GLPI_API_PASS', getenv('GLPI_API_PASS') ?: '');
define('GLPI_APP_TOKEN', getenv('GLPI_APP_TOKEN') ?: '');
define('ALLOW_ORIGIN', getenv('API_ALLOW_ORIGIN') ?: 'http://localhost:8080');
define('SESSION_FILE', sys_get_temp_dir() . '/eticket_api_session.json');
