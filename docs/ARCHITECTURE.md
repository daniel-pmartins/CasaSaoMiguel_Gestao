# Arquitetura

## Visão geral

O sistema é uma aplicação local composta por um servidor Node.js, uma API HTTP, serviços de domínio e um frontend web servido pelo próprio processo.

```text
navegador
   │ fetch
   ▼
src/server/server.js
   ├── cadastros.js
   ├── normalized-purchases.js
   ├── normalized-stock.js
   ├── normalized-ficha.js
   └── db.js
          │
          ▼
     SQLite local
```

## Camadas

- `src/server/server.js`: transporte HTTP, roteamento e serialização de respostas.
- `src/server/*`: regras de domínio e validações.
- `src/server/db.js`: conexão e evolução do esquema SQLite.
- `web/`: apresentação e cliente HTTP.
- `tests/`: contratos automatizados dos serviços.

## Regras de dependência

O frontend não acessa SQLite diretamente. O servidor não conhece detalhes de apresentação. Os serviços não dependem de navegador, planilha ou provedor externo.

## Dados externos

Consultas de CEP e CNPJ são integrações opcionais isoladas em `external-lookups.js`. A indisponibilidade desses provedores não deve corromper dados locais.

## Fichas técnicas offline

Alterações da FICHA TÉCNICA também podem ser preservadas localmente no navegador quando a API estiver indisponível. Esses rascunhos são exibidos na categoria original com a identificação `RASCUNHO LOCAL — NÃO SINCRONIZADO` e são removidos do armazenamento local somente após a sincronização confirmada no servidor.

O rendimento principal mantém a unidade física produzida e pode ter uma unidade de venda compatível (por exemplo, `2650 G` vendido em `KG`). O custo unitário e o preço são calculados na unidade de venda; rendimentos adicionais continuam representando suas próprias unidades comerciais, como `12 UN` de fatias.
