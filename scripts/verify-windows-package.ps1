param([string]$Installer)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $Installer) {
  $latest = Get-ChildItem -LiteralPath (Join-Path $workspace "release") -Filter "CartPilot-*-Setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "请先执行 npm run desktop:package 生成安装包。" }
  $Installer = $latest.FullName
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path

$registryRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)
foreach ($registryRoot in $registryRoots) {
  if (Test-Path -LiteralPath $registryRoot) {
    $existing = Get-ChildItem -LiteralPath $registryRoot | Get-ItemProperty |
      Where-Object { $_.DisplayName -eq "CartPilot" }
    if ($existing) { throw "已存在 CartPilot 安装，隔离验证不会覆盖已有安装。" }
  }
}

$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace "output\packaging"))
$testId = [guid]::NewGuid().ToString()
$testRoot = Join-Path $outputRoot $testId
$installBase = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) "cartpilot-package-verification"))
$installRoot = [System.IO.Path]::GetFullPath((Join-Path $installBase "$testId\app"))
function Assert-IsolatedInstall {
  if (-not $installRoot.StartsWith($installBase + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "安装或卸载目标超出隔离验证目录。"
  }
}
Assert-IsolatedInstall
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$previousExecutable = $env:CARTPILOT_EXECUTABLE
$testExitCode = 1

try {
  $setup = Start-Process -FilePath $Installer -ArgumentList @("/S", "/currentuser", "/D=$installRoot") -WindowStyle Hidden -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "安装包执行失败，退出码 $($setup.ExitCode)。" }
  $env:CARTPILOT_EXECUTABLE = Join-Path $installRoot "CartPilot.exe"
  if (-not (Test-Path -LiteralPath $env:CARTPILOT_EXECUTABLE)) { throw "安装包未生成桌面可执行文件。" }
  Push-Location $workspace
  try {
    & (Join-Path $workspace "node_modules\.bin\tsx.cmd") --test --test-concurrency=1 "tests/packaging/*.test.ts"
    $testExitCode = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $env:CARTPILOT_EXECUTABLE = $previousExecutable
  Assert-IsolatedInstall
  $uninstaller = Join-Path $installRoot "Uninstall CartPilot.exe"
  if (Test-Path -LiteralPath $uninstaller) {
    $removed = Start-Process -FilePath $uninstaller -ArgumentList @("/S", "_?=$installRoot") -WindowStyle Hidden -Wait -PassThru
    if ($removed.ExitCode -ne 0) { throw "隔离安装卸载失败，退出码 $($removed.ExitCode)。" }
  }
}

$report = [ordered]@{
  installer = $Installer
  sha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
  testRoot = $testRoot
  testExitCode = $testExitCode
  executableRemoved = -not (Test-Path -LiteralPath (Join-Path $installRoot "CartPilot.exe"))
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$reportPath = Join-Path $testRoot "verification.json"
$report | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Output "安装包验证记录：$reportPath"
if ($testExitCode -ne 0 -or -not $report.executableRemoved) { throw "安装包验证未通过，请检查测试输出与记录。" }
