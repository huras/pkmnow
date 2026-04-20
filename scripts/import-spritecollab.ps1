# Imports SpriteCollab sheets for dex 1..MaxDex (default 493; use a lower value for partial imports).
# Ver: docs/NATIONAL-DEX-PIPELINE.md
param(
  [string]$SpriteCollabRoot = "H:\cursor\Youtube\SpriteCollab",
  [string]$OutputDir = "H:\cursor\Youtube\experimento-gerador-regiao-pkmn\tilesets\pokemon",
  [string]$TumbleOutputDir = "H:\cursor\Youtube\experimento-gerador-regiao-pkmn\tilesets\spritecollab-sprite",
  [string]$MetadataOutput = "H:\cursor\Youtube\experimento-gerador-regiao-pkmn\js\pokemon\pmd-anim-metadata.js",
  [int]$MaxDex = 493
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

function Resolve-AnimFileCandidates {
  param(
    [Parameter(Mandatory = $true)][string]$SpeciesRoot,
    [Parameter(Mandatory = $true)][string[]]$Candidates
  )
  foreach ($name in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $f = Resolve-AnimFile -SpeciesRoot $SpeciesRoot -AnimFileName $name
    if ($f) { return $f }
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

  $implementedAnimMeta = @(
    @{ key = "idle"; sourceName = "Idle" },
    @{ key = "walk"; sourceName = "Walk" },
    @{ key = "dig"; sourceName = "Dig" },
    @{ key = "hurt"; sourceName = "Hurt" },
    @{ key = "sleep"; sourceName = "Sleep" },
    @{ key = "faint"; sourceName = "Faint" },
    @{ key = "charge"; sourceName = "Charge" },
    @{ key = "shoot"; sourceName = "Shoot" },
    @{ key = "attack"; sourceName = "Attack" },
    @{ key = "tumble"; sourceName = "Tumble" }
  )

  $out = @{}
  foreach ($entry in $implementedAnimMeta) {
    $srcName = [string]$entry.sourceName
    if (-not $byName.ContainsKey($srcName)) { continue }
    $info = $byName[$srcName]
    if ($null -eq $info) { continue }
    $out[[string]$entry.key] = @{
      frameWidth = $info.frameWidth
      frameHeight = $info.frameHeight
      durations = $info.durations
    }
  }
  if ($out.Keys.Count -eq 0) { return $null }
  return $out
}

if (-not (Test-Path $SpriteCollabRoot -PathType Container)) {
  throw "SpriteCollab root not found: $SpriteCollabRoot"
}

if (-not (Test-Path $OutputDir -PathType Container)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

if (-not (Test-Path $TumbleOutputDir -PathType Container)) {
  New-Item -ItemType Directory -Path $TumbleOutputDir | Out-Null
}

$spriteRoot = Join-Path $SpriteCollabRoot "sprite"
if (-not (Test-Path $spriteRoot -PathType Container)) {
  throw "Expected sprite root not found: $spriteRoot"
}

$ok = 0
$missing = @()
$metaByDex = @{}

if ($MaxDex -lt 1) { throw "MaxDex must be >= 1" }
$maxDex = $MaxDex
for ($dex = 1; $dex -le $maxDex; $dex++) {
  $dex3 = $dex.ToString("000")
  $dex4 = $dex.ToString("0000")
  $speciesRoot = Resolve-SpeciesRoot -SpriteRoot $spriteRoot -Dex4 $dex4

  if (-not $speciesRoot -or -not (Test-Path $speciesRoot -PathType Container)) {
    $missing += "${dex3} (missing species folder)"
    continue
  }

  $implementedAnimFiles = [ordered]@{
    walk   = @("Walk-Anim.png", "Walk.png")
    idle   = @("Idle-Anim.png", "Idle.png")
    dig    = @("Dig-Anim.png", "Dig.png")
    hurt   = @("Hurt-Anim.png", "Hurt.png")
    sleep  = @("Sleep-Anim.png", "Sleep.png")
    faint  = @("Faint-Anim.png", "Faint.png")
    charge = @("Charge-Anim.png", "Charge.png")
    shoot  = @("Shoot-Anim.png", "Shoot.png")
    attack = @("Attack-Anim.png", "Attack.png")
    tumble = @("Tumble-Anim.png", "Tumble.png")
  }
  $animSourceByKey = @{}
  foreach ($entry in $implementedAnimFiles.GetEnumerator()) {
    $animSourceByKey[$entry.Key] = Resolve-AnimFileCandidates -SpeciesRoot $speciesRoot -Candidates $entry.Value
  }
  $walkSource = $animSourceByKey["walk"]
  $idleSource = $animSourceByKey["idle"]
  # Muitas espécies só têm Walk-Anim.png; no AnimData o Idle é <CopyOf>Walk</CopyOf> — usa a mesma folha.
  if ($walkSource -and -not $idleSource) {
    $idleSource = $walkSource
    $animSourceByKey["idle"] = $walkSource
  }
  elseif ($idleSource -and -not $walkSource) {
    $walkSource = $idleSource
    $animSourceByKey["walk"] = $idleSource
  }
  $animDataPath = Join-Path $speciesRoot "AnimData.xml"
  $animMeta = Read-AnimMetadata -AnimDataPath $animDataPath

  if (-not $walkSource -and -not $idleSource) {
    $missing += "${dex3} (missing walk+idle png)"
    continue
  }

  foreach ($entry in $implementedAnimFiles.GetEnumerator()) {
    $k = [string]$entry.Key
    $source = $animSourceByKey[$k]
    if (-not $source) { continue }
    $dest = Join-Path $OutputDir "${dex3}_${k}.png"
    Copy-Item -Path $source -Destination $dest -Force
  }
  $tumbleSource = $animSourceByKey["tumble"]
  if ($tumbleSource) {
    $tumbleSpeciesDir = Join-Path $TumbleOutputDir $dex4
    if (-not (Test-Path $tumbleSpeciesDir -PathType Container)) {
      New-Item -ItemType Directory -Path $tumbleSpeciesDir | Out-Null
    }
    Copy-Item -Path $tumbleSource -Destination (Join-Path $tumbleSpeciesDir "Tumble-Anim.png") -Force
  }
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
 * Source: SpriteCollab AnimData.xml (entries exist for species imported by this run).
 */
import { NATIONAL_DEX_MAX } from './national-dex-registry.js';

export const PMD_ANIM_METADATA = $json;

export function getDexAnimMeta(dexId) {
  const key = String(Math.max(1, Math.min(NATIONAL_DEX_MAX, Number(dexId) || 1))).padStart(3, '0');
  return PMD_ANIM_METADATA[key] || null;
}

/** @param {'idle'|'walk'|'dig'|'hurt'|'sleep'|'faint'|'charge'|'shoot'|'attack'|'tumble'} kind */
export function getDexAnimSlice(dexId, kind) {
  const m = getDexAnimMeta(dexId);
  if (!m) return null;
  if (kind === 'dig') return m.dig ?? m.walk ?? null;
  if (kind === 'hurt') return m.hurt ?? m.idle ?? null;
  if (kind === 'sleep') return m.sleep ?? m.idle ?? null;
  if (kind === 'faint') return m.faint ?? m.idle ?? null;
  if (kind === 'charge') return m.charge ?? null;
  if (kind === 'shoot') return m.shoot ?? null;
  if (kind === 'attack') return m.attack ?? m.shoot ?? m.charge ?? m.walk ?? m.idle ?? null;
  if (kind === 'tumble') return m.tumble ?? m.walk ?? m.idle ?? null;
  return m[kind] ?? null;
}
"@

Set-Content -Path $MetadataOutput -Value $metaJs -Encoding UTF8

Write-Host ""
Write-Host "Imported species: $ok / $maxDex"
Write-Host "Anim metadata entries: $($metaByDex.Keys.Count)"
if ($missing.Count -gt 0) {
  Write-Host "Missing entries: $($missing.Count)"
  $missing | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host "All entries up to dex $maxDex imported."
}
