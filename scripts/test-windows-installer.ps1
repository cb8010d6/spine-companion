param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,
  [string] $ApiBase = "http://127.0.0.1:17388"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$installDir = Join-Path $env:RUNNER_TEMP "spine-companion-install"
$profileDir = Join-Path $env:APPDATA "spine-companion"
$retentionMarker = Join-Path $profileDir "ci-retention.marker"
$exe = Join-Path $installDir "spine-companion.exe"
$uninstaller = Join-Path $installDir "uninstall.exe"
$stdout = Join-Path $env:RUNNER_TEMP "spine-companion-api.stdout.log"
$stderr = Join-Path $env:RUNNER_TEMP "spine-companion-api.stderr.log"
$process = $null
$installed = $false

function Stop-ProcessTree([int] $ProcessId) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId")) {
    Stop-ProcessTree $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

try {
  $install = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($install.ExitCode)."
  }
  $installed = $true
  if (-not (Test-Path -LiteralPath $exe)) {
    throw "Installed executable not found: $exe"
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    throw "Installed uninstaller not found: $uninstaller"
  }

  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Set-Content -LiteralPath $retentionMarker -Value "preserve user data" -Encoding utf8
  $env:COMPANION_API = $ApiBase
  $process = Start-Process -FilePath $exe -WorkingDirectory $installDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $health = $null
  do {
    if ($process.HasExited) {
      throw "Installed executable exited before the API became healthy. See $stderr"
    }
    try {
      $health = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 2
    } catch {
      $health = $null
    }
    if ($health -and $health.ok -eq $true) { break }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not ($health -and $health.ok -eq $true)) {
    throw "Installed API did not become healthy within 45 seconds. See $stderr"
  }

  bun scripts/check-packaged-mcp.mjs $exe
} finally {
  if ($process) {
    Stop-ProcessTree $process.Id
  }
  if ($installed -and (Test-Path -LiteralPath $uninstaller)) {
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) {
      throw "NSIS uninstaller failed with exit code $($uninstall.ExitCode)."
    }
    Start-Sleep -Seconds 3
  }
  if ($installed -and (Test-Path -LiteralPath $exe)) {
    throw "Installed executable remains after silent uninstall: $exe"
  }
  if ($installed -and -not (Test-Path -LiteralPath $retentionMarker)) {
    throw "Silent uninstall unexpectedly removed the user data directory."
  }
  if (Test-Path -LiteralPath $retentionMarker) {
    Remove-Item -LiteralPath $retentionMarker -Force
  }
}
