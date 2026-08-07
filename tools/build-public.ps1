param(
  [string]$OutputDir = "docs"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$target = Join-Path $root $OutputDir
$targetFull = [System.IO.Path]::GetFullPath($target)
$rootFull = [System.IO.Path]::GetFullPath($root)

if (-not $targetFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Le dossier de sortie doit rester dans le projet."
}

if (Test-Path -LiteralPath $targetFull) {
  Remove-Item -LiteralPath $targetFull -Recurse -Force
}

New-Item -ItemType Directory -Path $targetFull | Out-Null

function Copy-Path {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $sourcePath = Join-Path $root $Source
  $destinationPath = Join-Path $targetFull $Destination
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

Copy-Path "index.html" "index.html"
Copy-Path "404.html" "404.html"
Copy-Path ".nojekyll" ".nojekyll"
Copy-Path "assets/css" "assets/css"
Copy-Path "assets/js" "assets/js"
Copy-Path "assets/icons" "assets/icons"
Copy-Path "assets/images" "assets/images"
Copy-Path "vendor" "vendor"
Copy-Path "data/favicon_bs_32x32.png" "data/favicon_bs_32x32.png"
Copy-Path "data/design_spectre.png" "data/design_spectre.png"

$size = (Get-ChildItem -LiteralPath $targetFull -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Build public genere: {0} ({1:N2} Mo)" -f $targetFull, ($size / 1MB))
