# Snow App 插件打包脚本
# 用法：
#   pwsh -File scripts/pack.ps1 -Plugin snow-novel-reader
#   powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Plugin snow-novel-reader
# 说明：
#   - 打包指定插件目录（plugin.json 必须位于该目录根部），zip 内不套外层文件夹
#   - 产物输出到仓库根目录的 dist/<id>-<version>.zip，并打印 SHA-256（供插件市场索引条目使用）

param(
  [Parameter(Mandatory = $true)]
  [string]$Plugin
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $repoRoot $Plugin
$manifestPath = Join-Path $pluginDir "plugin.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "未找到插件清单：$manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$id = [string]$manifest.id
$version = [string]$manifest.version
if (-not $id) { throw "plugin.json 缺少 id 字段" }
if (-not $version) { $version = "1.0.0" }

$distDir = Join-Path $repoRoot "dist"
if (-not (Test-Path -LiteralPath $distDir)) {
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$zipPath = Join-Path $distDir ("{0}-{1}.zip" -f $id, $version)
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

# 把插件目录内容放入 zip 根目录（plugin.json 在根，符合市场发布要求）
Compress-Archive -Path (Join-Path $pluginDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$zipInfo = Get-Item -LiteralPath $zipPath

Write-Output ""
Write-Output ("插件 ID   : {0}" -f $id)
Write-Output ("版本      : {0}" -f $version)
Write-Output ("压缩包    : {0}" -f $zipInfo.FullName)
Write-Output ("体积      : {0} bytes" -f $zipInfo.Length)
Write-Output ("SHA-256   : {0}" -f $hash)
Write-Output ""
Write-Output "下一步：在 GitHub 仓库创建 Release（tag 建议 <插件目录>/v$version，如 $Plugin/v$version）并上传该 zip，"
Write-Output "然后把 SHA-256 与资产文件名填入 snow-plugin-store 的 app/plugins/$id.json 索引条目并提 PR。"
Write-Output "注意：tag 含 / 时，索引条目需同时提供 downloadUrl（tag 中的 / 编码为 %2F）。"
