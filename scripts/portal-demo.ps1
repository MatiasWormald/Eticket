[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$values = @{}
if (Test-Path .env.demo) {
    foreach ($line in Get-Content .env.demo) { if ($line -match '^([^=]+)=(.*)$') { $values[$matches[1]] = $matches[2] } }
}
$keys = @('GLPI_DEMO_AGENT_PASSWORD', 'GLPI_DEMO_MANAGER_PASSWORD', 'GLPI_DEMO_OTHER_PASSWORD')
$previous = @{}
try {
    foreach ($key in $keys) {
        if (!$values[$key]) {
            $bytes = New-Object byte[] 24
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
            $values[$key] = [Convert]::ToBase64String($bytes)
            Add-Content -LiteralPath .env.demo -Value "$key=$($values[$key])" -Encoding UTF8
        }
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $values[$key], 'Process')
    }
    docker compose exec -T --user www-data -e GLPI_DEMO_AGENT_PASSWORD -e GLPI_DEMO_MANAGER_PASSWORD -e GLPI_DEMO_OTHER_PASSWORD glpi php /usr/local/bin/seed-portal.php
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los usuarios del portal.' }
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
