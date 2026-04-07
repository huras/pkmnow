param(
  [string]$SpriteCollabRoot = "H:\cursor\Youtube\SpriteCollab",
  [string]$OutputDir = "H:\cursor\Youtube\experimento-gerador-regiao-pkmn\tilesets\pokemon",
  [string]$MetadataOutput = "H:\cursor\Youtube\experimento-gerador-regiao-pkmn\js\pokemon\pmd-anim-metadata.js"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AnimFile {
  param(
    [Parameter(Mandatory = $true)][string]$SpeciesRoot,
    [Parameter(Mandatory = $true)][string]$AnimFileName
  )

  $direct = Join-Path $SpeciesRoot $AnimFileName
  if (Test-Path $direct -PathType Leaf) {
    return $direct
  }

  # Some species/forms can be nested; pick first available animation file.
  $nested = Get-ChildItem -Path $SpeciesRoot -Recurse -File -Filter $AnimFileName |
    Select-Object -First 1
  if ($null -ne $nested) {
    return $nested.FullName
  }

  return $null
}

function Resolve-SpeciesRoot {
  param(
    [Parameter(Mandatory = $true)][string]$SpriteRoot,
    [Parameter(Mandatory = $true)][string]$Dex4
  )

  $direct = Join-Path $SpriteRoot $Dex4
  if (Test-Path $direct -PathType Container) {
    return $direct
  }

  $match = Get-ChildItem -Path $SpriteRoot -Directory |
    Where-Object { $_.Name -eq $Dex4 } |
    Select-Object -First 1
  if ($null -ne $match) {
    return $match.FullName
  }

  return $null
}

function Get-AnimInfo {
  param(
    [Parameter(Mandatory = $true)]$AnimNode
  )
  $nameNode = $AnimNode.SelectSingleNode("Name")
  $name = if ($null -ne $nameNode) { [string]$nameNode.InnerText } else { "" }
  if ([string]::IsNullOrWhiteSpace($name)) { return $null }

  $fwNode = $AnimNode.SelectSingleNode("FrameWidth")
  $fhNode = $AnimNode.SelectSingleNode("FrameHeight")
  $fw = if ($null -ne $fwNode) { [int]$fwNode.InnerText } else { 0 }
  $fh = if ($null -ne $fhNode) { [int]$fhNode.InnerText } else { 0 }

  $durNodes = @($AnimNode.SelectNodes("Durations/Duration"))
  $dur = @()
  foreach ($d in $durNodes) {
    if ($null -eq $d) { continue }
    $dur += [int]$d.InnerText
  }
  if ($dur.Count -eq 0) { return $null }

  return @{
    name = $name
    frameWidth = $fw
    frameHeight = $fh
    durations = $dur
  }
}

function Read-AnimMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$AnimDataPath
  )
  if (-not (Test-Path $AnimDataPath -PathType Leaf)) {
    return $null
  }
  try {
    [xml]$xml = Get-Content -Path $AnimDataPath -Raw
  } catch {
    return $null
  }

  $animNodes = @($xml.SelectNodes("//Anim"))
  if ($animNodes.Count -eq 0) { return $null }

  # Anim nodes with explicit FrameWidth / Durations
  $byName = @{}
  foreach ($node in $animNodes) {
    $info = Get-AnimInfo -AnimNode $node
    if ($null -ne $info) {
      $byName[$info.name] = $info
    }
  }

  # Idle (and others) often use <CopyOf>Walk</CopyOf> with no inline frames — resolve from source anim.
  foreach ($node in $animNodes) {
    $nameNode = $node.SelectSingleNode("Name")
    $copyNode = $node.SelectSingleNode("CopyOf")
    if ($null -eq $nameNode -or $null -eq $copyNode) { continue }
    $animName = [string]$nameNode.InnerText
    $refName = [string]$copyNode.InnerText
    if ([string]::IsNullOrWhiteSpace($animName) -or [string]::IsNullOrWhiteSpace($refName)) { continue }
    if ($byName.ContainsKey($animName)) { continue }
    $src = $null
    if ($byName.ContainsKey($refName)) {
      $src = $byName[$refName]
    }
    if ($null -eq $src) { continue }
    $byName[$animName] = @{
      name       = $animName
      frameWidth = $src.frameWidth
      frameHeight = $src.frameHeight
      durations  = @($src.durations)
    }
  }

  $idleInfo = $null
  $walkInfo = $null
  if ($byName.ContainsKey("Idle")) { $idleInfo = $byName["Idle"] }
  if ($byName.ContainsKey("Walk")) { $walkInfo = $byName["Walk"] }
  if ($null -eq $idleInfo -and $null -eq $walkInfo) {
    return $null
  }

  $out = @{}
  if ($null -ne $idleInfo) {
    $out.idle = @{
      frameWidth = $idleInfo.frameWidth
      frameHeight = $idleInfo.frameHeight
      durations = $idleInfo.durations
    }
  }
  if ($null -ne $walkInfo) {
    $out.walk = @{
      frameWidth = $walkInfo.frameWidth
      frameHeight = $walkInfo.frameHeight
      durations = $walkInfo.durations
    }
  }
  return $out
}

