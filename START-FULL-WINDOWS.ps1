$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'CareerBrand AI v7 — толық режим' -ForegroundColor Cyan
Write-Host 'Нақты email HeadHunter API сұраулары үшін қажет. Кілт дискке сақталмайды.'
$email = Read-Host 'Сізбен байланысуға болатын email (HeadHunter үшін)'
if ($email -match '^[^\s@]+@[^\s@]+\.[^\s@]+$') { $env:HH_CONTACT_EMAIL = $email }
else { Write-Warning 'HeadHunter бөлігі жұмыс істемейді: email жарамсыз немесе бос.' }
$enable = Read-Host 'OpenAI ЖИ іске қосасыз ба? API пайдалану ақылы болуы мүмкін (y/n)'
if ($enable -match '^(y|yes|иә|да)$') {
  $secure = Read-Host 'OpenAI API key' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
try {
  Write-Host 'Сайт: http://127.0.0.1:3000' -ForegroundColor Green
  Start-Process 'http://127.0.0.1:3000'
  & node server.mjs
} finally {
  Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\HH_CONTACT_EMAIL -ErrorAction SilentlyContinue
}
