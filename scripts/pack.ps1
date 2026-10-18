# Snow App 插件打包脚本
# 用法：
#   pwsh -File scripts/pack.ps1 -Plugin snow-novel-reader
#   powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Plugin snow-novel-reader
# 说明：
#   - 仅适用于带 plugin.json 的面板插件；客户端脚本插件（如 snow-fix-bench 的 .user.js）不经过本脚本
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

# tag 短名前缀：插件 id 的末段（com.snow.novel-reader 对应 novel-reader），与市场索引条目保持一致
# 先过滤空段再取末段，避免 id 以点号结尾（如 a.）时得到空串
$tagPrefix = $id.Split('.') | Where-Object { $_ -ne "" } | Select-Object -Last 1
if (-not $tagPrefix) { throw "无法从插件 id 推导 tag 前缀：$id（id 末段为空）" }

$distDir = Join-Path $repoRoot "dist"
if (-not (Test-Path -LiteralPath $distDir)) {
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$zipPath = Join-Path $distDir ("{0}-{1}.zip" -f $id, $version)
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

# 把插件目录内容放入 zip 根目录（plugin.json 在根，符合市场发布要求）。
# 工程化插件的开发文件不进发布包；发布产物以 plugin.json 的 entry 为准，缺产物时直接失败。
# 排除规则按相对路径逐段判断：node_modules/test 等目录可能出现在任意层级，
# 不能只过滤插件根的直接子项（Compress-Archive 会递归展开传入的目录）。
$excludeDirNames = @("node_modules", "test", "tests", "__tests__")
$excludeRootNames = @("src")
$excludeRootFileNames = @("build.mjs", "package.json", "package-lock.json")

# 递归收集待打包文件，并在进入排除目录前剪枝；隐藏/系统项与点文件一律跳过。
function Get-PackFiles {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$ExcludeDirs,
    [Parameter(Mandatory = $true)][string[]]$ExcludeRootDirs,
    [Parameter(Mandatory = $true)][string[]]$ExcludeRootFiles
  )
  $stack = New-Object System.Collections.Stack
  $stack.Push($Root)
  while ($stack.Count -gt 0) {
    $currentDir = [string]$stack.Pop()
    foreach ($child in @(Get-ChildItem -LiteralPath $currentDir -Force -ErrorAction Stop)) {
      if ($child.Name -like ".*") { continue }
      $attributes = $child.Attributes
      if (($attributes -band [System.IO.FileAttributes]::Hidden) -ne 0) { continue }
      if (($attributes -band [System.IO.FileAttributes]::System) -ne 0) { continue }
      if ($child.PSIsContainer) {
        if ($currentDir -eq $Root -and $ExcludeRootDirs -contains $child.Name) { continue }
        if ($ExcludeDirs -contains $child.Name) { continue }
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $stack.Push($child.FullName)
        continue
      }
      if ($currentDir -eq $Root -and $ExcludeRootFiles -contains $child.Name) { continue }
      $child
    }
  }
}

$entryRelative = [string]$manifest.entry
if (-not $entryRelative) { $entryRelative = "index.js" }
$entryPath = Join-Path $pluginDir $entryRelative
if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "入口文件缺失（工程化插件请先运行构建，如 npm run build）：$entryPath"
}

$pluginRoot = [System.IO.Path]::GetFullPath($pluginDir).TrimEnd([char[]]@('\', '/'))
$packFiles = @(Get-PackFiles -Root $pluginRoot -ExcludeDirs $excludeDirNames -ExcludeRootDirs $excludeRootNames -ExcludeRootFiles $excludeRootFileNames)
if ($packFiles.Count -eq 0) {
  throw "插件目录没有可打包的内容：$pluginDir"
}

# Compress-Archive 对零散文件会丢失相对路径，因此先复制到临时 staging 目录，
# 再按 staging 根目录压缩，确保 locales/ 等子目录结构原样进入 zip。
$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("snow-pack-" + [guid]::NewGuid().ToString("N"))
try {
  foreach ($file in $packFiles) {
    $relative = $file.FullName.Substring($pluginRoot.Length) -replace '^[\\/]+', ''
    $destination = Join-Path $stagingDir $relative
    $destinationParent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $destinationParent)) {
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  }
  $items = @(Get-ChildItem -LiteralPath $stagingDir -Force)
  Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath $zipPath -CompressionLevel Optimal
} catch {
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  throw
} finally {
  if (Test-Path -LiteralPath $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 压缩后按 zip 实际条目校验：入口可能位于被排除的目录，只有源码存在不能证明发布包可用。
$expectedEntry = ($entryRelative -replace "\\", "/") -replace "^\./", ""
try {
  if ($PSVersionTable.PSEdition -eq "Core") {
    Add-Type -AssemblyName System.IO.Compression.ZipFile
  } else {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
  }
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $zipEntries = @($zip.Entries | ForEach-Object { ($_.FullName -replace "\\", "/") })
  } finally {
    $zip.Dispose()
  }
} catch {
  Remove-Item -LiteralPath $zipPath -Force
  throw "无法读取生成的压缩包：$zipPath（$($_.Exception.Message)）"
}

$entryInZip = $zipEntries | Where-Object { $_ -eq $expectedEntry }
if (-not $entryInZip) {
  Remove-Item -LiteralPath $zipPath -Force
  throw "入口文件未进入压缩包：$expectedEntry（请检查 plugin.json 的 entry 与 pack.ps1 的排除规则）"
}

$hiddenEntries = @($zipEntries | Where-Object {
    ($_ -split "/") | Where-Object { $_.StartsWith(".") }
  })
if ($hiddenEntries.Count -gt 0) {
  Remove-Item -LiteralPath $zipPath -Force
  throw "压缩包包含点文件或隐藏项：$($hiddenEntries -join ', ')"
}

# 兜底校验：即使收集逻辑被改坏，也不允许依赖/测试目录进入发布包。
$forbiddenEntries = @($zipEntries | Where-Object {
    $segments = @($_ -split "/")
    $leaf = $segments[$segments.Count - 1]
    (@($segments | Where-Object { $excludeDirNames -contains $_ }).Count -gt 0) -or
    ($segments.Count -gt 1 -and $excludeRootNames -contains $segments[0]) -or
    ($segments.Count -eq 1 -and $excludeRootFileNames -contains $leaf)
  })
if ($forbiddenEntries.Count -gt 0) {
  Remove-Item -LiteralPath $zipPath -Force
  throw "压缩包包含依赖或开发文件：$($forbiddenEntries -join ', ')"
}

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$zipInfo = Get-Item -LiteralPath $zipPath

Write-Output ""
Write-Output ("插件 ID   : {0}" -f $id)
Write-Output ("版本      : {0}" -f $version)
Write-Output ("压缩包    : {0}" -f $zipInfo.FullName)
Write-Output ("体积      : {0} bytes" -f $zipInfo.Length)
Write-Output ("SHA-256   : {0}" -f $hash)
Write-Output ""
Write-Output "下一步：在 GitHub 仓库创建 Release（tag 建议 <插件 id 末段>/v$version，如 $tagPrefix/v$version）并上传该 zip，"
Write-Output "然后把 SHA-256 与资产文件名填入 snow-plugin-store 的 app/plugins/$id.json 索引条目并提 PR。"
Write-Output "注意：tag 含 / 时，索引条目需同时提供 downloadUrl（tag 中的 / 编码为 %2F）。"
