const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS insumos (
      id TEXT PRIMARY KEY,
      data_cadastro TEXT,
      data_ultima_alteracao TEXT,
      descricao TEXT NOT NULL,
      unidade TEXT NOT NULL,
      observacao TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL,
      fc REAL NOT NULL DEFAULT 1,
      controla_estoque INTEGER NOT NULL DEFAULT 1,
      CHECK (fc > 0),
      CHECK (unidade IN ('G', 'ML', 'UN', 'CM', 'KWH'))
    );

    CREATE INDEX IF NOT EXISTS insumos_descricao_idx
      ON insumos (descricao COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS insumos_categoria_idx
      ON insumos (categoria);

    CREATE TABLE IF NOT EXISTS fornecedores (
      id TEXT PRIMARY KEY,
      cnpj TEXT NOT NULL,
      data_abertura TEXT,
      situacao_cadastral TEXT NOT NULL DEFAULT '',
      data_situacao_cadastral TEXT,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT NOT NULL DEFAULT '',
      logradouro TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      complemento TEXT NOT NULL DEFAULT '',
      bairro TEXT NOT NULL DEFAULT '',
      cep TEXT NOT NULL DEFAULT '',
      cidade TEXT NOT NULL DEFAULT '',
      uf TEXT NOT NULL DEFAULT '',
      nome_contato TEXT NOT NULL DEFAULT '',
      telefone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      data_cadastro TEXT,
      data_ultima_alteracao TEXT,
      situacao_compras TEXT NOT NULL DEFAULT 'ATIVO',
      excluido_logicamente INTEGER NOT NULL DEFAULT 0,
      excluido_em TEXT,
      CHECK (situacao_compras IN ('ATIVO', 'INATIVO'))
    );

    CREATE INDEX IF NOT EXISTS fornecedores_razao_social_idx
      ON fornecedores (razao_social COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS fornecedores_cnpj_idx
      ON fornecedores (cnpj);

    CREATE INDEX IF NOT EXISTS fornecedores_ativos_idx
      ON fornecedores (excluido_logicamente, situacao_compras);

    CREATE TABLE IF NOT EXISTS estoque_saldos (
      insumo_id TEXT PRIMARY KEY,
      quantidade_mili TEXT NOT NULL DEFAULT '0',
      valor_exato TEXT NOT NULL DEFAULT '0/1',
      pendente_exato TEXT NOT NULL DEFAULT '0/1',
      ultimo_custo_exato TEXT NOT NULL DEFAULT '0/1',
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS estoque_inventarios (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      status TEXT NOT NULL,
      iniciado_em TEXT,
      encerrado_em TEXT,
      justificativa TEXT NOT NULL DEFAULT '',
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS estoque_contagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id TEXT NOT NULL,
      insumo_id TEXT NOT NULL,
      quantidade_mili TEXT NOT NULL DEFAULT '',
      tam_embalagem TEXT NOT NULL DEFAULT '',
      unidade_embalagem TEXT NOT NULL DEFAULT '',
      preco_centavos TEXT NOT NULL DEFAULT '',
      saldo_referencia_mili TEXT NOT NULL DEFAULT '',
      momento_contagem TEXT,
      compensar TEXT NOT NULL DEFAULT 'SIM',
      gravado TEXT NOT NULL DEFAULT 'NÃO',
      atualizado_em TEXT,
      UNIQUE (inventario_id, insumo_id)
    );

    CREATE TABLE IF NOT EXISTS estoque_operacoes (
      id TEXT PRIMARY KEY,
      data TEXT,
      movimento TEXT NOT NULL,
      tipo TEXT NOT NULL,
      referencia TEXT NOT NULL DEFAULT '',
      valor_impacto_exato TEXT NOT NULL DEFAULT '0/1',
      observacao TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
      id TEXT PRIMARY KEY,
      operacao_id TEXT NOT NULL,
      data TEXT,
      insumo_id TEXT NOT NULL,
      quantidade_mili TEXT NOT NULL DEFAULT '0',
      valor_antes_exato TEXT NOT NULL DEFAULT '0/1',
      valor_depois_exato TEXT NOT NULL DEFAULT '0/1',
      pendente_antes_exato TEXT NOT NULL DEFAULT '0/1',
      pendente_depois_exato TEXT NOT NULL DEFAULT '0/1',
      descricao TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS estoque_inventario_final (
      inventario_id TEXT NOT NULL,
      insumo_id TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      unidade TEXT NOT NULL DEFAULT '',
      referencia_mili TEXT NOT NULL DEFAULT '0',
      contagem_mili TEXT NOT NULL DEFAULT '0',
      diferenca_mili TEXT NOT NULL DEFAULT '0',
      compensar TEXT NOT NULL DEFAULT 'SIM',
      tam_embalagem TEXT NOT NULL DEFAULT '',
      un_embalagem TEXT NOT NULL DEFAULT '',
      preco_centavos TEXT NOT NULL DEFAULT '',
      valor_antes_exato TEXT NOT NULL DEFAULT '0/1',
      valor_depois_exato TEXT NOT NULL DEFAULT '0/1',
      PRIMARY KEY (inventario_id, insumo_id)
    );

    CREATE TABLE IF NOT EXISTS estoque_custos_referencia (
      insumo_id TEXT PRIMARY KEY,
      unidade TEXT NOT NULL,
      custo_exato TEXT NOT NULL DEFAULT '0/1',
      atualizado_em TEXT,
      origem TEXT NOT NULL DEFAULT '',
      referencia TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS estoque_transicoes_insumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insumo_id TEXT NOT NULL,
      data TEXT,
      unidade_anterior TEXT NOT NULL DEFAULT '',
      unidade_nova TEXT NOT NULL DEFAULT '',
      controle_anterior TEXT NOT NULL DEFAULT '',
      controle_novo TEXT NOT NULL DEFAULT '',
      saldo_historico_mili TEXT NOT NULL DEFAULT '0',
      valor_historico_exato TEXT NOT NULL DEFAULT '0/1'
    );

    CREATE TABLE IF NOT EXISTS estoque_base_custo_nao_controlado (
      insumo_id TEXT NOT NULL,
      unidade_base TEXT NOT NULL,
      quantidade_referencia_mili TEXT NOT NULL DEFAULT '1000',
      valor_exato_da_unidade TEXT NOT NULL DEFAULT '0/1',
      origem TEXT NOT NULL DEFAULT '',
      atualizado_em TEXT,
      PRIMARY KEY (insumo_id, unidade_base)
    );

    CREATE TABLE IF NOT EXISTS estoque_detalhes_contagem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id TEXT NOT NULL,
      insumo_id TEXT NOT NULL,
      sequencia INTEGER NOT NULL,
      quantidade_mili TEXT NOT NULL DEFAULT '0',
      tamanho_mili TEXT NOT NULL DEFAULT '0',
      unidade TEXT NOT NULL DEFAULT '',
      ativo TEXT NOT NULL DEFAULT 'SIM',
      registrado_em TEXT,
      UNIQUE (inventario_id, insumo_id, sequencia)
    );

    CREATE TABLE IF NOT EXISTS estoque_rascunhos_saida (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      json_rascunho TEXT NOT NULL,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE INDEX IF NOT EXISTS estoque_contagens_inventario_idx
      ON estoque_contagens (inventario_id, insumo_id);

    CREATE INDEX IF NOT EXISTS estoque_movimentacoes_insumo_idx
      ON estoque_movimentacoes (insumo_id, data);

    CREATE TABLE IF NOT EXISTS compras (
      id TEXT PRIMARY KEY,
      situacao TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      serie TEXT NOT NULL DEFAULT '',
      data_emissao TEXT,
      chave_nfe TEXT NOT NULL DEFAULT '',
      fornecedor_id TEXT NOT NULL DEFAULT '',
      cnpj TEXT NOT NULL DEFAULT '',
      razao_social TEXT NOT NULL DEFAULT '',
      total_nota_cent TEXT NOT NULL DEFAULT '0',
      frete_nota_cent TEXT NOT NULL DEFAULT '0',
      desconto_nota_cent TEXT NOT NULL DEFAULT '0',
      outros_xml_cent TEXT NOT NULL DEFAULT '0',
      outros_externos_cent TEXT NOT NULL DEFAULT '0',
      justificativa_externos TEXT NOT NULL DEFAULT '',
      credito_usado_cent TEXT NOT NULL DEFAULT '0',
      criado_em TEXT,
      atualizado_em TEXT,
      observacoes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS compras_itens (
      compra_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      codigo_xml TEXT NOT NULL DEFAULT '',
      descricao_xml TEXT NOT NULL DEFAULT '',
      qtd_comprada_mili TEXT NOT NULL DEFAULT '0',
      qtd_recebida_mili TEXT NOT NULL DEFAULT '0',
      qtd_cancelada_mili TEXT NOT NULL DEFAULT '0',
      embalagem_mili TEXT NOT NULL DEFAULT '0',
      unidade_embalagem TEXT NOT NULL DEFAULT '',
      preco_unit_cent TEXT NOT NULL DEFAULT '0',
      valor_total_cent TEXT NOT NULL DEFAULT '0',
      insumo_id TEXT NOT NULL DEFAULT '',
      grupo_xml TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (compra_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS compras_recebimentos (
      id TEXT PRIMARY KEY,
      compra_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      data TEXT,
      qtd_comercial_mili TEXT NOT NULL DEFAULT '0',
      qtd_base_mili TEXT NOT NULL DEFAULT '0',
      custo_exato TEXT NOT NULL DEFAULT '0/1',
      movimento_id TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS compras_pagamentos (
      compra_id TEXT NOT NULL,
      pagamento_id TEXT NOT NULL,
      forma TEXT NOT NULL DEFAULT '',
      valor_cent TEXT NOT NULL DEFAULT '0',
      vencimento TEXT,
      pago TEXT NOT NULL DEFAULT 'NÃO',
      data_pagamento TEXT,
      cartao_id TEXT NOT NULL DEFAULT '',
      parcela INTEGER NOT NULL DEFAULT 1,
      total_parcelas INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (compra_id, pagamento_id)
    );

    CREATE TABLE IF NOT EXISTS compras_pagamentos_externos (
      compra_id TEXT NOT NULL,
      pagamento_id TEXT NOT NULL,
      forma TEXT NOT NULL DEFAULT '',
      valor_cent TEXT NOT NULL DEFAULT '0',
      vencimento TEXT,
      pago TEXT NOT NULL DEFAULT 'NÃO',
      data_pagamento TEXT,
      cartao_id TEXT NOT NULL DEFAULT '',
      parcela INTEGER NOT NULL DEFAULT 1,
      total_parcelas INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (compra_id, pagamento_id)
    );

    CREATE TABLE IF NOT EXISTS compras_despesas_externas (
      id TEXT PRIMARY KEY,
      compra_id TEXT NOT NULL,
      fornecedor_mercadoria_id TEXT NOT NULL DEFAULT '',
      valor_cent TEXT NOT NULL DEFAULT '0',
      justificativa TEXT NOT NULL DEFAULT '',
      data TEXT,
      origem TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS compras_ajustes (
      id TEXT PRIMARY KEY,
      compra_id TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL DEFAULT '',
      qtd_mili TEXT NOT NULL DEFAULT '0',
      valor_cent TEXT NOT NULL DEFAULT '0',
      parcela TEXT NOT NULL DEFAULT '',
      justificativa TEXT NOT NULL DEFAULT '',
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS compras_creditos (
      id TEXT PRIMARY KEY,
      fornecedor_id TEXT NOT NULL DEFAULT '',
      origem_compra TEXT NOT NULL DEFAULT '',
      total_cent TEXT NOT NULL DEFAULT '0',
      usado_cent TEXT NOT NULL DEFAULT '0',
      justificativa TEXT NOT NULL DEFAULT '',
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS compras_usos_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credito_id TEXT NOT NULL,
      compra_id TEXT NOT NULL,
      valor_cent TEXT NOT NULL DEFAULT '0',
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS compras_vinculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_id TEXT NOT NULL DEFAULT '',
      codigo_xml TEXT NOT NULL DEFAULT '',
      descricao_xml TEXT NOT NULL DEFAULT '',
      preco_identificador TEXT NOT NULL DEFAULT '',
      insumo_id TEXT NOT NULL DEFAULT '',
      embalagem_mili TEXT NOT NULL DEFAULT '0',
      unidade TEXT NOT NULL DEFAULT '',
      atualizado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS compras_rascunhos (
      id TEXT PRIMARY KEY,
      situacao TEXT NOT NULL,
      fornecedor_nome TEXT NOT NULL DEFAULT '',
      criado_em TEXT,
      atualizado_em TEXT,
      versao INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS compras_rascunho_partes (
      rascunho_id TEXT NOT NULL,
      versao INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      json_parcial TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (rascunho_id, versao, ordem)
    );

    CREATE INDEX IF NOT EXISTS compras_situacao_idx ON compras (situacao, atualizado_em);
    CREATE INDEX IF NOT EXISTS compras_fornecedor_idx ON compras (fornecedor_id, atualizado_em);

    CREATE TABLE IF NOT EXISTS ft_cadastros (
      ft_id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      versao_atual INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT,
      atualizado_em TEXT,
      observacoes TEXT NOT NULL DEFAULT '',
      excluido INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ft_versoes (
      ft_id TEXT NOT NULL,
      versao INTEGER NOT NULL,
      data TEXT,
      responsavel TEXT NOT NULL DEFAULT '',
      receita_json TEXT NOT NULL,
      motivo TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (ft_id, versao)
    );

    CREATE TABLE IF NOT EXISTS ft_categorias (
      nome TEXT PRIMARY KEY,
      criado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS ft_custos_manuais (
      insumo_id TEXT PRIMARY KEY,
      unidade TEXT NOT NULL,
      custo_exato TEXT NOT NULL DEFAULT '0/1',
      data TEXT,
      origem TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ft_precos (
      ft_id TEXT NOT NULL,
      config_key TEXT NOT NULL,
      pdv TEXT NOT NULL DEFAULT '',
      data TEXT,
      responsavel TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (ft_id, config_key)
    );

    CREATE INDEX IF NOT EXISTS ft_cadastros_categoria_idx ON ft_cadastros (categoria, status);
  `);
}

module.exports = { createDatabase, migrate };
