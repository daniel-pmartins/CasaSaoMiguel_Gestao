# Simulação do Sistema

A publicação na Vercel usa um build estático separado do sistema local.

## Garantias

- Não inclui `database/data/local.sqlite`.
- Não inicia `src/server/server.js`.
- Usa `web/demo-api.js` com dados demonstrativos.
- Operações de gravação, alteração e exclusão são rejeitadas pela API de demonstração.
- Os controles de alteração ficam desabilitados visualmente.

## Gerar localmente

```powershell
npm.cmd run build:showcase
```

O resultado é criado em `dist/`, que permanece ignorado pelo Git.

## Vercel

O projeto usa `vercel.json` para executar `scripts/build-showcase.js` e publicar `dist/`. A branch de produção deve ser `saomiguel`. Depois da primeira importação do repositório no painel da Vercel, novos commits nessa branch geram novos deployments automaticamente.
