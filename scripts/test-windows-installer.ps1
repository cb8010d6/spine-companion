param(
  [Parameter(Mandatory = $true)]
  [string] $InstallerPath,
  [string] $PreviousInstallerPath,
  [string] $PreviousInstallerSha256,
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
if ($previousInstaller -and -not [string]::IsNullOrWhiteSpace($PreviousInstallerSha256)) {
  $actualPreviousSha256 = (Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256).Hash
  if (-not $actualPreviousSha256.Equals($PreviousInstallerSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Previous installer SHA-256 is $actualPreviousSha256; expected $PreviousInstallerSha256."
  }
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
$originalUserProfile = $env:USERPROFILE
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalCompanionApi = $env:COMPANION_API
$originalCompanionPort = $env:COMPANION_PORT
$originalSpineCompanionConfigDir = $env:SPINE_COMPANION_CONFIG_DIR
$apiUri = $null
$apiOrigin = $null
$upgradeFixture = $false
$preservedConfigPath = $null
$preservedConfigSha256 = $null
$preservedModelMarkerPath = $null
$preservedModelMarkerSha256 = $null
$preservedModelFiles = @()
$preservedAiConfigPath = $null
$preservedAiConfigSha256 = $null

function Assert-UnderRunnerTemp([string] $Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = $runnerTemp.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a path outside RUNNER_TEMP: $fullPath"
  }
}

try {
  $apiUri = [Uri]$ApiBase
} catch {
  throw "ApiBase must be a valid HTTP loopback URL: $ApiBase"
}
if ($apiUri.Scheme -ne "http" -or -not $apiUri.IsLoopback -or $apiUri.Port -le 0) {
  throw "ApiBase must use an HTTP loopback address with an explicit port: $ApiBase"
}
$apiOrigin = $ApiBase.TrimEnd('/')
$listening = @(Get-NetTCPConnection -State Listen -LocalPort $apiUri.Port -ErrorAction SilentlyContinue)
if ($listening.Count -gt 0) {
  throw "ApiBase port $($apiUri.Port) is already in use; refusing to probe an existing app."
}

function Stop-ProcessTree([int] $ProcessId) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId")) {
    Stop-ProcessTree $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-SilentInstall([string] $PackagePath) {
  $install = Start-Process -FilePath $PackagePath -ArgumentList @("/S", "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
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

function Invoke-SilentUninstall([string] $UninstallerPath) {
  $transientDllInitializationFailure = -1073741502 # 0xC0000142
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $uninstall = Start-Process -FilePath $UninstallerPath -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
    if ($uninstall.ExitCode -eq 0) {
      return
    }
    if ($attempt -eq 1 -and $uninstall.ExitCode -eq $transientDllInitializationFailure) {
      Start-Sleep -Seconds 2
      continue
    }
    throw "NSIS uninstaller failed with exit code $($uninstall.ExitCode)."
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
  $userProfileRoot = Join-Path $testDataRoot "UserProfile"
  New-Item -ItemType Directory -Path $userProfileRoot -Force | Out-Null
  $env:APPDATA = $appDataRoot
  $env:LOCALAPPDATA = $localAppDataRoot
  $env:USERPROFILE = $userProfileRoot
  $env:TEMP = $runnerTemp
  $env:TMP = $runnerTemp
  Remove-Item Env:SPINE_COMPANION_CONFIG_DIR -ErrorAction SilentlyContinue
  # Keep the runtime and probe endpoint aligned when CI supplies an isolated
  # port; otherwise a stale default port could make the smoke test hit another
  # process or fail before the package is exercised.
  $env:COMPANION_PORT = [string]$apiUri.Port

  if ($previousInstaller) {
    $installationAttempted = $true
    Invoke-SilentInstall $previousInstaller
  }

  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Set-Content -LiteralPath $retentionMarker -Value "preserve user data" -Encoding utf8
  $retentionMarkerCreated = $true

  if ($previousInstaller) {
    # Seed a realistic per-user upgrade profile after the old package is
    # installed. The new NSIS package must leave these files byte-for-byte
    # unchanged. This fixture validates retention and /config loading only;
    # it is not a renderer or physical model-load test.
    $upgradeFixture = $true
    $modelDir = Join-Path $profileDir "models\upgrade-fixture"
    New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
    $fixtureMetadata = @{
      id = "upgrade-fixture"
      name = "Upgrade Fixture"
      skel = "fixture.skel"
      source = "ci-fixture"
    } | ConvertTo-Json -Depth 5
    Set-Content -LiteralPath (Join-Path $modelDir ".companion-model.json") -Value $fixtureMetadata -Encoding utf8
    Set-Content -LiteralPath (Join-Path $modelDir "fixture.skel") -Value "fixture skeleton bytes" -Encoding utf8
    Set-Content -LiteralPath (Join-Path $modelDir "fixture.atlas") -Value "fixture.png`nsize: 1,1`n" -Encoding utf8
    [System.IO.File]::WriteAllBytes((Join-Path $modelDir "fixture.png"), [byte[]]::new(0))

    $preservedConfigPath = Join-Path $profileDir "companion.local.json"
    $fixtureConfig = @{
      window = @{ width = 518; height = 612; x = 177; y = 233; alwaysOnTop = $false; transparent = $true }
      spine = @{ assetDir = "models/upgrade-fixture"; skel = "fixture.skel"; scale = 1.37; offsetX = 21; offsetY = -33; fitMode = "character" }
      ui = @{ hudVisible = $true; bubbleVisible = $false; bubbleShadow = $false; bubbleBackground = "soft"; bubbleHoldMs = 12345; dragMode = "compatible"; frameRateMode = "30"; autoRevealOnMcp = $false; systemNotifications = $false; updateAutoCheck = $false; updateChannel = "stable"; maxDevicePixelRatio = 1.5; hitboxPadding = 19; gpuMode = "software"; debugHitbox = $true }
      models = @{ catalog = @(@{ id = "upgrade-fixture"; name = "Upgrade Fixture"; skel = "fixture.skel"; source = "ci-fixture" }); presentations = @{ "upgrade-fixture" = @{ scale = 1.37; offsetX = 21; offsetY = -33; fitMode = "character" } } }
    } | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath $preservedConfigPath -Value $fixtureConfig -Encoding utf8
    $preservedConfigSha256 = (Get-FileHash -LiteralPath $preservedConfigPath -Algorithm SHA256).Hash

    $preservedModelMarkerPath = Join-Path $modelDir ".companion-model.json"
    $preservedModelMarkerSha256 = (Get-FileHash -LiteralPath $preservedModelMarkerPath -Algorithm SHA256).Hash
    $preservedModelFiles = @(
      (Join-Path $modelDir "fixture.skel"),
      (Join-Path $modelDir "fixture.atlas"),
      (Join-Path $modelDir "fixture.png")
    ) | ForEach-Object {
      @{ Path = $_; Hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash; Label = "downloaded model file" }
    }

    $codexDir = Join-Path $userProfileRoot ".codex"
    New-Item -ItemType Directory -Path $codexDir -Force | Out-Null
    $preservedAiConfigPath = Join-Path $codexDir "config.toml"
    $aiFixture = @"
model = "user-model"

[profiles.user]
color = "keep-user-profile"

[mcp_servers.existing]
command = "keep-existing-server"

[mcp_servers.spine_companion]
command = "old-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", USER_SETTING = "keep-user-setting" }
"@
    Set-Content -LiteralPath $preservedAiConfigPath -Value $aiFixture -Encoding utf8
    $preservedAiConfigSha256 = (Get-FileHash -LiteralPath $preservedAiConfigPath -Algorithm SHA256).Hash
  }

  $installationAttempted = $true
  Invoke-SilentInstall $installer

  if ($upgradeFixture) {
    foreach ($fixture in @(
      @{ Path = $preservedConfigPath; Hash = $preservedConfigSha256; Label = "user config" },
      @{ Path = $preservedModelMarkerPath; Hash = $preservedModelMarkerSha256; Label = "downloaded model metadata" },
      @{ Path = $preservedAiConfigPath; Hash = $preservedAiConfigSha256; Label = "AI client config" }
    ) + @($preservedModelFiles)) {
      if (-not (Test-Path -LiteralPath $fixture.Path)) {
        throw "Upgrade removed the preserved $($fixture.Label): $($fixture.Path)"
      }
      $actualHash = (Get-FileHash -LiteralPath $fixture.Path -Algorithm SHA256).Hash
      if (-not $actualHash.Equals($fixture.Hash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Upgrade changed the preserved $($fixture.Label): $($fixture.Path)"
      }
    }
  }

  $env:COMPANION_API = $apiOrigin
  $process = Start-Process -FilePath $exe -WorkingDirectory $installDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $health = $null
  do {
    if ($process.HasExited) {
      throw "Installed executable exited before the API became healthy. See $stderr"
    }
    try {
      $health = Invoke-RestMethod -Uri "$apiOrigin/health" -TimeoutSec 2
    } catch {
      $health = $null
    }
    if ($health -and $health.ok -eq $true) { break }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not ($health -and $health.ok -eq $true)) {
    throw "Installed API did not become healthy within 45 seconds. See $stderr"
  }

  if ($upgradeFixture) {
    $runtimeConfig = Invoke-RestMethod -Uri "$apiOrigin/config" -TimeoutSec 5
    if ($runtimeConfig.window.width -ne 518 -or $runtimeConfig.window.height -ne 612 -or $runtimeConfig.window.x -ne 177 -or $runtimeConfig.window.y -ne 233) {
      throw "Upgrade did not preserve the configured window geometry."
    }
    if ($runtimeConfig.spine.scale -ne 1.37 -or $runtimeConfig.spine.offsetX -ne 21 -or $runtimeConfig.spine.offsetY -ne -33 -or $runtimeConfig.spine.fitMode -ne "character") {
      throw "Upgrade did not preserve the active model presentation settings."
    }
    if ($runtimeConfig.ui.hudVisible -ne $true -or $runtimeConfig.ui.bubbleVisible -ne $false -or $runtimeConfig.ui.gpuMode -ne "software" -or $runtimeConfig.ui.hitboxPadding -ne 19) {
      throw "Upgrade did not preserve UI settings."
    }
    $expectedAssetDir = Join-Path $profileDir "models\upgrade-fixture"
    if ($runtimeConfig.spine.assetDir -ne $expectedAssetDir -or $runtimeConfig.spine.skel -ne "fixture.skel") {
      throw "Upgrade did not preserve the active model path."
    }
    foreach ($fixture in $preservedModelFiles) {
      $actualHash = (Get-FileHash -LiteralPath $fixture.Path -Algorithm SHA256).Hash
      if (-not $actualHash.Equals($fixture.Hash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "App startup changed the preserved $($fixture.Label): $($fixture.Path)"
      }
    }
  }

  $statusOutput = & $exe --status --json | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Installed read-only status command failed with exit code $LASTEXITCODE."
  }
  $status = $statusOutput | ConvertFrom-Json
  if (-not ($status.ok -eq $true -and $status.mutated -eq $false)) {
    throw "Installed read-only status command returned an invalid result."
  }

  $doctorOutput = & $exe --doctor --json | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Installed read-only doctor command failed with exit code $LASTEXITCODE."
  }
  $doctor = $doctorOutput | ConvertFrom-Json
  if (-not ($doctor.ok -eq $true -and $doctor.mcp.version -match '^0\.2\.6')) {
    throw "Installed read-only doctor command returned an invalid health result or package version."
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
      Invoke-SilentUninstall $uninstaller
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
  $env:USERPROFILE = $originalUserProfile
  $env:TEMP = $originalTemp
  $env:TMP = $originalTmp
  $env:COMPANION_API = $originalCompanionApi
  $env:COMPANION_PORT = $originalCompanionPort
  $env:SPINE_COMPANION_CONFIG_DIR = $originalSpineCompanionConfigDir

  if ($upgradeFixture -and $installationAttempted) {
    foreach ($fixture in @(
      @{ Path = $preservedConfigPath; Hash = $preservedConfigSha256; Label = "user config" },
      @{ Path = $preservedModelMarkerPath; Hash = $preservedModelMarkerSha256; Label = "downloaded model metadata" },
      @{ Path = $preservedAiConfigPath; Hash = $preservedAiConfigSha256; Label = "AI client config" }
    ) + @($preservedModelFiles)) {
      if (-not (Test-Path -LiteralPath $fixture.Path)) {
        [void] $cleanupErrors.Add("Uninstall removed the preserved $($fixture.Label): $($fixture.Path)")
        continue
      }
      $actualHash = (Get-FileHash -LiteralPath $fixture.Path -Algorithm SHA256).Hash
      if (-not $actualHash.Equals($fixture.Hash, [System.StringComparison]::OrdinalIgnoreCase)) {
        [void] $cleanupErrors.Add("Uninstall changed the preserved $($fixture.Label): $($fixture.Path)")
      }
    }
  }

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
