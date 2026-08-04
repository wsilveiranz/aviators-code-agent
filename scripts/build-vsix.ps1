<#
.SYNOPSIS
    Build an Aviators Newsletter VSIX with an optional temporary version.

.EXAMPLE
    .\scripts\build-vsix.ps1
    .\scripts\build-vsix.ps1 -Version 0.1.1
    .\scripts\build-vsix.ps1 -Version 0.2.0 -SkipValidation
#>

param(
    [string]$Version,
    [switch]$SkipValidation
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot 'package.json'
$packageLockPath = Join-Path $repoRoot 'package-lock.json'
$releaseDir = Join-Path $repoRoot 'release'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm is required but was not found on PATH.'
}

$originalPackageJson = Get-Content -LiteralPath $packageJsonPath -Raw
$originalPackageLock = Get-Content -LiteralPath $packageLockPath -Raw
$package = $originalPackageJson | ConvertFrom-Json
$buildVersion = if ($Version) { $Version } else { [string]$package.version }

if ($buildVersion -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "Invalid version '$buildVersion'. Expected semantic version format such as 0.1.1 or 0.2.0-beta.1."
}

$outputPath = Join-Path $releaseDir "aviators-newsletter-$buildVersion.vsix"

Write-Host '=== Aviators Newsletter VSIX Builder ===' -ForegroundColor Cyan
Write-Host "Version: $buildVersion" -ForegroundColor Gray

try {
    if ($Version -and $Version -ne $package.version) {
        Write-Host "Temporarily overriding package version: $($package.version) -> $Version" -ForegroundColor Yellow
        Push-Location $repoRoot
        try {
            npm pkg set "version=$Version"
            if ($LASTEXITCODE -ne 0) {
                throw 'Failed to override the package version.'
            }
        } finally {
            Pop-Location
        }
    }

    if (-not $SkipValidation) {
        Push-Location $repoRoot
        try {
            npm run lint
            if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }

            npm test
            if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
        } finally {
            Pop-Location
        }
    }

    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

    Push-Location $repoRoot
    try {
        npm run package -- --out $outputPath
        if ($LASTEXITCODE -ne 0) {
            throw 'VSIX packaging failed.'
        }
    } finally {
        Pop-Location
    }

    $vsix = Get-Item -LiteralPath $outputPath
    Write-Host ''
    Write-Host '=== Build complete ===' -ForegroundColor Green
    Write-Host "VSIX: $($vsix.FullName)" -ForegroundColor Green
    Write-Host "Install: code --install-extension `"$($vsix.FullName)`"" -ForegroundColor Cyan
} finally {
    Set-Content -LiteralPath $packageJsonPath -Value $originalPackageJson -NoNewline
    Set-Content -LiteralPath $packageLockPath -Value $originalPackageLock -NoNewline
}
