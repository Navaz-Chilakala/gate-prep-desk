# Downloads every library and font the app uses into app\vendor so it works without internet.
# Run once (needs internet):  powershell -ExecutionPolicy Bypass -File tools\make-offline.ps1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Vendor = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'app\vendor'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function Get-File([string]$url, [string]$rel) {
  $out = Join-Path $Vendor $rel
  New-Item -ItemType Directory -Force (Split-Path -Parent $out) | Out-Null
  if ((Test-Path -LiteralPath $out) -and (Get-Item -LiteralPath $out).Length -gt 0) { return }
  Write-Host "  $rel"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -UserAgent $UA
}

Write-Host 'Libraries...'
$cdnjs = 'https://cdnjs.cloudflare.com/ajax/libs'
Get-File "$cdnjs/pdf.js/3.11.174/pdf.min.js" 'pdfjs/pdf.min.js'
Get-File "$cdnjs/pdf.js/3.11.174/pdf.worker.min.js" 'pdfjs/pdf.worker.min.js'
Get-File "$cdnjs/marked/12.0.2/marked.min.js" 'marked/marked.min.js'
Get-File "$cdnjs/dompurify/3.1.6/purify.min.js" 'dompurify/purify.min.js'
Get-File "$cdnjs/KaTeX/0.16.9/katex.min.js" 'katex/katex.min.js'
Get-File "$cdnjs/KaTeX/0.16.9/katex.min.css" 'katex/katex.min.css'
$katexCss = [IO.File]::ReadAllText((Join-Path $Vendor 'katex/katex.min.css'))
foreach ($m in [regex]::Matches($katexCss, 'url\((fonts/[^)]+\.woff2)\)')) { Get-File "$cdnjs/KaTeX/0.16.9/$($m.Groups[1].Value)" "katex/$($m.Groups[1].Value)" }
Get-ChildItem (Join-Path $Vendor 'katex/fonts') -Include *.woff, *.ttf -Recurse | Remove-Item

Write-Host 'Diagrams...'
Get-File 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js' 'mermaid/mermaid.min.js'

Write-Host 'OCR engine...'
$jsd = 'https://cdn.jsdelivr.net/npm'
Get-File "$jsd/tesseract.js@5.1.1/dist/tesseract.min.js" 'tesseract/tesseract.min.js'
Get-File "$jsd/tesseract.js@5.1.1/dist/worker.min.js" 'tesseract/worker.min.js'
foreach ($c in 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core.wasm.js', 'tesseract-core-simd.wasm.js', 'tesseract-core-relaxedsimd.wasm.js') {
  try { Get-File "$jsd/tesseract.js-core@5.1.1/$c" "tesseract/core/$c" } catch { Write-Host "  (skipped $c)" }
}
Get-File "$jsd/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz" 'tesseract/lang/eng.traineddata.gz'

Write-Host 'Exact runners (SQL, C)...'
Get-File "$cdnjs/sql.js/1.10.3/sql-wasm.js" 'sqljs/sql-wasm.js'
Get-File "$cdnjs/sql.js/1.10.3/sql-wasm.wasm" 'sqljs/sql-wasm.wasm'
Get-File "$jsd/JSCPP@2.0.6/dist/JSCPP.es5.min.js" 'jscpp/JSCPP.es5.min.js'

Write-Host 'Fonts...'
$cssUrl = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;600&family=Source+Sans+3:wght@400;600;700&display=swap'
$css = (Invoke-WebRequest -Uri $cssUrl -UseBasicParsing -UserAgent $UA).Content
$i = 0
$css = [regex]::Replace($css, 'url\((https://fonts\.gstatic\.com/[^)]+)\)', {
  param($m)
  $script:i++
  $name = "f$($script:i).woff2"
  Get-File $m.Groups[1].Value "fonts/$name"
  "url($name)"
})
New-Item -ItemType Directory -Force (Join-Path $Vendor 'fonts') | Out-Null
[IO.File]::WriteAllText((Join-Path $Vendor 'fonts/fonts.css'), $css, (New-Object Text.UTF8Encoding $false))

$size = (Get-ChildItem -Recurse -File $Vendor | Measure-Object Length -Sum).Sum
Write-Host ("Done. app\vendor holds {0:N1} MB; the app now works offline." -f ($size / 1MB)) -ForegroundColor Green