if (-not (Test-Path $SpriteCollabRoot -PathType Container)) {
  throw "SpriteCollab root not found: $SpriteCollabRoot"
}

if (-not (Test-Path $OutputDir -PathType Container)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$spriteRoot = Join-Path $SpriteCollabRoot "sprite"
if (-not (Test-Path $spriteRoot -PathType Container)) {
  throw "Expected sprite root not found: $spriteRoot"
}

$ok = 0
$missing = @()
$metaByDex = @{}

for ($dex = 1; $dex -le 151; $dex++) {
  $dex3 = $dex.ToString("000")
  $dex4 = $dex.ToString("0000")
  $speciesRoot = Resolve-SpeciesRoot -SpriteRoot $spriteRoot -Dex4 $dex4

  if (-not $speciesRoot -or -not (Test-Path $speciesRoot -PathType Container)) {
    $missing += "${dex3} (missing species folder)"
    continue
  }

  $walkSource = Resolve-AnimFile -SpeciesRoot $speciesRoot -AnimFileName "Walk-Anim.png"
  $idleSource = Resolve-AnimFile -SpeciesRoot $speciesRoot -AnimFileName "Idle-Anim.png"
  # Muitas espécies só têm Walk-Anim.png; no AnimData o Idle é <CopyOf>Walk</CopyOf> — usa a mesma folha.
  if ($walkSource -and -not $idleSource) {
    $idleSource = $walkSource
  }
  elseif ($idleSource -and -not $walkSource) {
    $walkSource = $idleSource
  }
  $animDataPath = Join-Path $speciesRoot "AnimData.xml"
  $animMeta = Read-AnimMetadata -AnimDataPath $animDataPath

  if (-not $walkSource -and -not $idleSource) {
    $missing += "${dex3} (missing walk+idle png)"
    continue
  }

  $walkDest = Join-Path $OutputDir "${dex3}_walk.png"
  $idleDest = Join-Path $OutputDir "${dex3}_idle.png"

  Copy-Item -Path $walkSource -Destination $walkDest -Force
  Copy-Item -Path $idleSource -Destination $idleDest -Force
  if ($null -ne $animMeta) {
    $metaByDex[$dex3] = $animMeta
  }
  $ok++
}

if (-not (Test-Path (Split-Path -Parent $MetadataOutput) -PathType Container)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $MetadataOutput) | Out-Null
}

$json = $metaByDex | ConvertTo-Json -Depth 10
$metaJs = @"
/**
 * Auto-generated by scripts/import-spritecollab.ps1
 * Source: SpriteCollab AnimData.xml (Gen1 only).
 */
export const PMD_ANIM_METADATA = $json;

export function getDexAnimMeta(dexId) {
  const key = String(Math.max(1, Math.min(151, Number(dexId) || 1))).padStart(3, '0');
  return PMD_ANIM_METADATA[key] || null;
}
"@

Set-Content -Path $MetadataOutput -Value $metaJs -Encoding UTF8

Write-Host ""
Write-Host "Imported species: $ok / 151"
Write-Host "Anim metadata entries: $($metaByDex.Keys.Count)"
if ($missing.Count -gt 0) {
  Write-Host "Missing entries: $($missing.Count)"
  $missing | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host "All Gen1 entries imported."
}
