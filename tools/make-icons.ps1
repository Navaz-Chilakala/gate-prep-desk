# Draws the GATE Prep Desk icon (ink-blue tile, cream serif "G", red pencil underline)
# into app\icons\ as PNGs plus a multi-size .ico for the desktop shortcut.
Add-Type -AssemblyName System.Drawing
$Out = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'app\icons'
New-Item -ItemType Directory -Force $Out | Out-Null

function Draw-Icon([int]$n, [bool]$maskable) {
  $bmp = New-Object Drawing.Bitmap $n, $n
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([Drawing.Color]::Transparent)
  $rect = New-Object Drawing.RectangleF 0, 0, $n, $n
  $bg = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, ([Drawing.Color]::FromArgb(255, 52, 86, 196)), ([Drawing.Color]::FromArgb(255, 28, 50, 128)), 60
  if ($maskable) { $g.FillRectangle($bg, $rect) }
  else {
    $r = [float]($n * 0.22); $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $path.AddArc($n - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($n - 2 * $r, $n - 2 * $r, 2 * $r, 2 * $r, 0, 90); $path.AddArc(0, $n - 2 * $r, 2 * $r, 2 * $r, 90, 90); $path.CloseFigure()
    $g.FillPath($bg, $path)
  }
  $scale = if ($maskable) { 0.72 } else { 1.0 }
  $font = New-Object Drawing.Font 'Georgia', ([float]($n * 0.62 * $scale)), ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $ink = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 255, 247, 232))
  $g.DrawString('G', $font, $ink, (New-Object Drawing.RectangleF 0, ([float](-$n * 0.05 * $scale)), $n, $n), $fmt)
  if ($n -ge 32) {
    $pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 238, 112, 82)), ([float]([Math]::Max(2, $n * 0.055 * $scale)))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $y = $n / 2 + $n * 0.29 * $scale; $x0 = $n / 2 - $n * 0.24 * $scale; $x1 = $n / 2 + $n * 0.25 * $scale
    $g.DrawBezier($pen, [float]$x0, [float]($y + $n * 0.012), [float]($n / 2 - $n * 0.06), [float]($y - $n * 0.03 * $scale), [float]($n / 2 + $n * 0.08), [float]($y + $n * 0.03 * $scale), [float]$x1, [float]($y - $n * 0.018))
  }
  $g.Dispose()
  return $bmp
}
function Save-Png($bmp, $name) { $p = Join-Path $Out $name; $bmp.Save($p, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $p }

foreach ($s in 512, 192, 180, 32) { Save-Png (Draw-Icon $s $false) "icon-$s.png" | Out-Null }
Save-Png (Draw-Icon 512 $true) 'icon-maskable-512.png' | Out-Null

# .ico with PNG-compressed entries (256, 48, 32, 16)
$sizes = 256, 48, 32, 16
$pngs = foreach ($s in $sizes) { $ms = New-Object IO.MemoryStream; $b = Draw-Icon $s $false; $b.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); , $ms.ToArray() }
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
[IO.File]::WriteAllBytes((Join-Path $Out 'app.ico'), $ico.ToArray())
Write-Host "Icons written to $Out"
