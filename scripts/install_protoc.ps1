$ErrorActionPreference = "Stop"

$ProtocVersion = "25.1"
$ProtocUrl = "https://github.com/protocolbuffers/protobuf/releases/download/v$ProtocVersion/protoc-$ProtocVersion-win64.zip"
$ToolsDir = Join-Path $PSScriptRoot "..\tools"
$ProtocZip = Join-Path $ToolsDir "protoc.zip"
$ProtocDir = Join-Path $ToolsDir "protoc"

# Create tools directory
if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
}

# Download protoc if not exists
if (-not (Test-Path $ProtocZip)) {
    Write-Host "Downloading protoc form $ProtocUrl..."
    Invoke-WebRequest -Uri $ProtocUrl -OutFile $ProtocZip
}

# Extract if not extracted
if (-not (Test-Path $ProtocDir)) {
    Write-Host "Extracting protoc..."
    Expand-Archive -Path $ProtocZip -DestinationPath $ProtocDir -Force
}

$ProtocExe = Join-Path $ProtocDir "bin\protoc.exe"
if (Test-Path $ProtocExe) {
    Write-Host "Protoc installed at $ProtocExe"
    # Set environment variable for the current process/session if needed, 
    # but returned path is what matters for caller.
    Write-Output $ProtocExe
} else {
    Write-Error "Protoc executable not found after extraction."
    exit 1
}
