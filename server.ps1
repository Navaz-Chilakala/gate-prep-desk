# GATE CS Tutor - tiny local web server (no installs needed).
# Serves .\app\ and stores every uploaded PDF/image set as its own temporary site in .\sites\<id>\
# (open it at http://localhost:<port>/site.html?id=<id>; deleting the site deletes that folder).
param([int]$Port = 8765)

$ErrorActionPreference = 'Stop'
$Root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$App   = Join-Path $Root 'app'
$Sites = Join-Path $Root 'sites'
$Hub   = Join-Path $Sites '_hub.json'
$WebCacheFile = Join-Path $Sites '_webcache.json'
New-Item -ItemType Directory -Force $Sites | Out-Null
# Deleted books are first moved here in one step (so a half-finished delete can never leave a book listed),
# then removed; anything Windows still had locked is cleared on the next start.
$Trash = Join-Path $Sites '_trash'
if (Test-Path -LiteralPath $Trash) { Remove-Item -LiteralPath $Trash -Recurse -Force -ErrorAction SilentlyContinue }

$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.pdf' = 'application/pdf'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.bmp' = 'image/bmp'; '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'; '.wasm' = 'application/wasm'; '.gz' = 'application/octet-stream'
  '.webmanifest' = 'application/manifest+json'
}
$IdRe   = '[a-z0-9]{12,40}'
$FileRe = 'f\d{3}__[\w.-]+\.(pdf|png|jpg|gif|webp|bmp)'
$Utf8   = New-Object Text.UTF8Encoding $false

function Send($ctx, [int]$code, [byte[]]$bytes, [string]$type, [string]$cache = 'no-store') {
  $res = $ctx.Response
  $res.StatusCode = $code
  if ($type) { $res.ContentType = $type }
  $res.Headers['Cache-Control'] = $cache
  $res.ContentLength64 = $bytes.Length
  if ($bytes.Length) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.Close()
}
function SendText($ctx, [int]$code, [string]$text, [string]$type = 'application/json; charset=utf-8') {
  Send $ctx $code ([Text.Encoding]::UTF8.GetBytes($text)) $type
}
function SendFile($ctx, [string]$path, [string]$cache = 'no-store') {
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    Send $ctx 200 ([IO.File]::ReadAllBytes($path)) $Mime[[IO.Path]::GetExtension($path).ToLower()] $cache
  } else { SendText $ctx 404 '{"error":"not found"}' }
}
function ReadBody($req) {
  $ms = New-Object IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  , $ms.ToArray()
}
# Crash-safe save: write a temp file next to the target, then swap it in, so a crash or power cut
# mid-write never leaves a half-written file. With $bak, the previous version is kept there.
function SaveAtomic([string]$path, [byte[]]$bytes, [string]$bak) {
  $tmp = $path + '.tmp'
  [IO.File]::WriteAllBytes($tmp, $bytes)
  if (Test-Path -LiteralPath $path) { [IO.File]::Replace($tmp, $path, $(if ($bak) { $bak } else { [NullString]::Value })) }
  else { [IO.File]::Move($tmp, $path) }
}
function SniffExt([byte[]]$b) {
  if ($b.Length -lt 12) { return $null }
  $h = [Text.Encoding]::ASCII.GetString($b, 0, 12)
  if ($h.StartsWith('%PDF-')) { return 'pdf' }
  if ($b[0] -eq 0x89 -and $h.Substring(1, 3) -eq 'PNG') { return 'png' }
  if ($b[0] -eq 0xFF -and $b[1] -eq 0xD8) { return 'jpg' }
  if ($h.StartsWith('GIF8')) { return 'gif' }
  if ($h.StartsWith('RIFF') -and $h.Substring(8, 4) -eq 'WEBP') { return 'webp' }
  if ($h.StartsWith('BM')) { return 'bmp' }
  return $null
}
function SiteFiles([string]$dir) {
  @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -match "^$FileRe$" } | Sort-Object Name | ForEach-Object { $_.Name })
}
# Saves an uploaded file into a site folder as f001__name.ext; returns the stored name or $null if not a PDF/image.
function AddFile([string]$dir, $req, [byte[]]$bytes) {
  $ext = SniffExt $bytes
  if (-not $ext) { return $null }
  $name = 'file'
  if ($req.Headers['X-Filename']) { $name = [Uri]::UnescapeDataString($req.Headers['X-Filename']) }
  $base = [IO.Path]::GetFileNameWithoutExtension($name) -replace '[^\w.-]', '_'
  if ($base.Length -gt 60) { $base = $base.Substring(0, 60) }
  if (-not $base) { $base = 'file' }
  $n = (SiteFiles $dir).Count + 1
  $fname = ('f{0:D3}__{1}.{2}' -f $n, $base, $ext)
  [IO.File]::WriteAllBytes((Join-Path $dir $fname), $bytes)
  return $fname
}

