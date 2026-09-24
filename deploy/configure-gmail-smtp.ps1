param(
    [string]$ConfigPath = 'C:\inetpub\wwwroot\ua\config.json'
)

$username = Read-Host 'Gmail sender address'
$securePassword = Read-Host 'Gmail app password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    $sender = $username
    $values = [ordered]@{
        SMTP_HOST = 'smtp.gmail.com'
        SMTP_PORT = 587
        SMTP_USERNAME = $username
        SMTP_PASSWORD = $password
        SMTP_SENDER = $sender
        SMTP_FROM_NAME = 'UA HRMS'
    }

    foreach ($entry in $values.GetEnumerator()) {
        $config | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
    }

    $json = $config | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($ConfigPath, $json, [Text.UTF8Encoding]::new($false))
    Write-Host 'Gmail SMTP configuration saved. Recycle DefaultAppPool before testing.'
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
