-- Estrutura inicial de cadastros.
-- Deve ser aplicada somente no banco local desta aplicação.

create table if not exists public.insumos (
  id text primary key,
  data_cadastro timestamptz,
  data_ultima_alteracao timestamptz,
  descricao text not null,
  unidade text not null,
  observacao text not null default '',
  categoria text not null,
  fc numeric(12, 6) not null default 1,
  controla_estoque boolean not null default true,
  constraint insumos_id_formato check (id ~ '^INS[0-9]+$'),
  constraint insumos_fc_positivo check (fc > 0),
  constraint insumos_unidade_valida check (unidade in ('G', 'ML', 'UN', 'CM', 'KWH'))
);

create index if not exists insumos_descricao_idx
  on public.insumos (lower(descricao));

create index if not exists insumos_categoria_idx
  on public.insumos (categoria);

create table if not exists public.fornecedores (
  id text primary key,
  cnpj text not null,
  data_abertura date,
  situacao_cadastral text not null default '',
  data_situacao_cadastral date,
  razao_social text not null,
  nome_fantasia text not null default '',
  logradouro text not null default '',
  numero text not null default '',
  complemento text not null default '',
  bairro text not null default '',
  cep text not null default '',
  cidade text not null default '',
  uf text not null default '',
  nome_contato text not null default '',
  telefone text not null default '',
  email text not null default '',
  data_cadastro timestamptz,
  data_ultima_alteracao timestamptz,
  situacao_compras text not null default 'ATIVO',
  excluido_logicamente boolean not null default false,
  excluido_em timestamptz,
  constraint fornecedores_id_formato check (id ~ '^FOR[0-9]+$'),
  constraint fornecedores_uf_formato check (uf = '' or uf ~ '^[A-Za-z]{2}$'),
  constraint fornecedores_situacao_compras_valida check (situacao_compras in ('ATIVO', 'INATIVO'))
);

create index if not exists fornecedores_razao_social_idx
  on public.fornecedores (lower(razao_social));

create index if not exists fornecedores_cnpj_idx
  on public.fornecedores (cnpj);

create index if not exists fornecedores_ativos_idx
  on public.fornecedores (excluido_logicamente, situacao_compras);
