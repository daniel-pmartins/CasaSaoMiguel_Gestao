# Decisões técnicas

## ADR-001 — API HTTP local

O frontend conversa com serviços Node.js por HTTP local. Isso mantém a aplicação independente de plataformas de planilha e torna o comportamento testável.

## ADR-002 — SQLite como persistência local

SQLite foi escolhido por não exigir um servidor separado e por oferecer transações, integridade referencial e uma boa trilha de migrações para o porte atual do sistema.

## ADR-003 — Dados operacionais fora do Git

O repositório público contém código, esquema e documentação, mas não contém bancos operacionais, credenciais ou backups.