# ---------- stable-diffusion.cpp (tools\sd) ----------
$script:SdPort = 7861
function SdPaths {
  $base = Join-Path $Root 'tools\sd'
  $model = Get-ChildItem -LiteralPath (Join-Path $base 'models') -Filter '*.safetensors' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'vae' -and $_.Length -gt 1GB } | Select-Object -First 1
  if (-not $model) { $model = Get-ChildItem -LiteralPath (Join-Path $base 'models') -Filter '*.gguf' -File -ErrorAction SilentlyContinue | Select-Object -First 1 }
  $vae = Get-ChildItem -LiteralPath (Join-Path $base 'models') -Filter '*vae*.safetensors' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $model) { return $null }
  return @{ base = $base; model = $model.FullName; vae = $(if ($vae) { $vae.FullName } else { '' }) }
}
function SdAlive { try { Invoke-RestMethod -Uri "http://127.0.0.1:$($script:SdPort)/v1/models" -TimeoutSec 2 | Out-Null; return $true } catch { return $false } }
function SdStop { if ($script:SdProc -and -not $script:SdProc.HasExited) { try { $script:SdProc.Kill() } catch {} }; $script:SdProc = $null }
# Starts sd-server if it isn't running: CUDA first, Vulkan if CUDA fails. Weights stay in RAM and move to the GPU only
# while a picture is being made (--offload-to-cpu), so the tutor's language model keeps its GPU memory. Returns an error or ''.
function SdStart($sd) {
  if (SdAlive) { return '' }
  SdStop
  $order = if ($script:SdBackend) { @($script:SdBackend) } else { @('cuda', 'vulkan') }
  foreach ($be in $order) {
    $exe = Join-Path $sd.base "$be\sd-server.exe"
    if (-not (Test-Path -LiteralPath $exe)) { continue }
    $sdArgs = @('-m', ('"' + $sd.model + '"'), '--listen-port', $script:SdPort, '--offload-to-cpu', '--type', 'q8_0')
    if ($sd.vae) { $sdArgs += @('--vae', ('"' + $sd.vae + '"')) }
    $log = Join-Path ([IO.Path]::GetTempPath()) "gate-sd-$be.log"
    $script:SdProc = Start-Process -FilePath $exe -ArgumentList $sdArgs -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput ($log + '.out') -WorkingDirectory (Split-Path $exe)
    for ($i = 0; $i -lt 180; $i++) {   # loading the model can take a while the first time
      Start-Sleep -Milliseconds 500
      if (SdAlive) { $script:SdBackend = $be; return '' }
      if ($script:SdProc.HasExited) { break }
    }
    SdStop
  }
  return 'The image generator could not start on this GPU (see %TEMP%\gate-sd-cuda.log).'
}

