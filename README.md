# Casa São Miguel — Sistema de Gestão

Aplicação local para gestão administrativa de insumos, fornecedores, compras, estoque e fichas técnicas.

## Stack

- Node.js 24+
- SQLite local
- API HTTP nativa do Node.js
- HTML, CSS e JavaScript sem dependência de plataforma externa
- Testes com `node:test`

## Executar

Na raiz do projeto:

```powershell
npm.cmd start
```

A aplicação ficará disponível em `http://127.0.0.1:8787`.

## Testar

```powershell
npm.cmd run verify
```

## Organização

```text
src/server/       API, banco e serviços de domínio
web/              menu, módulos, estilos e assets
database/         migrações SQL e dados locais ignorados pelo Git
tests/            testes automatizados
docs/             arquitetura, desenvolvimento e banco
scripts/          automações auxiliares
```

## Dados locais

O banco de execução fica em `database/data/local.sqlite` e não deve ser publicado. A estrutura do banco é mantida em `database/migrations/`.

## Princípios

- Toda regra de negócio deve ficar no backend, em serviços testáveis.
- O frontend conversa com a API HTTP usando `fetch`.
- Dados reais e credenciais nunca entram no repositório público.
- Mudanças de banco devem ser reproduzíveis e documentadas.

Consulte [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) para detalhes.

## Simulação pública

Para gerar a versão visual somente leitura destinada à Vercel:

```powershell
npm.cmd run build:showcase
```

Consulte [`docs/SHOWCASE.md`](docs/SHOWCASE.md). Essa versão usa dados demonstrativos, não acessa o SQLite local e desabilita operações de gravação.
