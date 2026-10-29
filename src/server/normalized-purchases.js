const { parseMilli, parseFraction, fraction, fractionText, add, subtract, multiply, quantityText } = require('./normalized-stock');
const { CNPJ_SEM_DOCUMENTO, normalizeCnpj } = require('./cadastros');

class PurchaseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PurchaseValidationError';
  }
}

function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }
function now() { return new Date().toISOString(); }

function cents(value) {
  const number = BigInt(String(value || '0').replace(/\D/g, '') || '0');
  return number;
}

function money(value) {
  const amount = cents(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const decimal = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${whole},${decimal}`;
}

function amount(value) {
  const amountInCents = cents(value);
  const negative = amountInCents < 0n;
  const absolute = negative ? -amountInCents : amountInCents;
  const whole = absolute / 100n;
  const decimal = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${decimal}`;
}

function quantity(value) {
  const amount = BigInt(String(value || '0'));
  const whole = amount / 1000n;
  const decimal = String(amount % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${whole}${decimal ? `.${decimal}` : ''}`;
}

function decimalCents(value, allowZero = true) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new PurchaseValidationError('Valor monetário inválido.');
  const [whole, decimals = ''] = raw.split('.');
  const result = BigInt(whole) * 100n + BigInt((decimals + '00').slice(0, 2));
  if (!allowZero && result <= 0n) throw new PurchaseValidationError('O valor deve ser maior que zero.');
  return result;
}

function nextId(db, table, prefix) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`);
  let max = 0;
  for (const row of rows) {
    const match = String(row.id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

function packageSize(value, unit, baseUnit) {
  const normalized = String(unit || '').toUpperCase();
  const allowed = { G: ['G', 'KG'], ML: ['ML', 'L'], UN: ['UN'], CM: ['CM', 'M'], KWH: ['KWH'] }[baseUnit] || [];
  if (!allowed.includes(normalized)) throw new PurchaseValidationError(`Unidade da embalagem incompatível com ${baseUnit}.`);
  const size = parseMilli(value, false);
  return size * (normalized === 'KG' || normalized === 'L' ? 1000n : normalized === 'M' ? 100n : 1n);
}

function createNormalizedPurchaseService(db) {
  function activeSuppliers() {
    return db.prepare(`
      SELECT id, cnpj, razao_social, nome_fantasia
      FROM fornecedores
      WHERE excluido_logicamente = 0 AND situacao_compras = 'ATIVO'
      ORDER BY razao_social COLLATE NOCASE
    `).all().map((row) => ({ id: row.id, cnpj: row.cnpj, nome: row.razao_social, nomeFantasia: row.nome_fantasia || '' }));
  }

  function verifySupplierCnpj(value) {
    let cnpj;
    try {
      cnpj = normalizeCnpj(value);
    } catch (error) {
      throw new PurchaseValidationError(error.message);
    }
    if (cnpj === CNPJ_SEM_DOCUMENTO) throw new PurchaseValidationError('Informe um CNPJ com 14 posições.');
    const row = db.prepare('SELECT id, cnpj, razao_social, nome_fantasia, situacao_compras, excluido_logicamente FROM fornecedores WHERE cnpj = ? LIMIT 1').get(cnpj);
    if (!row) return { status: 'NAO_LOCALIZADO' };
    if (Number(row.excluido_logicamente) === 1 || row.situacao_compras !== 'ATIVO') {
      return { status: 'INATIVO', mensagem: 'Fornecedor cadastrado, mas INATIVO PARA COMPRAS. Atualize-o no módulo FORNECEDORES.' };
    }
    return {
      status: 'EXISTENTE',
      fornecedor: { id: row.id, cnpj: row.cnpj, nome: row.razao_social, nomeFantasia: row.nome_fantasia || '' }
    };
  }

  function ingredients() {
    return db.prepare('SELECT id, descricao, unidade, controla_estoque FROM insumos ORDER BY descricao COLLATE NOCASE').all()
      .map((row) => ({ id: row.id, nome: row.descricao, unidade: row.unidade, controla: Number(row.controla_estoque) === 1 ? 'SIM' : 'NÃO' }));
  }

  function summaryRows() {
    return db.prepare(`
      SELECT c.*, COALESCE(MAX(r.data), '') AS ultima_entrada, COALESCE(MAX(r.data), '') AS ultima_entrada_data
      FROM compras c
      LEFT JOIN compras_recebimentos r ON r.compra_id = c.id
      GROUP BY c.id
      ORDER BY c.atualizado_em DESC, c.id DESC
    `).all().map((row) => ({
      id: row.id,
      status: row.situacao,
      numero: row.numero,
      fornecedor: row.razao_social,
      fornecedorId: row.fornecedor_id,
      lancamento: row.criado_em || '',
      ultimaEntrada: row.ultima_entrada || '',
      ultimaEntradaMs: row.ultima_entrada ? new Date(row.ultima_entrada).getTime() : 0,
      lancamentoMs: row.criado_em ? new Date(row.criado_em).getTime() : 0,
      total: money(row.total_nota_cent)
    }));
  }

  function initialData() {
    const credits = db.prepare('SELECT * FROM compras_creditos').all().map((row) => {
      const balance = cents(row.total_cent) - cents(row.usado_cent);
      return { id: row.id, fornecedorId: row.fornecedor_id, saldo: money(balance), saldoCent: String(balance) };
    }).filter((row) => BigInt(row.saldoCent) > 0n);
    return {
      fornecedores: activeSuppliers(),
      insumos: ingredients(),
      compras: summaryRows(),
      creditos: credits,
      vinculos: db.prepare('SELECT * FROM compras_vinculos WHERE insumo_id <> \'\'').all().map((row) => ({
        fornecedorId: row.fornecedor_id,
        codigo: row.codigo_xml,
        descricao: row.descricao_xml,
        insumoId: row.insumo_id,
        embalagem: quantity(row.embalagem_mili),
        unidade: row.unidade
      })),
      entradasManuaisAtivas: true
    };
  }

  function query(tab, term, start, end) {
    const data = initialData();
    const wanted = text(term).toLocaleUpperCase('pt-BR');
    const min = start ? new Date(`${start}T00:00:00`).getTime() : 0;
    const max = end ? new Date(`${end}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    const pending = tab === 'PENDENTES';
    return data.compras.filter((item) => {
      const date = pending ? item.lancamentoMs : item.ultimaEntradaMs;
      const statusMatch = pending ? ['PENDENTE', 'PARCIAL'].includes(item.status) : ['RECEBIDA', 'CONCLUIDA_COM_CANCELAMENTO'].includes(item.status);
      const textMatch = !wanted || [item.id, item.numero, item.fornecedor, item.lancamento, item.ultimaEntrada]
        .some((value) => String(value).toLocaleUpperCase('pt-BR').includes(wanted));
      return statusMatch && date >= min && date <= max && textMatch;
    }).sort((left, right) => pending
      ? left.lancamentoMs - right.lancamentoMs || left.id.localeCompare(right.id)
      : right.ultimaEntradaMs - left.ultimaEntradaMs || right.id.localeCompare(left.id));
  }

  function get(id) {
    const row = db.prepare('SELECT * FROM compras WHERE id = ?').get(String(id || ''));
    if (!row) throw new PurchaseValidationError('Compra não localizada.');
    const items = db.prepare('SELECT * FROM compras_itens WHERE compra_id = ? ORDER BY item_id').all(row.id).map((item) => ({
      id: item.item_id,
      codigo: item.codigo_xml,
      descricao: item.descricao_xml,
      qtd: quantity(item.qtd_comprada_mili),
      recebida: quantity(item.qtd_recebida_mili),
      cancelada: quantity(item.qtd_cancelada_mili),
      embalagem: quantity(item.embalagem_mili),
      unidade: item.unidade_embalagem,
      preco: amount(item.preco_unit_cent),
      total: amount(item.valor_total_cent),
      insumoId: item.insumo_id
    }));
    return {
      id: row.id,
      status: row.situacao,
      origem: row.origem,
      numero: row.numero,
      serie: row.serie,
      emissao: row.data_emissao || '',
      chaveRegistrada: Boolean(row.chave_nfe),
      fornecedorId: row.fornecedor_id,
      cnpj: row.cnpj,
      fornecedor: row.razao_social,
      totalNota: money(row.total_nota_cent),
      frete: money(row.frete_nota_cent),
      desconto: money(row.desconto_nota_cent),
      outrosXml: money(row.outros_xml_cent),
      externos: money(row.outros_externos_cent),
      justificativaExterna: row.justificativa_externos,
      creditoUsado: money(row.credito_usado_cent),
      observacoes: row.observacoes,
      itens: items,
      pagamentos: db.prepare('SELECT * FROM compras_pagamentos WHERE compra_id = ?').all(row.id).map((payment) => ({
        id: payment.pagamento_id,
        referencia: 'FORNECEDOR',
        forma: payment.forma,
        valor: amount(payment.valor_cent),
        vencimento: payment.vencimento || '',
        pago: payment.pago === 'SIM',
        dataPagamento: payment.data_pagamento || '',
        cartao: payment.cartao_id,
        parcela: Number(payment.parcela),
        totalParcelas: Number(payment.total_parcelas)
      })).concat(db.prepare('SELECT * FROM compras_pagamentos_externos WHERE compra_id = ?').all(row.id).map((payment) => ({
        id: payment.pagamento_id,
        referencia: 'OUTROS CUSTOS',
        forma: payment.forma,
        valor: amount(payment.valor_cent),
        vencimento: payment.vencimento || '',
        pago: payment.pago === 'SIM',
        dataPagamento: payment.data_pagamento || '',
        cartao: payment.cartao_id,
        parcela: Number(payment.parcela),
        totalParcelas: Number(payment.total_parcelas)
      })))
    };
  }

  function savePurchase(data) {
    if (!data || !Array.isArray(data.itens) || !data.itens.length || data.itens.length > 300) throw new PurchaseValidationError('Informe entre 1 e 300 itens.');
    const supplier = db.prepare("SELECT * FROM fornecedores WHERE id = ? AND excluido_logicamente = 0 AND situacao_compras = 'ATIVO'").get(String(data.fornecedorId || ''));
    if (!supplier) throw new PurchaseValidationError('Fornecedor não está ATIVO PARA COMPRAS.');
    const origin = data.origem === 'XML' ? 'XML' : 'MANUAL';
    const key = text(data.chave, 100);
    if (origin === 'XML' && !/^\d{44}$/.test(key)) throw new PurchaseValidationError('Chave XML inválida.');
    if (key && db.prepare('SELECT 1 FROM compras WHERE chave_nfe = ?').get(key)) throw new PurchaseValidationError('NF-e já cadastrada nesta base.');

    let itemsTotal = 0n;
    const items = data.itens.map((item, index) => {
      const quantityMili = parseMilli(item.qtd, false);
      const unitPrice = decimalCents(item.preco, true);
      const totalCent = item.valorTotal !== undefined && String(item.valorTotal).trim() !== ''
        ? decimalCents(item.valorTotal, true)
        : unitPrice * quantityMili / 1000n;
      const insumoId = text(item.insumoId, 40);
      const insumo = insumoId ? db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId) : null;
      if (insumoId && !insumo) throw new PurchaseValidationError(`Insumo inválido no item ${index + 1}.`);
      const received = item.recebida ? parseMilli(item.recebida, true) : 0n;
      if (received > quantityMili) throw new PurchaseValidationError(`Recebimento maior que a compra no item ${index + 1}.`);
      const packaging = item.embalagem ? parseMilli(item.embalagem, false) : 0n;
      if (received > 0n && (!insumo || packaging === 0n || !item.unidade)) throw new PurchaseValidationError(`Vincule o insumo e informe a embalagem do item ${index + 1}.`);
      itemsTotal += totalCent;
      return {
        id: text(item.id, 40) || `IT${String(index + 1).padStart(4, '0')}`,
        codigo: text(item.codigo, 120),
        descricao: text(item.descricao, 250).toLocaleUpperCase('pt-BR'),
        quantityMili,
        received,
        packaging,
        unit: text(item.unidade, 12).toUpperCase(),
        unitPrice,
        totalCent,
        insumoId: insumo ? insumo.id : '',
        group: text(item.grupo, 120)
      };
    });
    if (itemsTotal <= 0n) throw new PurchaseValidationError('Valor dos produtos deve ser positivo.');
    const total = decimalCents(data.totalNota, false);
    const freight = decimalCents(data.frete || '0', true);
    const discount = decimalCents(data.desconto || '0', true);
    const otherXml = decimalCents(data.outrosXml || '0', true);
    const external = decimalCents(data.externos || '0', true);
    const fiscalAdjustment = BigInt(String(data.ajusteFiscalCent ?? '0'));
    if (origin !== 'XML' && fiscalAdjustment !== 0n) throw new PurchaseValidationError('Lançamento manual não permite ajuste fiscal de XML.');
    const expected = itemsTotal + freight - discount + otherXml + fiscalAdjustment;
    if (expected <= 0n || total !== expected) throw new PurchaseValidationError('TOTAL DA NOTA divergente dos itens e valores fiscais.');
    const externalJustification = text(data.justificativaExterna, 1000).toLocaleUpperCase('pt-BR');
    if (external > 0n && externalJustification.length < 8) throw new PurchaseValidationError('Justificativa de outros custos é obrigatória.');

    const payments = (Array.isArray(data.pagamentos) ? data.pagamentos : []).map((payment, index) => {
      const form = text(payment.forma, 40).toUpperCase();
      if (!['PIX', 'DINHEIRO', 'DÉBITO', 'CRÉDITO', 'BOLETO', 'PRAZO', 'TRANSFERÊNCIA', 'OUTROS'].includes(form)) throw new PurchaseValidationError('Forma de pagamento inválida.');
      return {
        id: text(payment.id, 40) || `PG${String(index + 1).padStart(4, '0')}`,
        reference: payment.referencia === 'OUTROS CUSTOS' ? 'OUTROS CUSTOS' : 'FORNECEDOR',
        form,
        value: decimalCents(payment.valor, false),
        due: text(payment.vencimento, 20),
        paid: payment.pago ? 'SIM' : 'NÃO',
        paidDate: text(payment.dataPagamento, 20),
        card: text(payment.cartao, 30),
        installment: Math.max(1, Number(payment.parcela || 1)),
        installments: Math.max(1, Number(payment.totalParcelas || 1))
      };
    });
    const supplierPayments = payments.filter((payment) => payment.reference === 'FORNECEDOR').reduce((sum, payment) => sum + payment.value, 0n);
    const externalPayments = payments.filter((payment) => payment.reference === 'OUTROS CUSTOS').reduce((sum, payment) => sum + payment.value, 0n);
    if (supplierPayments !== total) throw new PurchaseValidationError('Pagamentos do fornecedor devem somar o total da nota.');
    if (externalPayments !== external) throw new PurchaseValidationError('Pagamentos de outros custos devem somar as despesas externas.');

    const initialReceipts = items.filter((item) => item.received > 0n);
    const credits = Array.isArray(data.creditos) ? data.creditos : [];
    let creditUsed = 0n;
    for (const credit of credits) {
      const row = db.prepare('SELECT * FROM compras_creditos WHERE id = ?').get(String(credit.id));
      if (!row || row.fornecedor_id !== supplier.id) throw new PurchaseValidationError('Crédito não pertence ao fornecedor.');
      const value = decimalCents(credit.valor, false);
      if (value > cents(row.total_cent) - cents(row.usado_cent)) throw new PurchaseValidationError('Crédito excede saldo disponível.');
      creditUsed += value;
    }
    if (creditUsed > total) throw new PurchaseValidationError('Crédito superior ao valor da nota.');

    const id = nextId(db, 'compras', 'COM');
    const timestamp = now();
    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO compras (
          id, situacao, origem, numero, serie, data_emissao, chave_nfe, fornecedor_id, cnpj, razao_social,
          total_nota_cent, frete_nota_cent, desconto_nota_cent, outros_xml_cent, outros_externos_cent,
          justificativa_externos, credito_usado_cent, criado_em, atualizado_em, observacoes
        ) VALUES (?, 'PENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, origin, text(data.numero, 40), text(data.serie, 15), text(data.emissao, 20), key, supplier.id, supplier.cnpj, supplier.razao_social, String(total), String(freight), String(discount), String(otherXml), String(external), externalJustification, String(creditUsed), timestamp, timestamp, text(data.observacoes, 1000));
      const insertItem = db.prepare(`
        INSERT INTO compras_itens (compra_id, item_id, codigo_xml, descricao_xml, qtd_comprada_mili, qtd_recebida_mili, embalagem_mili, unidade_embalagem, preco_unit_cent, valor_total_cent, insumo_id, grupo_xml)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach((item) => insertItem.run(id, item.id, item.codigo, item.descricao, String(item.quantityMili), '0', String(item.packaging), item.unit, String(item.unitPrice), String(item.totalCent), item.insumoId, item.group));
      const insertPayment = db.prepare(`INSERT INTO compras_pagamentos (compra_id, pagamento_id, forma, valor_cent, vencimento, pago, data_pagamento, cartao_id, parcela, total_parcelas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertExternalPayment = db.prepare(`INSERT INTO compras_pagamentos_externos (compra_id, pagamento_id, forma, valor_cent, vencimento, pago, data_pagamento, cartao_id, parcela, total_parcelas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      payments.forEach((payment) => {
        const args = [id, payment.id, payment.form, String(payment.value), payment.due, payment.paid, payment.paidDate, payment.card, payment.installment, payment.installments];
        (payment.reference === 'OUTROS CUSTOS' ? insertExternalPayment : insertPayment).run(...args);
      });
      for (const credit of credits) {
        const value = decimalCents(credit.valor, false);
        db.prepare('UPDATE compras_creditos SET usado_cent = ? WHERE id = ?').run(String(cents(db.prepare('SELECT usado_cent FROM compras_creditos WHERE id = ?').get(String(credit.id)).usado_cent) + value), String(credit.id));
        db.prepare('INSERT INTO compras_usos_credito (credito_id, compra_id, valor_cent, data) VALUES (?, ?, ?, ?)').run(String(credit.id), id, String(value), timestamp);
      }
      if (external > 0n) db.prepare('INSERT INTO compras_despesas_externas (id, compra_id, fornecedor_mercadoria_id, valor_cent, justificativa, data, origem) VALUES (?, ?, ?, ?, ?, ?, ?)').run(nextId(db, 'compras_despesas_externas', 'DES'), id, supplier.id, String(external), externalJustification, timestamp, 'PAGO POR FORA');
      db.exec('COMMIT');
      if (initialReceipts.length) {
        const received = receive(id, initialReceipts.map((item) => ({
          itemId: item.id,
          quantidade: quantity(item.received),
          insumoId: item.insumoId,
          embalagem: quantity(item.packaging),
          unidade: item.unit
        })));
        return { ok: true, id, status: received.status, movimento: received.movimento };
      }
      return { ok: true, id, status: 'PENDENTE' };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function receive(purchaseId, requested) {
    const purchase = db.prepare("SELECT * FROM compras WHERE id = ? AND situacao IN ('PENDENTE', 'PARCIAL')").get(String(purchaseId || ''));
    if (!purchase) throw new PurchaseValidationError('Compra não está pendente.');
    if (!Array.isArray(requested) || !requested.length) throw new PurchaseValidationError('Selecione itens para recebimento.');
    const allItems = db.prepare('SELECT * FROM compras_itens WHERE compra_id = ?').all(purchase.id);
    const byId = new Map(allItems.map((item) => [item.item_id, item]));
    const selected = new Map();
    for (const entry of requested) {
      const itemId = String(entry?.itemId || '');
      if (!byId.has(itemId) || selected.has(itemId)) throw new PurchaseValidationError('Item inválido ou repetido no recebimento.');
      const item = byId.get(itemId);
      const quantityMili = parseMilli(entry.quantidade, false);
      const remaining = BigInt(item.qtd_comprada_mili || '0') - BigInt(item.qtd_recebida_mili || '0') - BigInt(item.qtd_cancelada_mili || '0');
      if (quantityMili > remaining) throw new PurchaseValidationError(`Quantidade acima do saldo pendente: ${item.descricao_xml}.`);
      const insumoId = text(entry.insumoId || item.insumo_id, 40);
      const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
      if (!insumo) throw new PurchaseValidationError(`Vincule o item ao insumo: ${item.descricao_xml}.`);
      const packageValue = entry.embalagem || quantity(item.embalagem_mili);
      const packageUnit = String(entry.unidade || item.unidade_embalagem || '').toUpperCase();
      if (!packageValue || !packageUnit) throw new PurchaseValidationError(`Informe a embalagem: ${item.descricao_xml}.`);
      const packageMili = packageSize(packageValue, packageUnit, insumo.unidade);
      const baseQuantity = quantityMili * packageMili / 1000n;
      if (baseQuantity <= 0n) throw new PurchaseValidationError(`Quantidade inválida: ${item.descricao_xml}.`);
      selected.set(itemId, { item, insumo, quantityMili, packageMili: parseMilli(packageValue, false), packageUnit, baseQuantity });
    }

    const itemTotal = allItems.reduce((sum, item) => sum + cents(item.valor_total_cent), 0n);
    if (itemTotal <= 0n) throw new PurchaseValidationError('Valor dos itens inválido.');
    const purchaseValue = fraction(cents(purchase.total_nota_cent) + cents(purchase.outros_externos_cent), 100n);
    const nowValue = now();
    db.exec('BEGIN');
    try {
      const operationId = nextId(db, 'estoque_operacoes', 'MOV');
      const insertOperation = db.prepare('INSERT INTO estoque_operacoes (id, data, movimento, tipo, referencia, valor_impacto_exato, observacao) VALUES (?, ?, \'ENTRADA\', \'COMPRA\', ?, ?, ?)');
      const insertMovement = db.prepare(`
        INSERT INTO estoque_movimentacoes (id, operacao_id, data, insumo_id, quantidade_mili, valor_antes_exato, valor_depois_exato, pendente_antes_exato, pendente_depois_exato, descricao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBalance = db.prepare(`
        INSERT INTO estoque_saldos (insumo_id, quantidade_mili, valor_exato, pendente_exato, ultimo_custo_exato, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(insumo_id) DO UPDATE SET quantidade_mili = excluded.quantidade_mili, valor_exato = excluded.valor_exato,
          pendente_exato = excluded.pendente_exato, ultimo_custo_exato = excluded.ultimo_custo_exato, atualizado_em = excluded.atualizado_em
      `);
      const upsertReference = db.prepare(`
        INSERT INTO estoque_custos_referencia (insumo_id, unidade, custo_exato, atualizado_em, origem, referencia)
        VALUES (?, ?, ?, ?, 'COMPRA', ?)
        ON CONFLICT(insumo_id) DO UPDATE SET unidade = excluded.unidade, custo_exato = excluded.custo_exato,
          atualizado_em = excluded.atualizado_em, origem = excluded.origem, referencia = excluded.referencia
      `);
      const updates = [];
      const movements = [];
      let impact = fraction(0n);
      for (const entry of selected.values()) {
        const itemValue = fraction(cents(entry.item.valor_total_cent), itemTotal);
        const quantityRatio = fraction(entry.quantityMili, BigInt(entry.item.qtd_comprada_mili || '1'));
        const value = multiply(multiply(purchaseValue, itemValue), quantityRatio);
        const balance = db.prepare('SELECT * FROM estoque_saldos WHERE insumo_id = ?').get(entry.insumo.id) || { quantidade_mili: '0', valor_exato: '0/1', pendente_exato: '0/1', ultimo_custo_exato: '0/1' };
        const beforeQuantity = BigInt(balance.quantidade_mili || '0');
        const beforeValue = parseFraction(balance.valor_exato);
        const beforePending = parseFraction(balance.pendente_exato);
        let afterQuantity = beforeQuantity;
        let afterValue = beforeValue;
        let afterPending = beforePending;
        if (Number(entry.insumo.controla_estoque) === 1) {
          afterQuantity += entry.baseQuantity;
          afterValue = add(beforeValue, add(value, beforePending));
          afterPending = fraction(0n);
          const lastCost = afterQuantity > 0n ? multiply(afterValue, fraction(1000n, afterQuantity)) : parseFraction(balance.ultimo_custo_exato);
          upsertBalance.run(entry.insumo.id, String(afterQuantity), fractionText(afterValue), fractionText(afterPending), fractionText(lastCost), nowValue);
        } else {
          const unitCost = multiply(value, fraction(1000n, entry.baseQuantity));
          upsertReference.run(entry.insumo.id, entry.insumo.unidade, fractionText(unitCost), nowValue, purchase.id);
        }
        const movementId = nextId(db, 'estoque_movimentacoes', 'DET');
        insertMovement.run(movementId, operationId, nowValue, entry.insumo.id, String(entry.baseQuantity), fractionText(beforeValue), fractionText(afterValue), fractionText(beforePending), fractionText(afterPending), `COMPRA · ${entry.item.descricao_xml}`);
        impact = add(impact, subtract(afterValue, beforeValue));
        updates.push({ item: entry.item, quantityMili: entry.quantityMili, packageMili: entry.packageMili, packageUnit: entry.packageUnit, insumoId: entry.insumo.id, value });
        movements.push(movementId);
      }
      insertOperation.run(operationId, nowValue, purchase.id, fractionText(impact), 'Recebimento normalizado de compra.');
      const updateItem = db.prepare('UPDATE compras_itens SET qtd_recebida_mili = ?, embalagem_mili = ?, unidade_embalagem = ?, insumo_id = ? WHERE compra_id = ? AND item_id = ?');
      const insertReceipt = db.prepare('INSERT INTO compras_recebimentos (id, compra_id, item_id, data, qtd_comercial_mili, qtd_base_mili, custo_exato, movimento_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index];
        const receivedTotal = BigInt(update.item.qtd_recebida_mili || '0') + update.quantityMili;
        updateItem.run(String(receivedTotal), String(update.packageMili), update.packageUnit, update.insumoId, purchase.id, update.item.item_id);
        insertReceipt.run(nextId(db, 'compras_recebimentos', 'REC'), purchase.id, update.item.item_id, nowValue, String(update.quantityMili), String(update.quantityMili * update.packageMili / 1000n), fractionText(update.value), movements[index]);
      }
      const updatedItems = db.prepare('SELECT qtd_comprada_mili, qtd_recebida_mili, qtd_cancelada_mili FROM compras_itens WHERE compra_id = ?').all(purchase.id);
      const pending = updatedItems.some((item) => BigInt(item.qtd_comprada_mili) > BigInt(item.qtd_recebida_mili) + BigInt(item.qtd_cancelada_mili));
      const canceled = updatedItems.some((item) => BigInt(item.qtd_cancelada_mili) > 0n);
      const status = pending ? 'PARCIAL' : (canceled ? 'CONCLUIDA_COM_CANCELAMENTO' : 'RECEBIDA');
      db.prepare('UPDATE compras SET situacao = ?, atualizado_em = ? WHERE id = ?').run(status, nowValue, purchase.id);
      db.exec('COMMIT');
      return { ok: true, status, movimento: operationId, quantidade: updates.length };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function cancelPending(data) {
    const purchaseId = String(data?.id || '');
    const purchase = db.prepare("SELECT * FROM compras WHERE id = ? AND situacao IN ('PENDENTE', 'PARCIAL')").get(purchaseId);
    if (!purchase) throw new PurchaseValidationError('Compra não possui saldo pendente.');
    const item = db.prepare('SELECT * FROM compras_itens WHERE compra_id = ? AND item_id = ?').get(purchaseId, String(data.itemId || ''));
    if (!item) throw new PurchaseValidationError('Item não encontrado.');
    const quantityMili = parseMilli(data.quantidade, false);
    const remaining = BigInt(item.qtd_comprada_mili) - BigInt(item.qtd_recebida_mili) - BigInt(item.qtd_cancelada_mili);
    if (quantityMili > remaining) throw new PurchaseValidationError('Cancelamento acima do saldo pendente.');
    const justification = text(data.justificativa, 800);
    if (justification.length < 8) throw new PurchaseValidationError('Justificativa com pelo menos 8 caracteres obrigatória.');
    const destination = String(data.destino || 'PARCELA').toUpperCase();
    if (!['PARCELA', 'CREDITO'].includes(destination)) throw new PurchaseValidationError('Informe destino financeiro.');
    const totalItems = db.prepare('SELECT COALESCE(SUM(CAST(valor_total_cent AS INTEGER)), 0) AS total FROM compras_itens WHERE compra_id = ?').get(purchaseId).total;
    const numerator = cents(purchase.total_nota_cent) * cents(item.valor_total_cent) * quantityMili;
    const denominator = BigInt(totalItems || 1) * BigInt(item.qtd_comprada_mili || 1);
    const value = (numerator + denominator / 2n) / denominator;
    const nowValue = now();
    db.exec('BEGIN');
    try {
      if (destination === 'PARCELA') {
        const payment = db.prepare("SELECT * FROM compras_pagamentos WHERE compra_id = ? AND pagamento_id = ? AND pago = 'NÃO'").get(purchaseId, String(data.pagamentoId || ''));
        if (!payment || cents(payment.valor_cent) < value) throw new PurchaseValidationError('Escolha uma parcela pendente com valor suficiente.');
        db.prepare('UPDATE compras_pagamentos SET valor_cent = ? WHERE compra_id = ? AND pagamento_id = ?').run(String(cents(payment.valor_cent) - value), purchaseId, payment.pagamento_id);
      } else {
        db.prepare('INSERT INTO compras_creditos (id, fornecedor_id, origem_compra, total_cent, usado_cent, justificativa, data) VALUES (?, ?, ?, ?, \'0\', ?, ?)')
          .run(nextId(db, 'compras_creditos', 'CRE'), purchase.fornecedor_id, purchaseId, String(value), justification, nowValue);
      }
      db.prepare('UPDATE compras_itens SET qtd_cancelada_mili = ? WHERE compra_id = ? AND item_id = ?')
        .run(String(BigInt(item.qtd_cancelada_mili) + quantityMili), purchaseId, item.item_id);
      db.prepare('INSERT INTO compras_ajustes (id, compra_id, tipo, item_id, qtd_mili, valor_cent, parcela, justificativa, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nextId(db, 'compras_ajustes', 'AJU'), purchaseId, 'CANCELAMENTO DE SALDO', item.item_id, String(quantityMili), String(value), destination === 'PARCELA' ? String(data.pagamentoId || '') : '', justification, nowValue);
      const items = db.prepare('SELECT qtd_comprada_mili, qtd_recebida_mili, qtd_cancelada_mili FROM compras_itens WHERE compra_id = ?').all(purchaseId);
      const pending = items.some((row) => BigInt(row.qtd_comprada_mili) > BigInt(row.qtd_recebida_mili) + BigInt(row.qtd_cancelada_mili));
      const hasCancellation = items.some((row) => BigInt(row.qtd_cancelada_mili) > 0n);
      const status = pending ? (items.some((row) => BigInt(row.qtd_recebida_mili) > 0n) ? 'PARCIAL' : 'PENDENTE') : (hasCancellation ? 'CONCLUIDA_COM_CANCELAMENTO' : 'RECEBIDA');
      db.prepare('UPDATE compras SET situacao = ?, atualizado_em = ? WHERE id = ?').run(status, nowValue, purchaseId);
      db.exec('COMMIT');
      return { ok: true, status, valor: money(value) };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveDraft(id, data) {
    const payload = data || {};
    const serialized = JSON.stringify(payload);
    if (!serialized || serialized === '{}' || serialized === '{"itens":[]}' || serialized.length > 150000) {
      if (serialized.length > 150000) throw new PurchaseValidationError('Rascunho excede o tamanho permitido.');
      return { id: id || '', vazio: true };
    }
    const nowValue = now();
    let draftId = String(id || '');
    const current = draftId ? db.prepare('SELECT * FROM compras_rascunhos WHERE id = ?').get(draftId) : null;
    let version = 1;
    if (current) {
      if (current.situacao !== 'ATIVO') throw new PurchaseValidationError('Rascunho encerrado.');
      version = Number(current.versao || 0) + 1;
      db.prepare('UPDATE compras_rascunhos SET fornecedor_nome = ?, atualizado_em = ?, versao = ? WHERE id = ?')
        .run(text(payload.fornecedorNome, 160), nowValue, version, draftId);
      db.prepare('DELETE FROM compras_rascunho_partes WHERE rascunho_id = ?').run(draftId);
    } else {
      draftId = nextId(db, 'compras_rascunhos', 'RAS');
      db.prepare('INSERT INTO compras_rascunhos (id, situacao, fornecedor_nome, criado_em, atualizado_em, versao) VALUES (?, \'ATIVO\', ?, ?, ?, ?)')
        .run(draftId, text(payload.fornecedorNome, 160), nowValue, nowValue, version);
    }
    const insertPart = db.prepare('INSERT INTO compras_rascunho_partes (rascunho_id, versao, ordem, json_parcial) VALUES (?, ?, ?, ?)');
    const size = 35000;
    for (let offset = 0, order = 0; offset < serialized.length; offset += size, order += 1) insertPart.run(draftId, version, order, serialized.slice(offset, offset + size));
    return { id: draftId, versao: version };
  }

  function listDrafts() {
    return db.prepare("SELECT * FROM compras_rascunhos WHERE situacao = 'ATIVO' ORDER BY atualizado_em DESC").all()
      .map((row) => ({ id: row.id, fornecedor: row.fornecedor_nome || 'Não informado', data: row.atualizado_em }));
  }

  function openDraft(id) {
    const row = db.prepare("SELECT * FROM compras_rascunhos WHERE id = ? AND situacao = 'ATIVO'").get(id);
    if (!row) throw new PurchaseValidationError('Rascunho não localizado.');
    const json = db.prepare('SELECT json_parcial FROM compras_rascunho_partes WHERE rascunho_id = ? AND versao = ? ORDER BY ordem').all(id, row.versao).map((part) => part.json_parcial).join('');
    if (!json) throw new PurchaseValidationError('Partes do rascunho não localizadas.');
    return JSON.parse(json);
  }

  function discardDraft(id) {
    const result = db.prepare("UPDATE compras_rascunhos SET situacao = 'DESCARTADO', atualizado_em = ? WHERE id = ? AND situacao = 'ATIVO'").run(now(), id);
    if (!result.changes) throw new PurchaseValidationError('Rascunho indisponível.');
    return { ok: true };
  }

  return { initialData, verifySupplierCnpj, query, get, savePurchase, receive, cancelPending, saveDraft, listDrafts, openDraft, discardDraft };
}

module.exports = { PurchaseValidationError, createNormalizedPurchaseService };