# A C compiler for the C runner: gcc / clang / tcc on PATH, a WinGet-installed WinLibs gcc, or one placed in tools\c.
function FindCompiler {
  if ($script:CcPath -and (Test-Path -LiteralPath $script:CcPath)) { return $script:CcPath }
  $script:CcPath = $null
  foreach ($n in 'gcc', 'clang', 'tcc') { $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { $script:CcPath = $c.Source; return $script:CcPath } }
  $cands = @(Join-Path $Root 'tools\c\bin\gcc.exe'; Join-Path $Root 'tools\tcc\tcc.exe'; 'C:\msys64\ucrt64\bin\gcc.exe'; 'C:\msys64\mingw64\bin\gcc.exe')
  $wg = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $wg) { $cands += @(Get-ChildItem -LiteralPath $wg -Directory -Filter '*WinLibs*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'mingw64\bin\gcc.exe' }) }
  foreach ($p in $cands) { if (Test-Path -LiteralPath $p) { $script:CcPath = $p; return $p } }
  return $null
}

# One .zip with every study space (files + what was read), progress, PYQs, notes and the "My GATE ..." copies.
function MakeBackupZip([string]$dest) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
  $zip = [IO.Compression.ZipFile]::Open($dest, 'Create')
  try {
    # Entries with "/" separators (standard zip, opens anywhere). PDFs and photos are already compressed: fastest.
    $base = (Resolve-Path -LiteralPath $Sites).Path.TrimEnd('\') + '\'
    foreach ($f in Get-ChildItem -LiteralPath $Sites -Recurse -File) {
      $rel = $f.FullName.Substring($base.Length).Replace('\', '/')
      if ($rel.StartsWith('_trash/') -or $rel.EndsWith('.tmp')) { continue }   # deleted books, half-written saves
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [IO.Compression.CompressionLevel]::Fastest) | Out-Null
    }
    foreach ($f in Get-ChildItem -LiteralPath $Root -Filter 'My GATE*.md' -File) {
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, 'notes/' + $f.Name) | Out-Null
    }
    $man = $zip.CreateEntry('gate-desk-backup.json')
    $w = New-Object IO.StreamWriter($man.Open(), $Utf8)
    $w.Write((@{ format = 'gate-desk-full'; version = 1; created = (Get-Date).ToUniversalTime().ToString('o'); sites = @(Get-ChildItem -LiteralPath $Sites -Directory).Count } | ConvertTo-Json -Compress))
    $w.Close()
  } finally { $zip.Dispose() }
}

