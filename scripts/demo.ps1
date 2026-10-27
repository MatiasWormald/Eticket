[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (!(Test-Path -LiteralPath '.env.demo')) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = [Convert]::ToBase64String($bytes)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path (Get-Location) '.env.demo'), "GLPI_DEMO_USER=cliente.demo`nGLPI_DEMO_PASSWORD=$secret`n", $utf8)
}
$values = @{}
foreach ($line in Get-Content -LiteralPath '.env.demo') {
    if ($line -match '^(GLPI_DEMO_USER|GLPI_DEMO_PASSWORD)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
if (!$values['GLPI_DEMO_USER'] -or !$values['GLPI_DEMO_PASSWORD']) { throw '.env.demo incompleto.' }
$previousUser = $env:GLPI_DEMO_USER
$previousPassword = $env:GLPI_DEMO_PASSWORD
try {
    $env:GLPI_DEMO_USER = $values['GLPI_DEMO_USER']
    $env:GLPI_DEMO_PASSWORD = $values['GLPI_DEMO_PASSWORD']
    docker compose exec -T --user www-data -e GLPI_DEMO_USER -e GLPI_DEMO_PASSWORD glpi php /usr/local/bin/seed-demo.php
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible preparar la demostracion.' }
} finally {
    $env:GLPI_DEMO_USER = $previousUser
    $env:GLPI_DEMO_PASSWORD = $previousPassword
}
