$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zipName = "kjdsai-listing-deploy.zip"
$zipPath = Join-Path $root $zipName

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

$files = Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $full = $_.FullName
    $full -notmatch '\\node_modules\\' -and
    $full -notmatch '\\.git\\' -and
    $full -notmatch '\\dist\\' -and
    $_.Name -ne '.env' -and
    $_.Name -ne $zipName
}

if (-not $files) {
    Write-Error "No files to pack."
}

Compress-Archive -Path ($files | ForEach-Object { $_.FullName }) -DestinationPath $zipPath -Force
Write-Host ""
Write-Host "[OK] Created: $zipPath"
Write-Host ""

$paymentDir = Join-Path $root "assets\payment"
$wechat = Join-Path $paymentDir "wechat-pay.png"
$alipay = Join-Path $paymentDir "alipay-pay.png"
if (-not (Test-Path $wechat) -or -not (Test-Path $alipay)) {
    Write-Host "[WARN] Payment QR images missing:"
    if (-not (Test-Path $wechat)) { Write-Host "  - assets/payment/wechat-pay.png" }
    if (-not (Test-Path $alipay)) { Write-Host "  - assets/payment/alipay-pay.png" }
    Write-Host "Add them before uploading if you need the pay modal."
    Write-Host ""
}
