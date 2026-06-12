param(
  [Parameter(Mandatory = $true)]
  [string]$SecretKey,

  [string]$PublishableKey = "",
  [int]$UnitAmount = 1299,
  [string]$Currency = "usd",
  [string]$ProductName = "TableTalk Player Premium",
  [string]$Description = "Monthly premium access to grinder recommendations and player-hosted games.",
  [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

function Invoke-StripePost {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [hashtable]$Body
  )

  $authBytes = [Text.Encoding]::ASCII.GetBytes("${SecretKey}:")
  $headers = @{
    Authorization = "Basic $([Convert]::ToBase64String($authBytes))"
  }

  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.stripe.com/v1/$Path" `
    -Headers $headers `
    -ContentType "application/x-www-form-urlencoded" `
    -Body $Body
}

function Set-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $resolvedPath = Join-Path (Get-Location) $Path
  $lines = @()
  if (Test-Path $resolvedPath) {
    $lines = @(Get-Content -Path $resolvedPath)
  }

  $entry = "$Name=$Value"
  $matched = $false
  $nextLines = foreach ($line in $lines) {
    if ($line -match "^\s*$([Regex]::Escape($Name))\s*=") {
      $matched = $true
      $entry
    } else {
      $line
    }
  }

  if (-not $matched) {
    $nextLines += $entry
  }

  Set-Content -Path $resolvedPath -Value $nextLines
}

if ($UnitAmount -lt 1000 -or $UnitAmount -gt 1500) {
  throw "UnitAmount must stay between 1000 and 1500 cents for the requested $10-15 monthly membership."
}

Write-Host "Creating Stripe product..."
$product = Invoke-StripePost -Path "products" -Body @{
  name = $ProductName
  description = $Description
  "metadata[app]" = "tabletalk-player"
  "metadata[tier]" = "player-premium"
}

Write-Host "Creating recurring monthly price..."
$price = Invoke-StripePost -Path "prices" -Body @{
  product = $product.id
  currency = $Currency
  unit_amount = $UnitAmount
  "recurring[interval]" = "month"
  "metadata[app]" = "tabletalk-player"
  "metadata[tier]" = "player-premium"
}

Write-Host "Creating subscription payment link..."
$paymentLink = Invoke-StripePost -Path "payment_links" -Body @{
  "line_items[0][price]" = $price.id
  "line_items[0][quantity]" = "1"
  "subscription_data[description]" = $Description
  "subscription_data[metadata][app]" = "tabletalk-player"
  "subscription_data[metadata][tier]" = "player-premium"
}

Set-DotEnvValue -Path $EnvPath -Name "EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL" -Value $paymentLink.url
Set-DotEnvValue -Path $EnvPath -Name "EXPO_PUBLIC_PLAYER_PREMIUM_PRICE_ID" -Value $price.id
Set-DotEnvValue -Path $EnvPath -Name "EXPO_PUBLIC_PLAYER_PREMIUM_PRODUCT_ID" -Value $product.id

if ($PublishableKey.Trim()) {
  Set-DotEnvValue -Path $EnvPath -Name "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY" -Value $PublishableKey.Trim()
}

Write-Host ""
Write-Host "Stripe Player Premium setup complete."
Write-Host "Product: $($product.id)"
Write-Host "Price: $($price.id)"
Write-Host "Payment Link: $($paymentLink.url)"
Write-Host ""
Write-Host "Secret key was used for setup only and was not written to .env."
