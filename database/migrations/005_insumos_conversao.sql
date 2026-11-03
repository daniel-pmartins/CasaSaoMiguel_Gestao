-- Conversão opcional de volume para massa na entrada de compras.
-- Registros existentes permanecem com conversao_ativa = false e fator = 0.

alter table if exists public.insumos
  add column if not exists conversao_ativa boolean not null default false;

alter table if exists public.insumos
  add column if not exists fator_conversao_g_ml numeric(18, 9) not null default 0;

alter table if exists public.insumos
  drop constraint if exists insumos_fator_conversao_positivo;

alter table if exists public.insumos
  add constraint insumos_fator_conversao_positivo check (fator_conversao_g_ml >= 0);