function Handle($ctx) {
  $req = $ctx.Request
  $path = $req.Url.AbsolutePath
  $method = $req.HttpMethod

  # Only the app's own pages may use the API. Any website open in your browser can send requests to
  # localhost; without this check one could run C code here (/api/runc), replace your data (/api/restore)
  # or shut the app down. Browsers always send Origin (or Sec-Fetch-Site) on such requests, and a page
  # can't fake them. Requests without either come from programs on this laptop (the launcher), not a website.
  if ($path.StartsWith('/api/')) {
    $origin = $req.Headers['Origin']; $site = $req.Headers['Sec-Fetch-Site']
    if (($origin -and $origin -ne "http://localhost:$Port") -or ($site -and $site -notin 'same-origin', 'none')) {
      return SendText $ctx 403 '{"error":"Only GATE Prep Desk itself can use this."}'
    }
  }

  if ($path -eq '/api/ping') { return SendText $ctx 200 'gate-tutor' 'text/plain' }

  # Your covered-topics list, kept as a readable Markdown file next to the app.
  if ($path -eq '/api/topics-file' -and $method -eq 'PUT') {
    SaveAtomic (Join-Path $Root 'My GATE topics.md') (ReadBody $req)
    return SendText $ctx 200 '{"ok":true}'
  }

  # Your own notes, kept as a readable Markdown file next to the app.
  if ($path -eq '/api/notes-file' -and $method -eq 'PUT') {
    SaveAtomic (Join-Path $Root 'My GATE notes.md') (ReadBody $req)
    return SendText $ctx 200 '{"ok":true}'
  }

  # Your formula book, kept as a readable Markdown file next to the app.
  if ($path -eq '/api/formulas-file' -and $method -eq 'PUT') {
    SaveAtomic (Join-Path $Root 'My GATE formulas.md') (ReadBody $req)
    return SendText $ctx 200 '{"ok":true}'
  }

  # Web lookup (only when the app asks for it): Wikipedia, plus Ollama web search if you gave a key.
  if ($path -eq '/api/web' -and $method -eq 'POST') {
    $in = [Text.Encoding]::UTF8.GetString((ReadBody $req)) | ConvertFrom-Json
    $q = [string]$in.q
    $results = New-Object System.Collections.ArrayList
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ua = @{ 'User-Agent' = 'GATEPrepDesk/1.0 (personal study app running on a student laptop; low volume, cached)' }
    # Polite use of Wikipedia: one request per lookup (search + article summaries together), answers cached
    # on disk, and a 10-minute pause if Wikipedia ever says we are asking too often.
    $cacheKey = $q.ToLowerInvariant().Trim()
    if (-not $script:WebCache) { $script:WebCache = @{}; if (Test-Path -LiteralPath $WebCacheFile) { try { (Get-Content -LiteralPath $WebCacheFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $script:WebCache[$_.Name] = $_.Value } } catch {} } }
    if ($script:WebCache.ContainsKey($cacheKey)) { foreach ($x in @($script:WebCache[$cacheKey])) { [void]$results.Add($x) } }
    elseif (-not $script:WikiPauseUntil -or (Get-Date) -gt $script:WikiPauseUntil) {
      try {
        $u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&generator=search&gsrlimit=3&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=3&gsrsearch=' + [Uri]::EscapeDataString($q)
        $s = Invoke-RestMethod -Headers $ua -TimeoutSec 10 -Uri $u
        $pages = @($s.query.pages.PSObject.Properties | ForEach-Object { $_.Value }) | Sort-Object index
        $found = New-Object System.Collections.ArrayList
        foreach ($pg in $pages) {
          $text = [string]$pg.extract
          if ($text.Length -gt 150) { [void]$found.Add(@{ title = "Wikipedia: $($pg.title)"; url = [string]$pg.fullurl; text = $text.Substring(0, [Math]::Min(4000, $text.Length)) }) }
        }
        $script:WebCache[$cacheKey] = @($found)
        [IO.File]::WriteAllText($WebCacheFile, ($script:WebCache | ConvertTo-Json -Depth 5 -Compress), $Utf8)
        foreach ($x in $found) { [void]$results.Add($x) }
      } catch {
        if ("$_" -match 'too many requests|429') { $script:WikiPauseUntil = (Get-Date).AddMinutes(10) }
        Write-Host "Wikipedia lookup failed: $_"
      }
    }
    if ($in.key) {
      try {
        $r = Invoke-RestMethod -Method Post -Uri 'https://ollama.com/api/web_search' -TimeoutSec 15 -ContentType 'application/json' `
          -Headers @{ Authorization = "Bearer $($in.key)" } -Body (@{ query = $q; max_results = 3 } | ConvertTo-Json)
        foreach ($x in @($r.results)) {
          $c = [string]$x.content
          if ($c.Length -gt 200) { [void]$results.Add(@{ title = [string]$x.title; url = [string]$x.url; text = $c.Substring(0, [Math]::Min(4000, $c.Length)) }) }
        }
      } catch { Write-Host "Ollama web search failed: $_" }
    }
    return SendText $ctx 200 (ConvertTo-Json -Depth 4 -Compress @{ results = @($results) })
  }

  # C runner: compile and run a small C program from a question with a real compiler, if one is installed.
  # Only standard headers are allowed (no files, processes or network), and it is stopped after 5 seconds.
  if ($path -eq '/api/cc' -and $method -eq 'GET') {
    $cc = FindCompiler
    return SendText $ctx 200 (ConvertTo-Json -Compress @{ available = [bool]$cc; compiler = $(if ($cc) { [IO.Path]::GetFileNameWithoutExtension($cc) } else { '' }) })
  }
  if ($path -eq '/api/runc' -and $method -eq 'POST') {
    $in = [Text.Encoding]::UTF8.GetString((ReadBody $req)) | ConvertFrom-Json
    $code = [string]$in.code
    $cc = FindCompiler
    if (-not $cc) { return SendText $ctx 200 '{"ok":false,"error":"No C compiler installed"}' }
    $allowed = 'stdio.h', 'stdlib.h', 'string.h', 'math.h', 'ctype.h', 'limits.h', 'stdbool.h', 'stdint.h', 'float.h', 'stddef.h', 'assert.h'
    foreach ($m in [regex]::Matches($code, '#\s*include\s*[<"]([^>"]+)[>"]')) { if ($allowed -notcontains $m.Groups[1].Value) { return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $false; error = "Header not allowed: $($m.Groups[1].Value)" }) } }
    if ($code -match '\b(system|popen|fopen|freopen|remove|rename|tmpfile|exec\w*|spawn\w*|CreateProcess|ShellExecute|socket|__asm__|asm)\s*\(' -or $code.Length -gt 20000) { return SendText $ctx 200 '{"ok":false,"error":"This program uses something the runner does not allow"}' }
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('gate-c-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Force $dir | Out-Null
    try {
      $src = Join-Path $dir 'main.c'; $exe = Join-Path $dir 'main.exe'
      [IO.File]::WriteAllText($src, $code, $Utf8)
      $ccArgs = if ($cc -match 'tcc') { @('-w', '-o', $exe, $src, '-lm') } else { @('-std=gnu11', '-fpermissive', '-O0', '-w', '-o', $exe, $src, '-lm') }
      $p = Start-Process -FilePath $cc -ArgumentList ($ccArgs | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -PassThru -Wait -RedirectStandardError (Join-Path $dir 'cc.txt') -RedirectStandardOutput (Join-Path $dir 'cc-out.txt') -WorkingDirectory $dir
      if ($p.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe)) { return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $false; compileError = ((Get-Content -LiteralPath (Join-Path $dir 'cc.txt') -Raw) + '').Substring(0, [Math]::Min(1500, ((Get-Content -LiteralPath (Join-Path $dir 'cc.txt') -Raw) + '').Length)) }) }
      $inFile = Join-Path $dir 'in.txt'; [IO.File]::WriteAllText($inFile, [string]$in.stdin, $Utf8)
      $run = Start-Process -FilePath $exe -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $dir 'out.txt') -RedirectStandardError (Join-Path $dir 'err.txt') -RedirectStandardInput $inFile -WorkingDirectory $dir
      $null = $run.Handle   # keeps the exit code readable after the process ends (otherwise it reads as null)
      if (-not $run.WaitForExit(5000)) { try { $run.Kill() } catch {}; return SendText $ctx 200 '{"ok":false,"error":"The program ran for more than 5 seconds (infinite loop?)"}' }
      $run.WaitForExit()
      $out = [IO.File]::ReadAllText((Join-Path $dir 'out.txt')) -replace "`r`n", "`n"   # Windows text mode writes \r\n for \n
      if ($out.Length -gt 20000) { $out = $out.Substring(0, 20000) }
      return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $true; stdout = $out; exit = $run.ExitCode; compiler = [IO.Path]::GetFileNameWithoutExtension($cc) })
    } finally { Start-Sleep -Milliseconds 100; Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
  }

  # Local image generation (memory-hook illustrations): stable-diffusion.cpp's sd-server with SDXL-Turbo, started on
  # first use (CUDA build, or the Vulkan build if CUDA doesn't work on this GPU). Pictures are saved in sites\_images,
  # so backups include them.
  if ($path -eq '/api/imagegen/status' -and $method -eq 'GET') {
    $sd = SdPaths
    return SendText $ctx 200 (ConvertTo-Json -Compress @{ installed = [bool]$sd; running = (SdAlive); backend = $(if ($script:SdBackend) { $script:SdBackend } else { '' }); model = $(if ($sd) { [IO.Path]::GetFileName($sd.model) } else { '' }) })
  }
  if ($path -eq '/api/imagegen/stop' -and $method -eq 'POST') { SdStop; return SendText $ctx 200 '{"ok":true}' }
  if ($path -eq '/api/imagegen' -and $method -eq 'POST') {
    $in = [Text.Encoding]::UTF8.GetString((ReadBody $req)) | ConvertFrom-Json
    $sd = SdPaths
    if (-not $sd) { return SendText $ctx 200 '{"ok":false,"error":"Image generation is not installed (tools\\sd)."}' }
    $err = SdStart $sd
    if ($err) { return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $false; error = $err }) }
    $w = [Math]::Min(768, [Math]::Max(256, [int]$(if ($in.width) { $in.width } else { 512 })))
    $h = [Math]::Min(768, [Math]::Max(256, [int]$(if ($in.height) { $in.height } else { 512 })))
    $body = @{ prompt = [string]$in.prompt; negative_prompt = [string]$(if ($in.negative) { $in.negative } else { 'text, letters, words, watermark, blurry, deformed' }); width = $w; height = $h
      steps = [int]$(if ($in.steps) { $in.steps } else { 4 }); cfg_scale = 1.0; sampler_name = 'euler_a'; seed = [long]$(if ($in.seed) { $in.seed } else { -1 }) } | ConvertTo-Json -Compress
    try {
      $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($script:SdPort)/sdapi/v1/txt2img" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 240
      $b64 = @($r.images)[0]
      if (-not $b64) { return SendText $ctx 200 '{"ok":false,"error":"No image came back."}' }
      $dir = Join-Path $Sites '_images'; New-Item -ItemType Directory -Force $dir | Out-Null
      $name = 'img-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString().Substring(0, 6)) + '.png'
      [IO.File]::WriteAllBytes((Join-Path $dir $name), [Convert]::FromBase64String($b64))
      return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $true; url = "/api/image/$name"; backend = $script:SdBackend })
    } catch { return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $false; error = "Generation failed: $($_.Exception.Message)" }) }
  }
  if ($path -eq '/api/image/delete' -and $method -eq 'POST') {
    $in = [Text.Encoding]::UTF8.GetString((ReadBody $req)) | ConvertFrom-Json
    if ([string]$in.url -match '^/api/image/(img-[\w-]+\.png)$') { Remove-Item -LiteralPath (Join-Path (Join-Path $Sites '_images') $Matches[1]) -Force -ErrorAction SilentlyContinue }
    return SendText $ctx 200 '{"ok":true}'
  }
  if ($path -match '^/api/image/(img-[\w-]+\.png)$' -and $method -eq 'GET') { return SendFile $ctx (Join-Path (Join-Path $Sites '_images') $Matches[1]) 'max-age=31536000' }

  # Disk space per study space (for the data health check).
  if ($path -eq '/api/sizes' -and $method -eq 'GET') {
    $list = @(Get-ChildItem -LiteralPath $Sites -Directory | ForEach-Object {
      $fs = @(Get-ChildItem -LiteralPath $_.FullName -Recurse -File)
      @{ id = $_.Name; bytes = [long](($fs | Measure-Object Length -Sum).Sum); files = @($fs | Where-Object { $_.Name -match "^$FileRe$" }).Count; meta = [bool](Test-Path -LiteralPath (Join-Path $_.FullName 'meta.json')) }
    })
    $hubBytes = if (Test-Path -LiteralPath $Hub) { (Get-Item -LiteralPath $Hub).Length } else { 0 }
    return SendText $ctx 200 (ConvertTo-Json -Compress -Depth 4 @{ sites = $list; hub = $hubBytes })
  }

  if ($path -eq '/api/quit' -and $method -eq 'POST') { SdStop; SendText $ctx 200 '{"ok":true}'; $script:Quit = $true; return }

  # Full offline backup: one .zip with every study space (files + what was read), progress, PYQs, notes
  # and the "My GATE ..." Markdown copies. Restore puts it back (after zipping the current data aside).
  if ($path -eq '/api/backup' -and $method -eq 'GET') {
    $name = 'GATE-Prep-Desk-backup-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.zip'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) $name
    MakeBackupZip $tmp
    $ctx.Response.AddHeader('Content-Disposition', "attachment; filename=""$name""")
    $bytes = [IO.File]::ReadAllBytes($tmp)
    Remove-Item -LiteralPath $tmp -Force
    return Send $ctx 200 $bytes 'application/zip'
  }
  # Automatic backup into a folder you chose (e.g. a USB drive or another disk). Keeps the newest $keep
  # automatic backups there and deletes older ones (only files this app named GATE-Prep-Desk-auto-*.zip).
  if ($path -eq '/api/autobackup' -and $method -eq 'POST') {
    $in = [Text.Encoding]::UTF8.GetString((ReadBody $req)) | ConvertFrom-Json
    $folder = [string]$in.folder
    if (-not $folder) { $folder = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'GATE Prep Desk backups' }   # the default
    $keep = [Math]::Max(1, [Math]::Min(20, [int]$(if ($in.keep) { $in.keep } else { 4 })))
    if (-not $folder -or -not [IO.Path]::IsPathRooted($folder)) { return SendText $ctx 400 '{"error":"Give a full folder path, like D:\\GATE backups"}' }
    $full = [IO.Path]::GetFullPath($folder).TrimEnd('\') + '\'
    if ($full.StartsWith(([IO.Path]::GetFullPath($Sites).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { return SendText $ctx 400 '{"error":"Pick a folder outside the app data folder (sites)."}' }
    try { New-Item -ItemType Directory -Force -Path $folder | Out-Null } catch { return SendText $ctx 400 (ConvertTo-Json -Compress @{ error = "Can't use that folder: $($_.Exception.Message)" }) }
    $dest = Join-Path $folder ('GATE-Prep-Desk-auto-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.zip')
    $part = $dest + '.part'
    try { MakeBackupZip $part; Move-Item -LiteralPath $part -Destination $dest -Force }
    catch { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue; return SendText $ctx 500 (ConvertTo-Json -Compress @{ error = "Backup failed: $($_.Exception.Message)" }) }
    $all = @(Get-ChildItem -LiteralPath $folder -File -Filter 'GATE-Prep-Desk-auto-*.zip' | Sort-Object Name -Descending)
    $removed = @()
    if ($all.Count -gt $keep) { foreach ($old in $all[$keep..($all.Count - 1)]) { Remove-Item -LiteralPath $old.FullName -Force; $removed += $old.Name } }
    return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $true; path = $dest; size = (Get-Item -LiteralPath $dest).Length; kept = [Math]::Min($keep, $all.Count); removed = $removed })
  }
  if ($path -eq '/api/restore' -and $method -eq 'POST') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('gate-desk-restore-' + [guid]::NewGuid() + '.zip')
    [IO.File]::WriteAllBytes($tmp, (ReadBody $req))
    try {
      $zip = [IO.Compression.ZipFile]::OpenRead($tmp)
      $ok = $zip.Entries | Where-Object { $_.FullName -eq 'gate-desk-backup.json' }
      $zip.Dispose()
      if (-not $ok) { return SendText $ctx 400 '{"error":"This is not a GATE Prep Desk backup (.zip made with Download full backup)."}' }
      # Keep the current data safe first.
      $safety = 'backup-before-restore-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.zip'
      [IO.Compression.ZipFile]::CreateFromDirectory($Sites, (Join-Path $Root $safety), [IO.Compression.CompressionLevel]::Fastest, $false)
      $new = Join-Path $Root ('sites-restoring-' + [guid]::NewGuid())
      [IO.Compression.ZipFile]::ExtractToDirectory($tmp, $new)
      $notes = Join-Path $new 'notes'
      if (Test-Path -LiteralPath $notes) { Get-ChildItem -LiteralPath $notes -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Root $_.Name) -Force }; Remove-Item -LiteralPath $notes -Recurse -Force }
      Remove-Item -LiteralPath (Join-Path $new 'gate-desk-backup.json') -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $Sites -Recurse -Force
      Move-Item -LiteralPath $new -Destination $Sites
      return SendText $ctx 200 (ConvertTo-Json -Compress @{ ok = $true; safety = $safety })
    } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }

  if ($path -eq '/api/hub') {
    if ($method -eq 'PUT') {
      $body = ReadBody $req
      if ($body.Length -lt 2 -or $body[0] -ne 123) { return SendText $ctx 400 '{"error":"Not a progress file"}' }   # must be a JSON object
      SaveAtomic $Hub $body ($Hub + '.bak'); return SendText $ctx 200 '{"ok":true}'
    }
    if (Test-Path -LiteralPath $Hub) { return SendFile $ctx $Hub }
    return SendText $ctx 200 '{}'
  }

  if ($path -eq '/api/sites' -and $method -eq 'GET') {
    $metas = Get-ChildItem -LiteralPath $Sites -Directory | Sort-Object Name -Descending | ForEach-Object {
      $m = Join-Path $_.FullName 'meta.json'
      if (Test-Path -LiteralPath $m) { [IO.File]::ReadAllText($m) }
    }
    return SendText $ctx 200 ('[' + (@($metas) -join ',') + ']')
  }

  if ($path -eq '/api/sites' -and $method -eq 'POST') {
    $bytes = ReadBody $req
    if (-not (SniffExt $bytes)) { return SendText $ctx 400 '{"error":"Only PDF or image files are supported"}' }
    $rand = -join ((1..6) | ForEach-Object { '0123456789abcdefghijklmnopqrstuvwxyz'[(Get-Random -Maximum 36)] })
    $id = (Get-Date -Format 'yyyyMMddHHmmss') + $rand
    $dir = Join-Path $Sites $id
    New-Item -ItemType Directory -Force $dir | Out-Null
    $fname = AddFile $dir $req $bytes
    $meta = @{ id = $id; name = [Uri]::UnescapeDataString("$($req.Headers['X-Filename'])"); size = $bytes.Length; created = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $dir 'meta.json'), $meta, $Utf8)
    return SendText $ctx 200 $meta
  }

  if ($path -match "^/api/sites/($IdRe)(/.*)?$") {
    $dir = Join-Path $Sites $Matches[1]
    $rest = $Matches[2]
    if (-not (Test-Path -LiteralPath $dir)) {
      if ($method -eq 'DELETE') { return SendText $ctx 200 '{"ok":true}' }
      return SendText $ctx 404 '{"error":"This site was deleted."}'
    }
    if (-not $rest) {
      if ($method -eq 'DELETE') {
        New-Item -ItemType Directory -Force $Trash | Out-Null
        $gone = Join-Path $Trash ((Split-Path $dir -Leaf) + '-' + (Get-Date -Format 'yyyyMMddHHmmss'))
        try { [IO.Directory]::Move($dir, $gone) } catch { return SendText $ctx 500 (ConvertTo-Json -Compress @{ error = "Couldn't delete the book (a file in it is in use): $($_.Exception.Message)" }) }
        Remove-Item -LiteralPath $gone -Recurse -Force -ErrorAction SilentlyContinue
        return SendText $ctx 200 '{"ok":true}'
      }
      return SendFile $ctx (Join-Path $dir 'meta.json')
    }
    if ($rest -eq '/files' -and $method -eq 'POST') {
      $fname = AddFile $dir $req (ReadBody $req)
      if (-not $fname) { return SendText $ctx 400 '{"error":"Only PDF or image files are supported"}' }
      return SendText $ctx 200 ('{"file":"' + $fname + '"}')
    }
    if ($rest -eq '/files') {
      $names = SiteFiles $dir
      if (-not $names.Count) { return SendText $ctx 200 '[]' }
      return SendText $ctx 200 ('["' + ($names -join '","') + '"]')
    }
    if ($rest -match "^/files/($FileRe)$") { return SendFile $ctx (Join-Path $dir $Matches[1]) }
    if ($rest -eq '/data') {
      $file = Join-Path $dir 'data.json'
      if ($method -eq 'PUT') { [IO.File]::WriteAllBytes($file, (ReadBody $req)); return SendText $ctx 200 '{"ok":true}' }
      if (Test-Path -LiteralPath $file) { return SendFile $ctx $file }
      return SendText $ctx 200 '{}'
    }
  }

  if ($method -eq 'GET') {
    if ($path -eq '/') { return SendFile $ctx (Join-Path $App 'index.html') }
    if ($path -match '^/(\w[\w.-]*)$') { return SendFile $ctx (Join-Path $App $Matches[1]) }
    # Bundled libraries, fonts and icons (they never change, so let the browser cache them).
    if ($path -match '^/((?:vendor|icons)/[\w./-]+)$' -and $path -notmatch '\.\.') {
      $full = [IO.Path]::GetFullPath((Join-Path $App ($Matches[1] -replace '/', '\')))
      if ($full.StartsWith($App + '\')) { return SendFile $ctx $full 'public, max-age=31536000' }
    }
  }
  SendText $ctx 404 '{"error":"not found"}'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "GATE CS Tutor running at http://localhost:$Port/   (press Ctrl+C to stop)" -ForegroundColor Green
if (-not $env:GATE_TUTOR_NO_BROWSER) { Start-Process "http://localhost:$Port/" }
try {
  while ($listener.IsListening -and -not $script:Quit) {
    $task = $listener.GetContextAsync()
    while (-not $task.Wait(500)) { }   # poll so Ctrl+C works
    $ctx = $task.Result
    try { Handle $ctx }
    catch {
      Write-Host "Error: $_" -ForegroundColor Red
      try { SendText $ctx 500 ('{"error":' + (ConvertTo-Json "$_") + '}') } catch { }
    }
  }
} finally { $listener.Stop() }
