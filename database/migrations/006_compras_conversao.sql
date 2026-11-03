-- Registra o fator efetivamente usado em cada item/recebimento.

alter table if exists public.compras_itens
  add column if not exists fator_conversao_g_ml numeric(18, 9) not null default 0;

alter table if exists public.compras_recebimentos
  add column if not exists fator_conversao_g_ml numeric(18, 9) not null default 0;
