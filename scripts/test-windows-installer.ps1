param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,
  [string] $PreviousInstallerPath,
  [string] $ApiBase = "http://127.0.0.1:17388"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or -not (Test-Path -LiteralPath $env:RUNNER_TEMP)) {
  throw "RUNNER_TEMP must point to an existing isolated temporary directory."
}

$runnerTemp = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$previousInstaller = if ([string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
  $null
} else {
  (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
}

$installDir = Join-Path $runnerTemp "spine-companion-install"
$testDataRoot = Join-Path $runnerTemp "spine-companion-profile"
$appDataRoot = Join-Path $testDataRoot "Roaming"
$localAppDataRoot = Join-Path $testDataRoot "Local"
$profileDir = Join-Path $appDataRoot "spine-companion"
$retentionMarker = Join-Path $profileDir "ci-retention.marker"
$exe = Join-Path $installDir "spine-companion.exe"
$uninstaller = Join-Path $installDir "uninstall.exe"
$stdout = Join-Path $runnerTemp "spine-companion-api.stdout.log"
$stderr = Join-Path $runnerTemp "spine-companion-api.stderr.log"
$process = $null
$installationAttempted = $false
$retentionMarkerCreated = $false
$primaryError = $null
$cleanupErrors = [System.Collections.Generic.List[string]]::new()
$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalCompanionApi = $env:COMPANION_API

function Assert-UnderRunnerTemp([string] $Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = $runnerTemp.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a path outside RUNNER_TEMP: $fullPath"
  }
}

function Stop-ProcessTree([int] $ProcessId) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId")) {
    Stop-ProcessTree $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-SilentInstall([string] $PackagePath) {
  $install = Start-Process -FilePath $PackagePath -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($install.ExitCode): $PackagePath"
  }
  if (-not (Test-Path -LiteralPath $exe)) {
    throw "Installed executable not found after installing $PackagePath`: $exe"
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    throw "Installed uninstaller not found after installing $PackagePath`: $uninstaller"
  }
}

Assert-UnderRunnerTemp $installDir
Assert-UnderRunnerTemp $testDataRoot

try {
  if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $testDataRoot) {
    Remove-Item -LiteralPath $testDataRoot -Recurse -Force
  }

  New-Item -ItemType Directory -Path $appDataRoot, $localAppDataRoot -Force | Out-Null
  $env:APPDATA = $appDataRoot
  $env:LOCALAPPDATA = $localAppDataRoot
  $env:TEMP = $runnerTemp
  $env:TMP = $runnerTemp

  if ($previousInstaller) {
    $installationAttempted = $true
    Invoke-SilentInstall $previousInstaller
  }

  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Set-Content -LiteralPath $retentionMarker -Value "preserve user data" -Encoding utf8
  $retentionMarkerCreated = $true

  $installationAttempted = $true
  Invoke-SilentInstall $installer

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

  & bun scripts/check-packaged-mcp.mjs $exe
  if ($LASTEXITCODE -ne 0) {
    throw "Packaged MCP smoke failed with exit code $LASTEXITCODE."
  }
} catch {
  $primaryError = $_
} finally {
  if ($process) {
    try {
      Stop-ProcessTree $process.Id
    } catch {
      [void] $cleanupErrors.Add("Unable to stop installed process: $($_.Exception.Message)")
    }
  }

  if ($installationAttempted -and (Test-Path -LiteralPath $uninstaller)) {
    try {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
      if ($uninstall.ExitCode -ne 0) {
        [void] $cleanupErrors.Add("NSIS uninstaller failed with exit code $($uninstall.ExitCode).")
      }
      Start-Sleep -Seconds 3
    } catch {
      [void] $cleanupErrors.Add("Unable to run the NSIS uninstaller: $($_.Exception.Message)")
    }
  }

  if ($installationAttempted -and (Test-Path -LiteralPath $exe)) {
    [void] $cleanupErrors.Add("Installed executable remains after silent uninstall: $exe")
  }
  if ($retentionMarkerCreated -and -not (Test-Path -LiteralPath $retentionMarker)) {
    [void] $cleanupErrors.Add("Silent uninstall unexpectedly removed the user data directory.")
  }

  $env:APPDATA = $originalAppData
  $env:LOCALAPPDATA = $originalLocalAppData
  $env:TEMP = $originalTemp
  $env:TMP = $originalTmp
  $env:COMPANION_API = $originalCompanionApi

  foreach ($path in @($installDir, $testDataRoot)) {
    try {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
      }
    } catch {
      [void] $cleanupErrors.Add("Unable to clean temporary path $path`: $($_.Exception.Message)")
    }
  }
}

$failureMessages = [System.Collections.Generic.List[string]]::new()
if ($primaryError) {
  [void] $failureMessages.Add("Windows installer smoke failed: $($primaryError.Exception.Message)")
}
foreach ($cleanupError in $cleanupErrors) {
  [void] $failureMessages.Add("Windows installer smoke cleanup failed: $cleanupError")
}
if ($failureMessages.Count -gt 0) {
  throw ($failureMessages -join [Environment]::NewLine)
}
