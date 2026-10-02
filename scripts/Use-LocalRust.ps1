# Dot-source this script: . ./scripts/Use-LocalRust.ps1
# Only changes the environment of the current PowerShell process.
$treadProjectRoot = Split-Path $PSScriptRoot -Parent
$treadCargoRoot = Join-Path $treadProjectRoot '.tools/cargo'
$treadRustupRoot = Join-Path $treadProjectRoot '.tools/rustup'
if (-not (Test-Path -LiteralPath (Join-Path $treadCargoRoot 'bin/cargo.exe'))) {
    throw 'No local Rust installation found in TreadProof/.tools. Use an existing Rust installation or install the toolchain described in rust-toolchain.toml.'
}
$env:CARGO_HOME = $treadCargoRoot
$env:RUSTUP_HOME = $treadRustupRoot
$env:PATH = (Join-Path $treadCargoRoot 'bin') + ';' + $env:PATH
# The GNU Rust distribution includes LLD and its Windows runtime libraries.
$treadLinker = Join-Path $treadRustupRoot 'toolchains/1.98.1-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe'
if (Test-Path -LiteralPath $treadLinker) {
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = $treadLinker
}
Write-Output 'Rust local habilitado para esta sesión de PowerShell.'
