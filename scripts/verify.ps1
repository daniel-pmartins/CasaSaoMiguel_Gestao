$ErrorActionPreference = 'Stop'

Write-Host 'Validando sintaxe e testes...'
npm.cmd run verify

Write-Host 'Validando a API local...'
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 10
if ($response.StatusCode -ne 200) {
  throw "A API retornou HTTP $($response.StatusCode)."
}

Write-Host 'Validação concluída.'
