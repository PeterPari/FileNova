$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $projectRoot 'src-tauri'
$cargoTargetDir = $null

try {
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        $metadataJson = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $tauriRoot 'Cargo.toml') 2>$null
        if ($metadataJson) {
            $metadata = $metadataJson | ConvertFrom-Json
            if ($metadata.target_directory) {
                $cargoTargetDir = $metadata.target_directory
            }
        }
    }
} catch {
    # Fallback to known paths below
}

$candidateReleaseDirs = @()

if ($env:CARGO_TARGET_DIR) {
    $candidateReleaseDirs += (Join-Path $env:CARGO_TARGET_DIR 'release')
}

if ($cargoTargetDir) {
    $candidateReleaseDirs += (Join-Path $cargoTargetDir 'release')
}

$candidateReleaseDirs += (Join-Path $projectRoot 'src-tauri\target\release')
$candidateReleaseDirs = $candidateReleaseDirs | Select-Object -Unique

$existingReleaseDirs = $candidateReleaseDirs | Where-Object { Test-Path $_ }

$exe = $null
if ($existingReleaseDirs -and $existingReleaseDirs.Count -gt 0) {
    foreach ($releaseDir in $existingReleaseDirs) {
        $exe = Get-ChildItem -Path $releaseDir -Filter *.exe -File |
            Where-Object {
                $_.Name -notmatch '^uninstall\.exe$' -and
                $_.Name -notmatch '^vc_redist' -and
                $_.Name -notmatch '^setup' -and
                $_.Name -notmatch '^msi' -and
                $_.Name -notmatch '^nsis'
            } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($exe) { break }
    }
}

if (-not $exe) {
    $projectsDir = Join-Path $HOME 'Projects'
    if (Test-Path $projectsDir) {
        $exe = Get-ChildItem -Path $projectsDir -Filter *file*nova*.exe -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\release\\' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }
}

if (-not $exe) {
    Write-Host 'Could not find an app executable in release output directories.' -ForegroundColor Yellow
    Write-Host 'Run this once to create it:' -ForegroundColor Yellow
    Write-Host '  npm run app:package' -ForegroundColor Cyan
    exit 1
}

Write-Host "Launching $($exe.Name)..." -ForegroundColor Green
Start-Process -FilePath $exe.FullName
