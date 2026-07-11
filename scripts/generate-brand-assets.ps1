param(
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\src-tauri\icons")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$output = [System.IO.Path]::GetFullPath($OutputDir)
$installer = Join-Path $output "installer"
[System.IO.Directory]::CreateDirectory($output) | Out-Null
[System.IO.Directory]::CreateDirectory($installer) | Out-Null

function New-RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $arc = [System.Drawing.RectangleF]::new($rect.X, $rect.Y, $diameter, $diameter)
  $path.AddArc($arc, 180, 90)
  $arc.X = $rect.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $rect.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $rect.X
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Mark([System.Drawing.Graphics]$graphics, [float]$x, [float]$y, [float]$size) {
  $scale = $size / 40.0
  $left = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $left.AddBezier(
    [System.Drawing.PointF]::new($x + 7*$scale, $y + 12.5*$scale),
    [System.Drawing.PointF]::new($x + 7*$scale, $y + 8.9*$scale),
    [System.Drawing.PointF]::new($x + 9.9*$scale, $y + 6*$scale),
    [System.Drawing.PointF]::new($x + 13.5*$scale, $y + 6*$scale)
  )
  $left.AddLine([System.Drawing.PointF]::new($x + 13.5*$scale, $y + 6*$scale), [System.Drawing.PointF]::new($x + 23*$scale, $y + 6*$scale))
  $left.AddBezier(
    [System.Drawing.PointF]::new($x + 23*$scale, $y + 6*$scale),
    [System.Drawing.PointF]::new($x + 27.4*$scale, $y + 6*$scale),
    [System.Drawing.PointF]::new($x + 31*$scale, $y + 9.6*$scale),
    [System.Drawing.PointF]::new($x + 31*$scale, $y + 14*$scale)
  )
  $left.AddLine([System.Drawing.PointF]::new($x + 31*$scale, $y + 14*$scale), [System.Drawing.PointF]::new($x + 31*$scale, $y + 16*$scale))
  $left.AddLine([System.Drawing.PointF]::new($x + 31*$scale, $y + 16*$scale), [System.Drawing.PointF]::new($x + 20.5*$scale, $y + 16*$scale))
  $left.AddBezier(
    [System.Drawing.PointF]::new($x + 20.5*$scale, $y + 16*$scale),
    [System.Drawing.PointF]::new($x + 18*$scale, $y + 16*$scale),
    [System.Drawing.PointF]::new($x + 16*$scale, $y + 18*$scale),
    [System.Drawing.PointF]::new($x + 16*$scale, $y + 20.5*$scale)
  )
  $left.AddLine([System.Drawing.PointF]::new($x + 16*$scale, $y + 20.5*$scale), [System.Drawing.PointF]::new($x + 16*$scale, $y + 34*$scale))
  $left.AddLine([System.Drawing.PointF]::new($x + 16*$scale, $y + 34*$scale), [System.Drawing.PointF]::new($x + 10.9*$scale, $y + 29.9*$scale))
  $left.AddBezier(
    [System.Drawing.PointF]::new($x + 10.9*$scale, $y + 29.9*$scale),
    [System.Drawing.PointF]::new($x + 8.4*$scale, $y + 27.9*$scale),
    [System.Drawing.PointF]::new($x + 7*$scale, $y + 24.8*$scale),
    [System.Drawing.PointF]::new($x + 7*$scale, $y + 21.9*$scale)
  )
  $left.CloseFigure()

  $right = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $right.AddLine([System.Drawing.PointF]::new($x + 20.5*$scale, $y + 16*$scale), [System.Drawing.PointF]::new($x + 33*$scale, $y + 16*$scale))
  $right.AddLine([System.Drawing.PointF]::new($x + 33*$scale, $y + 16*$scale), [System.Drawing.PointF]::new($x + 33*$scale, $y + 23.5*$scale))
  $right.AddBezier(
    [System.Drawing.PointF]::new($x + 33*$scale, $y + 23.5*$scale),
    [System.Drawing.PointF]::new($x + 33*$scale, $y + 29.3*$scale),
    [System.Drawing.PointF]::new($x + 28.3*$scale, $y + 34*$scale),
    [System.Drawing.PointF]::new($x + 22.5*$scale, $y + 34*$scale)
  )
  $right.AddLine([System.Drawing.PointF]::new($x + 22.5*$scale, $y + 34*$scale), [System.Drawing.PointF]::new($x + 16*$scale, $y + 34*$scale))
  $right.AddLine([System.Drawing.PointF]::new($x + 16*$scale, $y + 34*$scale), [System.Drawing.PointF]::new($x + 16*$scale, $y + 20.5*$scale))
  $right.AddBezier(
    [System.Drawing.PointF]::new($x + 16*$scale, $y + 20.5*$scale),
    [System.Drawing.PointF]::new($x + 16*$scale, $y + 18*$scale),
    [System.Drawing.PointF]::new($x + 18*$scale, $y + 16*$scale),
    [System.Drawing.PointF]::new($x + 20.5*$scale, $y + 16*$scale)
  )
  $right.CloseFigure()

  $brushA = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new($x + 5*$scale, $y + 4*$scale),
    [System.Drawing.PointF]::new($x + 33*$scale, $y + 34*$scale),
    [System.Drawing.Color]::FromArgb(255, 77, 211, 255),
    [System.Drawing.Color]::FromArgb(255, 255, 207, 91)
  )
  $blendA = [System.Drawing.Drawing2D.ColorBlend]::new(3)
  $blendA.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 77, 211, 255),
    [System.Drawing.Color]::FromArgb(255, 92, 216, 170),
    [System.Drawing.Color]::FromArgb(255, 255, 207, 91)
  )
  $blendA.Positions = @(0.0, 0.52, 1.0)
  $brushA.InterpolationColors = $blendA

  $brushB = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new($x + 34*$scale, $y + 8*$scale),
    [System.Drawing.PointF]::new($x + 11*$scale, $y + 35*$scale),
    [System.Drawing.Color]::FromArgb(255, 122, 151, 255),
    [System.Drawing.Color]::FromArgb(255, 255, 111, 132)
  )
  $blendB = [System.Drawing.Drawing2D.ColorBlend]::new(3)
  $blendB.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 122, 151, 255),
    [System.Drawing.Color]::FromArgb(255, 211, 113, 226),
    [System.Drawing.Color]::FromArgb(255, 255, 111, 132)
  )
  $blendB.Positions = @(0.0, 0.52, 1.0)
  $brushB.InterpolationColors = $blendB

  $graphics.FillPath($brushA, $left)
  $graphics.FillPath($brushB, $right)
  $dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
  $graphics.FillEllipse($dot, $x + 21.6*$scale, $y + 22.4*$scale, 4.4*$scale, 4.4*$scale)

  $dot.Dispose()
  $brushA.Dispose()
  $brushB.Dispose()
  $left.Dispose()
  $right.Dispose()
}

