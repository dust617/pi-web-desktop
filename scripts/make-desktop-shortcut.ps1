# 创建/更新桌面 pi-web-desktop 快捷方式（指向当前仓库 D:\PI-web-desktop）
$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path $desktop "pi-web-desktop.lnk"

$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "D:\PI-web-desktop\node_modules\electron\dist\electron.exe"
$sc.Arguments = '"D:\PI-web-desktop" --project "D:\PI-web-desktop"'
$sc.WorkingDirectory = "D:\PI-web-desktop"
$sc.IconLocation = "D:\PI-web-desktop\resources\icon.ico,0"
$sc.Description = "pi-web-desktop (当前仓库 D:\PI-web-desktop)"
$sc.Save()

# 读回验证
$verify = $ws.CreateShortcut($lnk)
Write-Host "OK  $lnk"
Write-Host "Target : $($verify.TargetPath)"
Write-Host "Args   : $($verify.Arguments)"
Write-Host "WorkDir: $($verify.WorkingDirectory)"
Write-Host "Icon   : $($verify.IconLocation)"
