param(
  [switch]$NoRestart,
  [ValidateRange(0, 60)]
  [int]$DelaySeconds = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$piWeb = Join-Path $root "resources\pi-web"
$nextDir = Join-Path $piWeb ".next"
$backupRoot = Join-Path $root ".backup"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $backupRoot "pi-web-next-$stamp"
$logFile = Join-Path $env:TEMP "pi-web-diagnostics-build-$stamp.log"
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
$requiredMarkers = @("provider_stream_terminal_event", "client_lifecycle", "toolCount")

function Write-Log([string]$message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
  $line | Tee-Object -FilePath $logFile -Append
}

function Stop-DesktopProcesses {
  $escapedRoot = [regex]::Escape($root)
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -ieq "electron.exe" -or $_.Name -ieq "node.exe") -and
      $_.CommandLine -match $escapedRoot
    } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { }
    }
  Start-Sleep -Seconds 2
}

function Start-Desktop {
  if ($NoRestart) { return }
  Write-Log "Starting pi-web-desktop"
  $desktopProcess = Start-Process -FilePath $electron -ArgumentList ('"{0}" --project "{0}"' -f $root) -WorkingDirectory $root -PassThru
  Start-Sleep -Seconds 3
  if ($desktopProcess.HasExited) {
    throw "pi-web-desktop exited immediately with code $($desktopProcess.ExitCode)"
  }
  Write-Log "pi-web-desktop started: pid=$($desktopProcess.Id)"
}

try {
  if ($DelaySeconds -gt 0) {
    Write-Log "Waiting $DelaySeconds seconds before controlled restart"
    Start-Sleep -Seconds $DelaySeconds
  }
  Write-Log "Stopping current pi-web-desktop processes"
  Stop-DesktopProcesses

  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  if (Test-Path $backupDir) { Remove-Item -Recurse -Force $backupDir }
  if (Test-Path $nextDir) {
    Write-Log "Backing up current .next to $backupDir"
    Move-Item -Path $nextDir -Destination $backupDir
  }

  Write-Log "Building resources/pi-web"
  $buildStdout = Join-Path $env:TEMP "pi-web-diagnostics-build-$stamp.stdout.log"
  $buildStderr = Join-Path $env:TEMP "pi-web-diagnostics-build-$stamp.stderr.log"
  $buildProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/s", "/c", "npm.cmd run build") `
    -WorkingDirectory $piWeb -RedirectStandardOutput $buildStdout -RedirectStandardError $buildStderr -Wait -PassThru -NoNewWindow
  if (Test-Path $buildStdout) { Get-Content -Raw $buildStdout | Add-Content -Path $logFile }
  if (Test-Path $buildStderr) { Get-Content -Raw $buildStderr | Add-Content -Path $logFile }
  Remove-Item $buildStdout, $buildStderr -Force -ErrorAction SilentlyContinue
  if ($buildProcess.ExitCode -ne 0) { throw "Next build exited with code $($buildProcess.ExitCode)" }

  $buildIdPath = Join-Path $nextDir "BUILD_ID"
  if (-not (Test-Path $buildIdPath)) { throw "New build has no BUILD_ID" }
  $serverFiles = (Get-ChildItem (Join-Path $nextDir "server") -Recurse -File -Include *.js).FullName
  foreach ($marker in $requiredMarkers) {
    $found = $false
    foreach ($serverFile in $serverFiles) {
      if (Select-String -LiteralPath $serverFile -SimpleMatch $marker -Quiet) {
        $found = $true
        break
      }
    }
    if (-not $found) { throw "New build is missing diagnostic marker: $marker" }
  }

  $buildId = (Get-Content -Raw -Encoding UTF8 $buildIdPath).Trim()
  Write-Log "Build verified: $buildId"
  Write-Log "Stopping any desktop instance opened during the build"
  Stop-DesktopProcesses
  Start-Desktop
  Write-Log "Completed successfully; rollback backup: $backupDir"
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  Stop-DesktopProcesses
  if (Test-Path $nextDir) { Remove-Item -Recurse -Force $nextDir }
  if (Test-Path $backupDir) {
    Write-Log "Restoring previous .next"
    Move-Item -Path $backupDir -Destination $nextDir
  }
  try {
    Start-Desktop
    Write-Log "Rollback completed"
  } catch {
    Write-Log "Rollback restored .next but desktop restart failed: $($_.Exception.Message)"
  }
  exit 1
}
