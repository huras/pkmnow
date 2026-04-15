# Copies SpriteCollab head portraits into tilesets/spritecollab-portraits (re-run after updating SpriteCollab).
# From repo root: powershell -File scripts/copy-spritecollab-portraits.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$youtube = Split-Path $repo -Parent
$src = Join-Path $youtube 'SpriteCollab\portrait'
if ($env:SPRITECOLLAB_PORTRAIT_SRC) {
  $src = $env:SPRITECOLLAB_PORTRAIT_SRC
}
$dst = Join-Path $repo 'tilesets\spritecollab-portraits'
if (-not (Test-Path $src)) {
  Write-Error "Source not found: $src`nSet env SPRITECOLLAB_PORTRAIT_SRC to your SpriteCollab portrait folder."
}
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /E /XO /R:2 /W:2 /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }
Write-Host "Done -> $dst"
