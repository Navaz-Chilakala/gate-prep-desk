# One-click start: makes sure Ollama and the GATE Prep Desk server are running, then opens the app window.
# Used by the "GATE Prep Desk" desktop shortcut (through "GATE Prep Desk.vbs", which hides this window).
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = 'http://localhost:8765/'
function Up([string]$u) { try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }

if (-not (Up 'http://localhost:11434/api/version')) {
  # Let Ollama answer two requests side by side (the app runs several tasks at once). Only affects the Ollama started here.
  if (-not $env:OLLAMA_NUM_PARALLEL) { $env:OLLAMA_NUM_PARALLEL = '2' }
  $ollamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
  if (Test-Path -LiteralPath $ollamaApp) { Start-Process -FilePath $ollamaApp }
  else { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden }
}

if (-not (Up ($Url + 'api/ping'))) {
  $env:GATE_TUTOR_NO_BROWSER = '1'
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$Root\server.ps1`"")
  for ($i = 0; $i -lt 60 -and -not (Up ($Url + 'api/ping')); $i++) { Start-Sleep -Milliseconds 250 }
}

# Open in its own window (no tabs or address bar) when Edge or Chrome is available.
$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if ($browsers) { Start-Process -FilePath $browsers[0] -ArgumentList "--app=$Url" }
else { Start-Process $Url }
