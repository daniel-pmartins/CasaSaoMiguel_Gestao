# Banco de dados

O banco de execução é SQLite e fica em `database/data/local.sqlite`, diretório ignorado pelo Git.

As alterações estruturais ficam em `database/migrations/`, em arquivos SQL numerados e aplicados pelo módulo de banco.

## Regras

- Nunca publicar bancos com dados operacionais no repositório público.
- Fazer cópia antes de alterar o esquema.
- Usar transações para operações que alterem mais de uma tabela.
- Manter identificadores estáveis para registros já existentes.
- Testar migrações em uma cópia antes de aplicá-las ao banco de trabalho.

## Conversão opcional de volume para massa

`insumos.conversao_ativa` começa desativado para todos os registros existentes. Quando ativado, `fator_conversao_g_ml` representa quantos gramas correspondem a 1 ml do insumo.

Nas compras, a embalagem comercial original continua registrada em `compras_itens`; no recebimento, a quantidade normalizada em milésimos da unidade base é registrada em `compras_recebimentos`. O fator usado também é armazenado para manter a rastreabilidade do cálculo.
