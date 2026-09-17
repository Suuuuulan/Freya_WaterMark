# init-ref.ps1 — 把参考图导出成 raw RGB24，供 tools/analyze-ref.js 量取几何与配色
#
# 用法（在项目根目录执行）：
#   powershell -ExecutionPolicy Bypass -File tools/init-ref.ps1
#
# 默认读取项目根目录的 _ref_black.jpg，也可传入别的图片路径：
#   powershell -File tools/init-ref.ps1 "C:\path\to\ref.jpg"

param(
  [string]$Source = ""
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Join-Path $root "_ref_black.jpg"
}

if (-not (Test-Path $Source)) {
  Write-Error "找不到参考图：$Source"
  exit 1
}

$dataDir = Join-Path $root "tools\_data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$img = [System.Drawing.Image]::FromFile($Source)
$bmp = New-Object System.Drawing.Bitmap $img
$rect = New-Object System.Drawing.Rectangle 0, 0, $img.Width, $img.Height
$locked = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $locked.Stride
$total = $stride * $img.Height
$bytes = New-Object byte[] $total
[System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $bytes, 0, $total)
$bmp.UnlockBits($locked)

# BGR -> RGB，去掉行填充
$rgb = New-Object byte[] ($img.Width * $img.Height * 3)
for ($y = 0; $y -lt $img.Height; $y++) {
  for ($x = 0; $x -lt $img.Width; $x++) {
    $s = $y * $stride + $x * 3
    $d = ($y * $img.Width + $x) * 3
    $rgb[$d] = $bytes[$s + 2]
    $rgb[$d + 1] = $bytes[$s + 1]
    $rgb[$d + 2] = $bytes[$s]
  }
}

$header = New-Object byte[] 8
[BitConverter]::GetBytes([int]$img.Width).CopyTo($header, 0)
[BitConverter]::GetBytes([int]$img.Height).CopyTo($header, 4)

$out = Join-Path $dataDir "ref_rgb24.raw"
[System.IO.File]::WriteAllBytes($out, ($header + $rgb))
Write-Host "已写出 $out  ($($img.Width)x$($img.Height) RGB24, $($rgb.Length) 字节)"
Write-Host "接下来运行: node tools/analyze-ref.js"

$img.Dispose()
$bmp.Dispose()
