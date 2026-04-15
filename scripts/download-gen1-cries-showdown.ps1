<#
.SYNOPSIS
  Downloads national dex #1–151 cries (MP3) from Pokemon Showdown CDN.

.DESCRIPTION
  Files are saved as audio/cries/gen1/NNN-slug.mp3 (e.g. 001-bulbasaur.mp3).
  Slugs match Showdown filenames: nidoranf/nidoranm, farfetchd, mrmime, etc.

  Requires: Windows curl (System32) or curl in PATH with HTTPS.

  Source: https://play.pokemonshowdown.com/audio/cries/
#>
$ErrorActionPreference = 'Stop'
# PSScriptRoot = .../scripts → project root is parent folder
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$curlCandidates = @(
  "$env:SystemRoot\System32\curl.exe",
  "$env:SystemRoot\SysWOW64\curl.exe"
)
$curlExe = $curlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $curlExe) {
  $c = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($c) { $curlExe = $c.Source }
}
if (-not $curlExe) {
  throw 'curl.exe not found. Install Windows curl or use Git bash curl.'
}

$destDir = Join-Path $root 'audio\cries\gen1'
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

# Unicode symbols via [char] so the script parses on any OEM code page
$nidoranF = 'Nidoran' + [char]0x2640
$nidoranM = 'Nidoran' + [char]0x2642
$names = @(
  'Bulbasaur','Ivysaur','Venusaur','Charmander','Charmeleon','Charizard','Squirtle','Wartortle','Blastoise','Caterpie','Metapod','Butterfree','Weedle','Kakuna','Beedrill','Pidgey','Pidgeotto','Pidgeot','Rattata','Raticate','Spearow','Fearow','Ekans','Arbok','Pikachu','Raichu','Sandshrew','Sandslash',$nidoranF,'Nidorina','Nidoqueen',$nidoranM,'Nidorino','Nidoking','Clefairy','Clefable','Vulpix','Ninetales','Jigglypuff','Wigglytuff','Zubat','Golbat','Oddish','Gloom','Vileplume','Paras','Parasect','Venonat','Venomoth','Diglett','Dugtrio','Meowth','Persian','Psyduck','Golduck','Mankey','Primeape','Growlithe','Arcanine','Poliwag','Poliwhirl','Poliwrath','Abra','Kadabra','Alakazam','Machop','Machoke','Machamp','Bellsprout','Weepinbell','Victreebel','Tentacool','Tentacruel','Geodude','Graveler','Golem','Ponyta','Rapidash','Slowpoke','Slowbro','Magnemite','Magneton',"Farfetch'd",'Doduo','Dodrio','Seel','Dewgong','Grimer','Muk','Shellder','Cloyster','Gastly','Haunter','Gengar','Onix','Drowzee','Hypno','Krabby','Kingler','Voltorb','Electrode','Exeggcute','Exeggutor','Cubone','Marowak','Hitmonlee','Hitmonchan','Lickitung','Koffing','Weezing','Rhyhorn','Rhydon','Chansey','Tangela','Kangaskhan','Horsea','Seadra','Goldeen','Seaking','Staryu','Starmie','Mr. Mime','Scyther','Jynx','Electabuzz','Magmar','Pinsir','Tauros','Magikarp','Gyarados','Lapras','Ditto','Eevee','Vaporeon','Jolteon','Flareon','Porygon','Omanyte','Omastar','Kabuto','Kabutops','Aerodactyl','Snorlax','Articuno','Zapdos','Moltres','Dratini','Dragonair','Dragonite','Mewtwo','Mew'
)

function Get-ShowdownCrySlug([int]$dex, [string]$name) {
  switch ($dex) {
    29 { return 'nidoranf' }
    32 { return 'nidoranm' }
    default {
      $s = $name.ToLowerInvariant()
      $s = $s.Replace("'", '')
      $s = $s.Replace('.', '')
      $s = $s.Replace(' ', '')
      return $s
    }
  }
}

$base = 'https://play.pokemonshowdown.com/audio/cries'
$manifest = [System.Collections.ArrayList]@()
$ok = 0
$fail = 0

for ($i = 0; $i -lt $names.Count; $i++) {
  $dex = $i + 1
  $slug = Get-ShowdownCrySlug $dex $names[$i]
  $url = "$base/$slug.mp3"
  $pad = $dex.ToString('000')
  $out = Join-Path $destDir "$pad-$slug.mp3"
  $args = @('-fsSL', '--connect-timeout', '20', '--max-time', '120', '-o', $out, $url)
  $p = Start-Process -FilePath $curlExe -ArgumentList $args -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -eq 0 -and (Test-Path $out) -and ((Get-Item $out).Length -gt 256)) {
    $ok++
    [void]$manifest.Add([ordered]@{
        dex       = $dex
        name      = $names[$i]
        slug      = $slug
        sourceUrl = $url
        file      = "audio/cries/gen1/$pad-$slug.mp3"
      })
    Write-Host "OK $pad $slug"
  } else {
    $fail++
    if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }
    Write-Warning "FAIL $pad $slug (curl exit $($p.ExitCode))"
  }
}

($manifest | ConvertTo-Json -Depth 5) | Set-Content -Path (Join-Path $destDir 'manifest.json') -Encoding UTF8
Write-Host "Done: $ok ok, $fail failed -> $destDir"
