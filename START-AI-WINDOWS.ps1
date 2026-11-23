$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'CareerBrand AI — ЖИ қосылған режим / AI mode' -ForegroundColor Cyan
Write-Host 'API кілті экранда көрсетілмейді және файлға жазылмайды.'
Write-Host 'API сұраулары ақылы болуы мүмкін. Ешқашан кілтті чатқа жібермеңіз.'
$secure = Read-Host 'OpenAI API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'API кілті енгізілмеді.' }
try {
  Write-Host 'Сайт: http://127.0.0.1:3000' -ForegroundColor Green
  Start-Process 'http://127.0.0.1:3000'
  & node server.mjs
} finally {
  Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue
}
