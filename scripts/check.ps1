[CmdletBinding()]
param([switch]$Integration)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose inválido' }
docker compose exec -T --user www-data glpi php /usr/local/bin/check-hub.php
if ($LASTEXITCODE -ne 0) { throw 'Verificación de GLPI fallida' }
if ($Integration) {
    docker compose exec -T --user www-data glpi php /usr/local/bin/test-hub.php
    if ($LASTEXITCODE -ne 0) { throw 'Prueba de integración fallida' }
}
$envLines = Get-Content -LiteralPath '.env'
function Read-Port([string]$name, [int]$fallback) {
    $line = $envLines | Where-Object { $_ -match "^$name=" } | Select-Object -Last 1
    if ($line) { return [int]($line.Split('=', 2)[1]) }
    return $fallback
}
$glpiPort = Read-Port 'GLPI_PORT' 8081
$sitePort = Read-Port 'SITE_PORT' 8080
foreach ($url in @("http://localhost:$sitePort/", "http://localhost:$glpiPort/")) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url
    if ($response.StatusCode -ne 200) { throw "No disponible: $url" }
    Write-Host "OK $url"
}
Write-Host 'Comprobación técnica completada. No sustituye pruebas UAT ni de aislamiento con usuarios reales.'
