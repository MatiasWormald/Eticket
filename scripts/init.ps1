[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$utf8 = New-Object System.Text.UTF8Encoding($false)
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
if (!(Test-Path -LiteralPath '.env')) {
    $content = Get-Content -LiteralPath '.env.example' -Raw
    foreach ($key in @('GLPI_DB_PASSWORD', 'GLPI_DB_ROOT_PASSWORD', 'GLPI_ADMIN_PASSWORD')) {
        $content = [regex]::Replace($content, "(?m)^$key=.*$", "$key=$(New-Secret)")
    }
    [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $content, $utf8)
    Write-Host '.env creado con claves aleatorias. No se muestra ni se versiona.'
} else {
    Write-Host 'Se conserva el .env existente; no se cambian claves de la base.'
}
$archive = 'glpi-12.0.0.tgz'
$expected = '90c81d1742f5e345756089a83e7c72848bbcae130ea449c8d32f52ad63dece91'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/glpi-project/glpi/releases/download/12.0.0/$archive" -OutFile "$archive.download"
    if ((Get-FileHash "$archive.download" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw 'El paquete descargado no coincide con la huella registrada. No se utilizará.'
    }
    Move-Item -LiteralPath "$archive.download" -Destination $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'El paquete local de GLPI no coincide con la huella registrada.'
}
docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Configuración Compose inválida.' }
Write-Host 'Preparado. Ejecuta: docker compose up -d --build --wait'