function New-AppIcon([string]$path, [int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $margin = $size * 0.08
  $backgroundPath = New-RoundedPath ([System.Drawing.RectangleF]::new($margin, $margin, $size - 2*$margin, $size - 2*$margin)) ($size * 0.22)
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($size, $size),
    [System.Drawing.Color]::FromArgb(255, 28, 32, 43),
    [System.Drawing.Color]::FromArgb(255, 12, 15, 22)
  )
  $graphics.FillPath($background, $backgroundPath)
  Draw-Mark $graphics ($size * 0.17) ($size * 0.17) ($size * 0.66)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $background.Dispose()
  $backgroundPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-InstallerBitmap([string]$path, [int]$width, [int]$height, [bool]$sidebar) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($width, $height),
    [System.Drawing.Color]::FromArgb(255, 26, 31, 43),
    [System.Drawing.Color]::FromArgb(255, 9, 12, 18)
  )
  $graphics.FillRectangle($background, 0, 0, $width, $height)
  if ($sidebar) {
    Draw-Mark $graphics ($width * 0.17) ($height * 0.18) ($width * 0.66)
    $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(35, 111, 167, 255))
    $graphics.FillEllipse($glow, -$width * 0.45, $height * 0.58, $width * 1.25, $width * 1.25)
    $glow.Dispose()
  } else {
    Draw-Mark $graphics 9 7 43
  }
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-AppIcon (Join-Path $output "app-icon.png") 1024
New-InstallerBitmap (Join-Path $installer "nsis-header.bmp") 150 57 $false
New-InstallerBitmap (Join-Path $installer "nsis-sidebar.bmp") 164 314 $true

Write-Host "Brand assets generated in $output"
