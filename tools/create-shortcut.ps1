# Creates "GATE Prep Desk" shortcuts (Desktop + Start menu) that start everything with one click.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sh = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'GATE Prep Desk.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'GATE Prep Desk.lnk')
)
foreach ($t in $targets) {
  $lnk = $sh.CreateShortcut($t)
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = "`"$Root\GATE Prep Desk.vbs`""
  $lnk.WorkingDirectory = $Root
  $lnk.IconLocation = "$Root\app\icons\app.ico,0"
  $lnk.Description = 'GATE Prep Desk - your GATE CS tutor'
  $lnk.Save()
  Write-Host "Created $t"
}
