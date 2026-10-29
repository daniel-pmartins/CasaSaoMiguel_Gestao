# Desenvolvimento

## Requisitos

- Node.js 24 ou superior
- PowerShell no Windows

## Comandos

```powershell
npm.cmd start
npm.cmd test
npm.cmd run check
npm.cmd run verify
```

## Fluxo recomendado

1. Crie uma branch de trabalho.
2. Faça a alteração em uma camada por vez.
3. Adicione ou atualize testes do serviço afetado.
4. Execute `npm.cmd run verify`.
5. Verifique manualmente os módulos no navegador.
6. Registre mudanças de banco e comportamento na documentação.

## API

As rotas públicas começam em `/api/`. O endpoint `/api/health` deve retornar `ok: true` durante a execução normal.

## Frontend

O cliente usa `web/api-client.js` e chamadas HTTP nativas. Não são permitidas dependências de APIs de plataformas de planilha ou de execução remota de scripts.
