class StockValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockValidationError';
  }
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1n;
}

function fraction(numerator, denominator = 1n) {
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d === 0n) throw new StockValidationError('Denominador inválido.');
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}

function parseFraction(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return fraction(0n);
  if (/^-?\d+\/[1-9]\d*$/.test(raw)) {
    const [n, d] = raw.split('/');
    return fraction(BigInt(n), BigInt(d));
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new StockValidationError(`Fração inválida: ${raw}`);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, decimals = ''] = unsigned.split('.');
  const denominator = 10n ** BigInt(decimals.length);
  const numerator = BigInt(whole) * denominator + BigInt(decimals || '0');
  return fraction(negative ? -numerator : numerator, denominator);
}

function fractionText(value) {
  const normalized = fraction(value.n, value.d);
  return `${normalized.n}/${normalized.d}`;
}

function add(left, right) { return fraction(left.n * right.d + right.n * left.d, left.d * right.d); }
function subtract(left, right) { return fraction(left.n * right.d - right.n * left.d, left.d * right.d); }
function multiply(left, right) { return fraction(left.n * right.n, left.d * right.d); }
function compare(left, right) {
  const result = left.n * right.d - right.n * left.d;
  return result < 0n ? -1 : result > 0n ? 1 : 0;
}

function parseMilli(value, allowZero = true) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) {
    if (allowZero) return 0n;
    throw new StockValidationError('Informe uma quantidade.');
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new StockValidationError('Quantidade inválida; use até três casas decimais.');
  const [whole, decimals = ''] = raw.split('.');
  const result = BigInt(whole) * 1000n + BigInt((decimals + '000').slice(0, 3));
  if (!allowZero && result <= 0n) throw new StockValidationError('A quantidade deve ser maior que zero.');
  return result;
}

function parseCents(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new StockValidationError('Valor monetário inválido.');
  const [whole, decimals = ''] = raw.split('.');
  const cents = BigInt(whole) * 100n + BigInt((decimals + '00').slice(0, 2));
  if (cents <= 0n) throw new StockValidationError('O valor deve ser maior que zero.');
  return cents;
}

function decimalText(value, places = 6) {
  const normalized = fraction(value.n, value.d);
  const negative = normalized.n < 0n;
  const absolute = negative ? -normalized.n : normalized.n;
  const scale = 10n ** BigInt(places);
  const scaled = (absolute * scale + normalized.d / 2n) / normalized.d;
  const whole = scaled / scale;
  const decimals = String(scaled % scale).padStart(places, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${decimals ? `.${decimals}` : ''}`;
}

function quantityText(mili) {
  return decimalText(fraction(BigInt(mili || '0'), 1000n), 3);
}

function pdfEscape(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  const perPage = 48;
  const pages = [];
  for (let index = 0; index < lines.length; index += perPage) pages.push(lines.slice(index, index + perPage));
  if (!pages.length) pages.push([]);
  const pageStart = 3;
  const fontId = pageStart + pages.length;
  const contentStart = fontId + 1;
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageIds = pages.map((_, index) => `${pageStart + index} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${pageIds}] /Count ${pages.length} >>`;
  pages.forEach((page, index) => {
    const contentId = contentStart + index;
    objects[pageStart + index] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const commands = ['BT', '/F1 10 Tf', '45 760 Td', '14 TL', ...page.flatMap((line, lineIndex) => [lineIndex ? 'T*' : '', `(${pdfEscape(line)}) Tj`]).filter(Boolean), 'ET'].join('\n');
    objects[contentId] = { stream: commands };
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, 'binary');
    const object = objects[index];
    if (typeof object === 'string') pdf += `${index} 0 obj\n${object}\nendobj\n`;
    else {
      const length = Buffer.byteLength(object.stream, 'binary');
      pdf += `${index} 0 obj\n<< /Length ${length} >>\nstream\n${object.stream}\nendstream\nendobj\n`;
    }
  }
  const xref = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary').toString('base64');
}

function isoNow() { return new Date().toISOString(); }

function nextId(db, table, prefix) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`);
  let max = 0;
  for (const row of rows) {
    const match = String(row.id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

function publicInventory(row) {
  return row ? {
    id: row.id,
    tipo: row.tipo,
    status: row.status,
    inicio: row.iniciado_em || '',
    fim: row.encerrado_em || '',
    justificativa: row.justificativa || '',
    atualizadoEm: row.atualizado_em || ''
  } : null;
}

function createNormalizedStockService(db) {
  function getSaldo(insumoId) {
    const row = db.prepare('SELECT * FROM estoque_saldos WHERE insumo_id = ?').get(insumoId);
    return row || { insumo_id: insumoId, quantidade_mili: '0', valor_exato: '0/1', pendente_exato: '0/1', ultimo_custo_exato: '0/1' };
  }

  function listInventories() {
    return db.prepare('SELECT * FROM estoque_inventarios ORDER BY iniciado_em DESC, id DESC').all().map(publicInventory);
  }

  function openInventory(type) {
    const normalizedType = String(type || '').toUpperCase();
    if (normalizedType !== 'INVENTARIO') throw new StockValidationError('Apenas inventários periódicos estão disponíveis.');
    const active = db.prepare("SELECT * FROM estoque_inventarios WHERE status IN ('ABERTO', 'PROCESSANDO') ORDER BY iniciado_em DESC LIMIT 1").get();
    if (active) {
      if (active.status === 'PROCESSANDO') throw new StockValidationError('Há uma finalização interrompida.');
      return { id: active.id, tipo: active.tipo, reutilizado: true };
    }
    const now = isoNow();
    const id = nextId(db, 'estoque_inventarios', 'INV');
    db.prepare(`INSERT INTO estoque_inventarios (id, tipo, status, iniciado_em, atualizado_em) VALUES (?, ?, 'ABERTO', ?, ?)`)
      .run(id, normalizedType, now, now);
    return { id, tipo: normalizedType, reutilizado: false };
  }

  function status() {
    const active = db.prepare("SELECT * FROM estoque_inventarios WHERE status IN ('ABERTO', 'PROCESSANDO') ORDER BY iniciado_em DESC LIMIT 1").get();
    const rows = db.prepare(`
      SELECT i.id, i.descricao, i.unidade, i.controla_estoque,
        COALESCE(s.quantidade_mili, '0') AS quantidade_mili,
        COALESCE(s.valor_exato, '0/1') AS valor_exato,
        COALESCE(s.pendente_exato, '0/1') AS pendente_exato,
        CASE WHEN m.insumo_id IS NULL THEN 0 ELSE 1 END AS possui_movimento
      FROM insumos i
      LEFT JOIN estoque_saldos s ON s.insumo_id = i.id
      LEFT JOIN (SELECT DISTINCT insumo_id FROM estoque_movimentacoes) m ON m.insumo_id = i.id
      WHERE i.controla_estoque = 0 OR m.insumo_id IS NOT NULL
      ORDER BY i.descricao COLLATE NOCASE
    `).all().map((row) => {
      const controlled = Number(row.controla_estoque) === 1;
      const quantity = BigInt(row.quantidade_mili || '0');
      const value = parseFraction(row.valor_exato);
      const pending = parseFraction(row.pendente_exato);
      const unitCost = quantity > 0n ? multiply(value, fraction(1000n, quantity)) : parseFraction(row.ultimo_custo_exato || '0/1');
      return {
        id: row.id,
        nome: row.descricao,
        unidade: row.unidade,
        controlaEstoque: controlled ? 'SIM' : 'NÃO',
        quantidadeMili: String(quantity),
        quantidade: controlled ? quantityText(quantity) : '∞',
        quantidadeBase: controlled ? quantityText(quantity) : '',
        qMili: controlled ? String(quantity) : '',
        custo: controlled || unitCost.n !== 0n ? decimalText(unitCost, 6).replace('.', ',') : '—',
        valor: controlled ? `R$ ${decimalText(value, 2).replace('.', ',')}` : '',
        pendente: pending.n !== 0n ? `R$ ${decimalText(pending, 2).replace('.', ',')}` : '',
        valorExato: fractionText(value),
        possuiMovimento: Boolean(row.possui_movimento)
      };
    });
    return { inicialFinalizado: true, inventarioInicialNecessario: false, aberto: publicInventory(active), saldos: rows };
  }

  function inventoryData(id) {
    const inventory = db.prepare('SELECT * FROM estoque_inventarios WHERE id = ?').get(id);
    if (!inventory) throw new StockValidationError('Inventário não localizado.');
    const detailRows = db.prepare(`
      SELECT * FROM estoque_detalhes_contagem
      WHERE inventario_id = ? AND ativo = 'SIM'
      ORDER BY insumo_id, sequencia
    `).all(id);
    const detailsByItem = new Map();
    for (const row of detailRows) {
      const details = detailsByItem.get(row.insumo_id) || [];
      details.push({ seq: Number(row.sequencia), quantidade: quantityText(row.quantidade_mili), tamanho: quantityText(row.tamanho_mili), unidade: row.unidade });
      detailsByItem.set(row.insumo_id, details);
    }
    const counts = db.prepare(`
      SELECT c.*, i.descricao, i.unidade
      FROM estoque_contagens c
      JOIN insumos i ON i.id = c.insumo_id
      WHERE c.inventario_id = ?
      ORDER BY i.descricao COLLATE NOCASE
    `).all(id).map((row) => ({
      id: row.insumo_id,
      nome: row.descricao,
      unidade: row.unidade,
      estoqueMili: String(row.saldo_referencia_mili || '0'),
      estoque: quantityText(row.saldo_referencia_mili || '0'),
      contagem: row.quantidade_mili === '' ? '' : quantityText(row.quantidade_mili),
      dif: row.quantidade_mili === '' ? '' : quantityText(BigInt(row.quantidade_mili || '0') - BigInt(row.saldo_referencia_mili || '0')),
      gravado: row.gravado === 'SIM',
      compensar: row.compensar,
      tamanho: row.tam_embalagem,
      unidadeEmbalagem: row.unidade_embalagem,
      preco: row.preco_centavos,
      data: row.momento_contagem || '',
      detalhes: detailsByItem.get(row.insumo_id) || [],
      detalhesCount: (detailsByItem.get(row.insumo_id) || []).length
    }));
    return { ...publicInventory(inventory), itens: counts };
  }

  function saveCounts(inventoryId, changes) {
    if (!Array.isArray(changes) || changes.length > 500) throw new StockValidationError('Lote de contagens inválido.');
    const inventory = db.prepare("SELECT * FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    const upsert = db.prepare(`
      INSERT INTO estoque_contagens (
        inventario_id, insumo_id, quantidade_mili, tam_embalagem, unidade_embalagem, preco_centavos,
        saldo_referencia_mili, momento_contagem, compensar, gravado, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NÃO', ?)
      ON CONFLICT(inventario_id, insumo_id) DO UPDATE SET
        quantidade_mili = excluded.quantidade_mili,
        tam_embalagem = excluded.tam_embalagem,
        unidade_embalagem = excluded.unidade_embalagem,
        preco_centavos = excluded.preco_centavos,
        saldo_referencia_mili = excluded.saldo_referencia_mili,
        momento_contagem = excluded.momento_contagem,
        compensar = excluded.compensar,
        atualizado_em = excluded.atualizado_em
    `);
    const now = isoNow();
    for (const change of changes) {
      const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(String(change?.id || ''));
      if (!insumo) throw new StockValidationError('Insumo desconhecido na contagem.');
      const current = db.prepare('SELECT * FROM estoque_contagens WHERE inventario_id = ? AND insumo_id = ?').get(inventoryId, insumo.id);
      if (current?.gravado === 'SIM') throw new StockValidationError(`Contagem já gravada de ${insumo.descricao}. Reabra antes de corrigir.`);
      const quantity = change.contagem === '' || change.contagem === null || change.contagem === undefined ? '' : String(parseMilli(change.contagem, true));
      const reference = inventory.tipo === 'INICIAL' ? '0' : String(getSaldo(insumo.id).quantidade_mili);
      upsert.run(
        inventoryId,
        insumo.id,
        quantity,
        String(change.tamanho || change.tam_embalagem || ''),
        String(change.unidadeEmbalagem || change.unidade_embalagem || ''),
        String(change.preco || change.preco_centavos || ''),
        reference,
        change.momento || now,
        change.compensar === 'NÃO' ? 'NÃO' : 'SIM',
        now
      );
    }
    db.prepare('UPDATE estoque_inventarios SET atualizado_em = ? WHERE id = ?').run(now, inventoryId);
    return { ok: true, quantidade: changes.length };
  }

  function markCounts(inventoryId, ids) {
    const uniqueIds = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
    if (!uniqueIds.length) throw new StockValidationError('Preencha alguma contagem antes de gravar.');
    const inventory = db.prepare("SELECT 1 FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    const update = db.prepare("UPDATE estoque_contagens SET gravado = 'SIM', atualizado_em = ? WHERE inventario_id = ? AND insumo_id = ? AND quantidade_mili <> ''");
    const now = isoNow();
    for (const id of uniqueIds) update.run(now, inventoryId, id);
    const missing = uniqueIds.filter((id) => !db.prepare("SELECT 1 FROM estoque_contagens WHERE inventario_id = ? AND insumo_id = ? AND quantidade_mili <> ''").get(inventoryId, id));
    if (missing.length) throw new StockValidationError('A contagem de um insumo ainda está em branco.');
    return { ok: true, quantidade: uniqueIds.length };
  }

  function saveCountDetails(inventoryId, insumoId, lines, compensar, moment) {
    const inventory = db.prepare("SELECT * FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    if (inventory.tipo !== 'INVENTARIO') throw new StockValidationError('O detalhamento está disponível para inventários posteriores ao inicial.');
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo || Number(insumo.controla_estoque) !== 1) throw new StockValidationError('Este insumo não participa do inventário físico.');
    if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new StockValidationError('Informe entre 1 e 100 linhas de embalagens/avulsos.');
    const current = db.prepare('SELECT * FROM estoque_contagens WHERE inventario_id = ? AND insumo_id = ?').get(inventoryId, insumoId);
    if (current?.gravado === 'SIM') throw new StockValidationError('Reabra a contagem antes de modificar os detalhes.');
    const normalized = [];
    let total = 0n;
    for (const [index, line] of lines.entries()) {
      const quantity = parseMilli(line.quantidade, true);
      const size = parsePackSize(line.tamanho, line.unidade, insumo.unidade);
      if (quantity === 0n && lines.length > 1) throw new StockValidationError('Exclua linhas zeradas; utilize uma única linha zero.');
      total += quantity * size / 1000n;
      normalized.push({ sequencia: index + 1, quantidade: quantity, tamanho: parseMilli(line.tamanho, false), unidade: String(line.unidade || '').toUpperCase() });
    }
    const now = isoNow();
    const reference = String(getSaldo(insumoId).quantidade_mili || '0');
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE estoque_detalhes_contagem SET ativo = 'NÃO', sequencia = -sequencia WHERE inventario_id = ? AND insumo_id = ? AND ativo = 'SIM'").run(inventoryId, insumoId);
      db.prepare(`
        INSERT INTO estoque_contagens (inventario_id, insumo_id, quantidade_mili, saldo_referencia_mili, momento_contagem, compensar, gravado, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, 'NÃO', ?)
        ON CONFLICT(inventario_id, insumo_id) DO UPDATE SET quantidade_mili = excluded.quantidade_mili,
          saldo_referencia_mili = excluded.saldo_referencia_mili, momento_contagem = excluded.momento_contagem,
          compensar = excluded.compensar, gravado = 'NÃO', atualizado_em = excluded.atualizado_em
      `).run(inventoryId, insumoId, String(total), reference, moment || now, compensar === 'NÃO' ? 'NÃO' : 'SIM', now);
      const insert = db.prepare(`
        INSERT INTO estoque_detalhes_contagem (inventario_id, insumo_id, sequencia, quantidade_mili, tamanho_mili, unidade, ativo, registrado_em)
        VALUES (?, ?, ?, ?, ?, ?, 'SIM', ?)
      `);
      normalized.forEach((row) => insert.run(inventoryId, insumoId, row.sequencia, String(row.quantidade), String(row.tamanho), row.unidade, now));
      db.exec('COMMIT');
      return { ok: true, quantidade: quantityText(total), linhas: normalized.length };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function reopenCount(inventoryId, insumoId) {
    const inventory = db.prepare("SELECT 1 FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    const result = db.prepare("UPDATE estoque_contagens SET gravado = 'NÃO', atualizado_em = ? WHERE inventario_id = ? AND insumo_id = ?").run(isoNow(), inventoryId, insumoId);
    if (!result.changes) throw new StockValidationError('Contagem não localizada.');
    return { ok: true };
  }

  function correctBalance(input) {
    const insumoId = String(input?.id || '');
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo || Number(insumo.controla_estoque) !== 1) throw new StockValidationError('Selecione um insumo com controle físico ativo.');
    const justification = String(input?.justificativa || '').trim();
    if (justification.length < 8) throw new StockValidationError('Justificativa obrigatória com pelo menos 8 caracteres.');
    const balance = getSaldo(insumoId);
    if (String(input.saldoReferencialMili) !== String(balance.quantidade_mili)) throw new StockValidationError('O saldo foi alterado por outra movimentação. Atualize a consulta.');
    const nextQuantity = parseMilli(input.quantidade, true);
    const currentQuantity = BigInt(balance.quantidade_mili || '0');
    const delta = nextQuantity - currentQuantity;
    if (delta === 0n) throw new StockValidationError('O saldo informado é igual ao atual.');
    const beforeValue = parseFraction(balance.valor_exato);
    const beforePending = parseFraction(balance.pendente_exato);
    let value = beforeValue;
    let pending = beforePending;
    const compensate = input.compensar !== 'NÃO';
    if (delta > 0n) {
      if (!compensate) {
        const cost = currentQuantity > 0n ? multiply(value, fraction(1000n, currentQuantity)) : parseFraction(balance.ultimo_custo_exato);
        if (cost.n === 0n) throw new StockValidationError('Não há custo unitário para esta sobra não compensada.');
        value = add(value, multiply(cost, fraction(delta, 1000n)));
      }
    } else if (compensate) {
      if (nextQuantity === 0n) { pending = add(pending, value); value = fraction(0n); }
    } else {
      value = subtract(value, multiply(value, fraction(-delta, currentQuantity || 1n)));
    }
    const now = isoNow();
    const operationId = nextId(db, 'estoque_operacoes', 'MOV');
    const movementId = nextId(db, 'estoque_movimentacoes', 'DET');
    const lastCost = nextQuantity > 0n && value.n !== 0n ? multiply(value, fraction(1000n, nextQuantity)) : parseFraction(balance.ultimo_custo_exato);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO estoque_operacoes (id, data, movimento, tipo, referencia, valor_impacto_exato, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(operationId, now, delta > 0n ? 'ENTRADA' : 'SAÍDA', 'AJUSTE DE SALDO', 'AJUSTE MANUAL', fractionText(subtract(value, beforeValue)), justification);
      db.prepare(`
        INSERT INTO estoque_movimentacoes (id, operacao_id, data, insumo_id, quantidade_mili, valor_antes_exato, valor_depois_exato, pendente_antes_exato, pendente_depois_exato, descricao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(movementId, operationId, now, insumoId, String(delta), fractionText(beforeValue), fractionText(value), fractionText(beforePending), fractionText(pending), 'CORREÇÃO MANUAL');
      db.prepare(`
        INSERT INTO estoque_saldos (insumo_id, quantidade_mili, valor_exato, pendente_exato, ultimo_custo_exato, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(insumo_id) DO UPDATE SET quantidade_mili = excluded.quantidade_mili, valor_exato = excluded.valor_exato,
          pendente_exato = excluded.pendente_exato, ultimo_custo_exato = excluded.ultimo_custo_exato, atualizado_em = excluded.atualizado_em
      `).run(insumoId, String(nextQuantity), fractionText(value), fractionText(pending), fractionText(lastCost), now);
      db.exec('COMMIT');
      return { ok: true, anterior: quantityText(currentQuantity), novo: quantityText(nextQuantity) };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function listMovements() {
    return db.prepare('SELECT * FROM estoque_operacoes ORDER BY data DESC, id DESC').all().map((row) => ({
      id: row.id,
      data: row.data,
      movimento: row.movimento,
      tipo: row.tipo,
      referencia: row.referencia,
      valor: `R$ ${decimalText(parseFraction(row.valor_impacto_exato), 2).replace('.', ',')}`,
      aviso: ''
    }));
  }

  function movementDetails(operationId) {
    const operation = db.prepare('SELECT * FROM estoque_operacoes WHERE id = ?').get(operationId);
    if (!operation) throw new StockValidationError('Movimentação não encontrada.');
    const items = db.prepare(`
      SELECT m.*, i.descricao, i.unidade
      FROM estoque_movimentacoes m
      LEFT JOIN insumos i ON i.id = m.insumo_id
      WHERE m.operacao_id = ?
      ORDER BY m.id
    `).all(operationId).map((row) => ({
      nome: row.descricao || row.insumo_id,
      quantidade: quantityText(row.quantidade_mili),
      impacto: `R$ ${decimalText(subtract(parseFraction(row.valor_depois_exato), parseFraction(row.valor_antes_exato)), 2).replace('.', ',')}`,
      custoPendente: `R$ ${decimalText(subtract(parseFraction(row.pendente_depois_exato), parseFraction(row.pendente_antes_exato)), 2).replace('.', ',')}`,
      observacao: row.descricao || ''
    }));
    return {
      data: operation.data,
      movimento: operation.movimento,
      tipo: operation.tipo,
      referencia: operation.referencia,
      valor: `R$ ${decimalText(parseFraction(operation.valor_impacto_exato), 2).replace('.', ',')}`,
      itens: items
    };
  }

  function validateExitDraft(data) {
    const direction = String(data?.direcao || '').toUpperCase().replace('Í', 'I');
    if (direction !== 'SAIDA') throw new StockValidationError('Rascunho de saída inválido.');
    const items = Array.isArray(data.itens) ? data.itens : [];
    if (items.length > 60) throw new StockValidationError('Rascunho limitado a 60 itens.');
    const normalized = items.map((item) => {
      const id = String(item?.id || '');
      if (id) {
        const insumo = db.prepare('SELECT id, controla_estoque FROM insumos WHERE id = ?').get(id);
        if (!insumo || Number(insumo.controla_estoque) !== 1) throw new StockValidationError('Insumo inválido no rascunho de saída.');
      }
      return { id, quantidade: String(item?.quantidade || '').slice(0, 24), tamanho: String(item?.tamanho || '1'), unidade: String(item?.unidade || '').toUpperCase().slice(0, 5) };
    });
    return {
      direcao: 'SAÍDA',
      itens: normalized,
      motivo: String(data.motivo || 'PRODUÇÃO MANUAL').slice(0, 60),
      referencia: String(data.referencia || '').slice(0, 200),
      justificativa: String(data.justificativa || '').slice(0, 1000)
    };
  }

  function saveExitDraft(id, data) {
    const normalized = validateExitDraft(data);
    const now = isoNow();
    let draftId = String(id || '');
    if (draftId) {
      const current = db.prepare("SELECT * FROM estoque_rascunhos_saida WHERE id = ? AND status = 'ABERTO'").get(draftId);
      if (!current) throw new StockValidationError('Rascunho não encontrado ou indisponível.');
      db.prepare('UPDATE estoque_rascunhos_saida SET json_rascunho = ?, atualizado_em = ? WHERE id = ?').run(JSON.stringify(normalized), now, draftId);
    } else {
      draftId = nextId(db, 'estoque_rascunhos_saida', 'RSM');
      db.prepare('INSERT INTO estoque_rascunhos_saida (id, status, json_rascunho, criado_em, atualizado_em) VALUES (?, \'ABERTO\', ?, ?, ?)').run(draftId, JSON.stringify(normalized), now, now);
    }
    return { id: draftId };
  }

  function listExitDrafts() {
    return db.prepare("SELECT * FROM estoque_rascunhos_saida WHERE status = 'ABERTO' ORDER BY atualizado_em DESC").all().map((row) => {
      let data = {};
      try { data = JSON.parse(row.json_rascunho); } catch {}
      return { id: row.id, referencia: data.referencia || 'SEM REFERÊNCIA', itens: Array.isArray(data.itens) ? data.itens.length : 0, data: row.atualizado_em };
    });
  }

  function openExitDraft(id) {
    const row = db.prepare("SELECT * FROM estoque_rascunhos_saida WHERE id = ? AND status = 'ABERTO'").get(id);
    if (!row) throw new StockValidationError('Rascunho não encontrado ou já encerrado.');
    return { id: row.id, dados: JSON.parse(row.json_rascunho) };
  }

  function discardExitDraft(id) {
    const result = db.prepare("UPDATE estoque_rascunhos_saida SET status = 'DESCARTADO', atualizado_em = ? WHERE id = ? AND status = 'ABERTO'").run(isoNow(), id);
    if (!result.changes) throw new StockValidationError('Rascunho não encontrado ou já encerrado.');
    return { ok: true };
  }

  function checkManualExit(items) {
    if (!Array.isArray(items) || !items.length || items.length > 60) throw new StockValidationError('Informe de 1 a 60 insumos para conferir.');
    return items.map((item) => {
      const insumo = db.prepare('SELECT id, descricao, unidade FROM insumos WHERE id = ?').get(String(item?.id || ''));
      if (!insumo) throw new StockValidationError('Insumo não encontrado.');
      const balance = getSaldo(insumo.id);
      const quantity = parseMilli(item.quantidade, false) * parsePackSize(item.tamanho || '1', item.unidade || insumo.unidade, insumo.unidade) / 1000n;
      return { id: insumo.id, nome: insumo.descricao, unidade: insumo.unidade, quantidade: quantityText(quantity), disponivel: quantityText(balance.quantidade_mili), suficiente: quantity <= BigInt(balance.quantidade_mili || '0') };
    });
  }

  function referenceCost(insumoId) {
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo) throw new StockValidationError('Insumo não cadastrado.');
    const balance = getSaldo(insumo.id);
    const reference = db.prepare('SELECT * FROM estoque_custos_referencia WHERE insumo_id = ?').get(insumo.id);
    const hasPhysicalStock = Number(insumo.controla_estoque) === 1;
    const cost = hasPhysicalStock && BigInt(balance.quantidade_mili || '0') > 0n
      ? multiply(parseFraction(balance.valor_exato), fraction(1000n, BigInt(balance.quantidade_mili)))
      : parseFraction(balance.ultimo_custo_exato);
    if (!hasPhysicalStock && reference && reference.unidade === insumo.unidade) {
      return { id: insumo.id, unidade: insumo.unidade, metodo: 'ÚLTIMA AQUISIÇÃO', custoExato: reference.custo_exato, custoExibido: decimalText(parseFraction(reference.custo_exato)) };
    }
    if (cost.n !== 0n) {
      return { id: insumo.id, unidade: insumo.unidade, metodo: hasPhysicalStock ? 'MÉDIA PONDERADA' : 'REFERÊNCIA HISTÓRICA', custoExato: fractionText(cost), custoExibido: decimalText(cost) };
    }
    return { id: insumo.id, unidade: insumo.unidade, metodo: 'AGUARDANDO NOVA AQUISIÇÃO', custoExato: '', custoExibido: '—' };
  }

  function movementData(type) {
    const direction = String(type || '').toUpperCase().replace('Í', 'I');
    const isEntry = direction === 'ENTRADA';
    const rows = db.prepare('SELECT id, descricao, unidade, controla_estoque FROM insumos ORDER BY descricao COLLATE NOCASE').all()
      .filter((row) => isEntry || Number(row.controla_estoque) === 1)
      .map((row) => ({
        id: row.id,
        nome: row.descricao,
        unidade: row.unidade,
        controla: Number(row.controla_estoque) === 1 ? 'SIM' : 'NÃO',
        unidades: { G: ['G', 'KG'], ML: ['ML', 'L'], UN: ['UN'], CM: ['CM', 'M'], KWH: ['KWH'] }[row.unidade] || []
      }));
    return { tipo: type || '', entradasDisponiveis: isEntry, inicialFinalizado: true, inventarioInicialNecessario: false, insumos: rows };
  }

  function registerManualMovement(input) {
    if (!input) throw new StockValidationError('Dados ausentes.');
    const direction = String(input.direcao || '').toUpperCase().replace('Í', 'I');
    if (!['ENTRADA', 'SAIDA'].includes(direction)) throw new StockValidationError('Tipo de movimentação inválido.');
    const justification = String(input.justificativa || '').trim();
    if (justification.length < 8) throw new StockValidationError('Informe uma justificativa com pelo menos 8 caracteres.');
    const items = Array.isArray(input.itens) ? input.itens : [];
    if (!items.length || items.length > 60) throw new StockValidationError('Informe de 1 a 60 itens na movimentação.');
    const calculated = [];
    for (const [index, item] of items.entries()) {
      const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(String(item?.id || ''));
      if (!insumo) throw new StockValidationError(`Insumo não encontrado na linha ${index + 1}.`);
      const quantity = parseMilli(item.quantidade, false);
      const packageSize = parsePackSize(item.tamanho || '1', item.unidade || insumo.unidade, insumo.unidade);
      const baseQuantity = quantity * packageSize / 1000n;
      const balance = getSaldo(insumo.id);
      const beforeQuantity = BigInt(balance.quantidade_mili || '0');
      const beforeValue = parseFraction(balance.valor_exato);
      const beforePending = parseFraction(balance.pendente_exato);
      if (direction === 'SAIDA') {
        if (Number(insumo.controla_estoque) !== 1) throw new StockValidationError(`Insumo sem controle físico não pode ter saída: ${insumo.descricao}.`);
        if (baseQuantity > beforeQuantity) throw new StockValidationError(`Saldo insuficiente para ${insumo.descricao}.`);
        const cost = beforeQuantity > 0n ? multiply(beforeValue, fraction(baseQuantity, beforeQuantity)) : fraction(0n);
        calculated.push({ insumo, delta: -baseQuantity, beforeQuantity, quantity: beforeQuantity - baseQuantity, beforeValue, value: subtract(beforeValue, cost), beforePending, pending: beforePending, description: `SAÍDA MANUAL · ${insumo.descricao}` });
        continue;
      }

      const price = fraction(parseCents(item.precoUnitario), 100n);
      const totalValue = multiply(price, fraction(quantity, 1000n));
      const unitCost = baseQuantity > 0n ? multiply(totalValue, fraction(1000n, baseQuantity)) : fraction(0n);
      if (Number(insumo.controla_estoque) !== 1) {
        calculated.push({ insumo, delta: 0n, beforeQuantity, quantity: beforeQuantity, beforeValue, value: beforeValue, beforePending, pending: beforePending, referenceCost: unitCost, description: `REFERÊNCIA DE CUSTO · ${insumo.descricao}` });
      } else {
        calculated.push({ insumo, delta: baseQuantity, beforeQuantity, quantity: beforeQuantity + baseQuantity, beforeValue, value: add(beforeValue, totalValue), beforePending, pending: fraction(0n), description: `ENTRADA MANUAL · ${insumo.descricao}` });
      }
    }

    const now = isoNow();
    db.exec('BEGIN');
    try {
      const operationId = nextId(db, 'estoque_operacoes', 'MOV');
      const impact = calculated.reduce((total, row) => add(total, subtract(row.value, row.beforeValue)), fraction(0n));
      const movementType = direction === 'ENTRADA' ? 'AQUISIÇÃO MANUAL' : String(input.motivo || 'OUTROS').toUpperCase();
      if (direction === 'SAIDA' && !['PRODUÇÃO MANUAL', 'PERDA', 'DEVOLUÇÃO', 'OUTROS'].includes(movementType)) throw new StockValidationError('Motivo de saída inválido.');
      const reference = String(input.referencia || 'ESTOQUE MANUAL');
      db.prepare('INSERT INTO estoque_operacoes (id, data, movimento, tipo, referencia, valor_impacto_exato, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(operationId, now, direction === 'SAIDA' ? 'SAÍDA' : 'ENTRADA', movementType, reference, fractionText(impact), justification);
      const insertMovement = db.prepare(`
        INSERT INTO estoque_movimentacoes (
          id, operacao_id, data, insumo_id, quantidade_mili, valor_antes_exato, valor_depois_exato,
          pendente_antes_exato, pendente_depois_exato, descricao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBalance = db.prepare(`
        INSERT INTO estoque_saldos (insumo_id, quantidade_mili, valor_exato, pendente_exato, ultimo_custo_exato, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(insumo_id) DO UPDATE SET quantidade_mili = excluded.quantidade_mili, valor_exato = excluded.valor_exato,
          pendente_exato = excluded.pendente_exato, ultimo_custo_exato = excluded.ultimo_custo_exato, atualizado_em = excluded.atualizado_em
      `);
      const upsertReference = db.prepare(`
        INSERT INTO estoque_custos_referencia (insumo_id, unidade, custo_exato, atualizado_em, origem, referencia)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(insumo_id) DO UPDATE SET unidade = excluded.unidade, custo_exato = excluded.custo_exato,
          atualizado_em = excluded.atualizado_em, origem = excluded.origem, referencia = excluded.referencia
      `);
      for (const row of calculated) {
        const movementId = nextId(db, 'estoque_movimentacoes', 'DET');
        insertMovement.run(movementId, operationId, now, row.insumo.id, String(row.delta), fractionText(row.beforeValue), fractionText(row.value), fractionText(row.beforePending), fractionText(row.pending), row.description);
        const lastCost = row.quantity > 0n && row.value.n !== 0n ? multiply(row.value, fraction(1000n, row.quantity)) : parseFraction(getSaldo(row.insumo.id).ultimo_custo_exato);
        upsertBalance.run(row.insumo.id, String(row.quantity), fractionText(row.value), fractionText(row.pending), fractionText(lastCost), now);
        if (row.referenceCost) upsertReference.run(row.insumo.id, row.insumo.unidade, fractionText(row.referenceCost), now, 'ENTRADA MANUAL', reference);
      }
      db.exec('COMMIT');
      return { ok: true, tipo: movementType, quantidade: items.length };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function requiredItems(inventory) {
    const all = db.prepare('SELECT * FROM insumos ORDER BY descricao COLLATE NOCASE').all();
    if (inventory.tipo === 'INICIAL') return all;
    const moved = new Set(db.prepare('SELECT DISTINCT insumo_id FROM estoque_movimentacoes').all().map((row) => row.insumo_id));
    return all.filter((row) => Number(row.controla_estoque) === 1 && moved.has(row.id));
  }

  function parsePackSize(value, unit, baseUnit) {
    const normalizedUnit = String(unit || '').toUpperCase();
    const allowed = {
      G: ['G', 'KG'], ML: ['ML', 'L'], UN: ['UN'], CM: ['CM', 'M'], KWH: ['KWH']
    }[baseUnit] || [];
    if (!allowed.includes(normalizedUnit)) throw new StockValidationError(`Unidade da embalagem incompatível com ${baseUnit}.`);
    const quantity = parseMilli(value, false);
    return quantity * (normalizedUnit === 'KG' || normalizedUnit === 'L' ? 1000n : normalizedUnit === 'M' ? 100n : 1n);
  }

  function calculateFinalization(inventoryId) {
    const inventory = db.prepare("SELECT * FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    const items = requiredItems(inventory);
    if (!items.length) throw new StockValidationError('Não existem insumos para inventariar.');
    const counts = new Map(db.prepare('SELECT * FROM estoque_contagens WHERE inventario_id = ?').all(inventoryId).map((row) => [row.insumo_id, row]));
    if (inventory.tipo === 'INICIAL' && counts.size === 0) throw new StockValidationError('Registre ao menos uma contagem antes de finalizar.');
    if (inventory.tipo === 'INVENTARIO') {
      const missing = items.filter((item) => !counts.get(item.id) || counts.get(item.id).quantidade_mili === '' || counts.get(item.id).gravado !== 'SIM');
      if (missing.length) throw new StockValidationError(`Existem ${missing.length} insumos sem contagem gravada.`);
    }

    const calculated = [];
    let more = 0;
    let less = 0;
    let same = 0;
    let initialValue = fraction(0n);
    for (const item of items) {
      const count = counts.get(item.id);
      const balance = getSaldo(item.id);
      const beforeQuantity = BigInt(balance.quantidade_mili || '0');
      const beforeValue = parseFraction(balance.valor_exato);
      const beforePending = parseFraction(balance.pendente_exato);
      const reference = inventory.tipo === 'INICIAL' ? 0n : BigInt(count?.saldo_referencia_mili || beforeQuantity);
      const counted = count && count.quantidade_mili !== '' ? BigInt(count.quantidade_mili) : 0n;
      const delta = inventory.tipo === 'INICIAL' ? counted : counted - reference;
      if (delta > 0n) more += 1;
      else if (delta < 0n) less += 1;
      else same += 1;

      let quantity = beforeQuantity;
      let value = beforeValue;
      let pending = beforePending;
      let lastCost = parseFraction(balance.ultimo_custo_exato);
      if (quantity + delta < 0n) throw new StockValidationError(`O ajuste tornaria negativo o saldo de ${item.descricao}.`);

      if (inventory.tipo === 'INICIAL') {
        quantity = counted;
        value = fraction(0n);
        pending = fraction(0n);
        if (counted > 0n) {
          if (!count?.tam_embalagem || !count?.preco_centavos) throw new StockValidationError(`Informe embalagem e preço para ${item.descricao}.`);
          const pack = parsePackSize(count.tam_embalagem, count.unidade_embalagem, item.unidade);
          const price = fraction(BigInt(count.preco_centavos), 100n);
          value = multiply(price, fraction(counted, pack));
          initialValue = add(initialValue, value);
          lastCost = multiply(value, fraction(1000n, quantity));
        }
      } else if (delta > 0n) {
        if (count?.compensar === 'NÃO') {
          const cost = quantity > 0n ? multiply(value, fraction(1000n, quantity)) : lastCost;
          if (cost.n === 0n) throw new StockValidationError(`Falta custo de referência para ${item.descricao}.`);
          value = add(value, multiply(cost, fraction(delta, 1000n)));
        }
        quantity += delta;
      } else if (delta < 0n) {
        if (count?.compensar !== 'NÃO') {
          quantity += delta;
          if (quantity === 0n) { pending = add(pending, value); value = fraction(0n); }
        } else {
          const portion = quantity > 0n ? multiply(value, fraction(-delta, quantity)) : fraction(0n);
          value = subtract(value, portion);
          quantity += delta;
        }
      }
      if (quantity > 0n && value.n !== 0n) lastCost = multiply(value, fraction(1000n, quantity));
      calculated.push({ item, count, beforeQuantity, beforeValue, beforePending, quantity, value, pending, lastCost, delta });
    }
    return { inventory, calculated, more, less, same, initialValue };
  }

  function previewFinalization(inventoryId) {
    const result = calculateFinalization(inventoryId);
    return {
      id: result.inventory.id,
      tipo: result.inventory.tipo,
      total: result.calculated.length,
      mais: result.more,
      menos: result.less,
      sem: result.same,
      valorInicial: result.inventory.tipo === 'INICIAL' ? fractionText(result.initialValue) : ''
    };
  }

  function finalizeInventory(inventoryId) {
    const result = calculateFinalization(inventoryId);
    const now = isoNow();
    const operations = { ENTRADA: [], SAÍDA: [] };
    for (const entry of result.calculated) {
      if (entry.delta > 0n) operations.ENTRADA.push(entry);
      if (entry.delta < 0n) operations.SAÍDA.push(entry);
    }
    db.exec('BEGIN');
    try {
      const insertOperation = db.prepare('INSERT INTO estoque_operacoes (id, data, movimento, tipo, referencia, valor_impacto_exato, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insertMovement = db.prepare(`
        INSERT INTO estoque_movimentacoes (
          id, operacao_id, data, insumo_id, quantidade_mili, valor_antes_exato, valor_depois_exato,
          pendente_antes_exato, pendente_depois_exato, descricao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertBalance = db.prepare(`
        INSERT INTO estoque_saldos (insumo_id, quantidade_mili, valor_exato, pendente_exato, ultimo_custo_exato, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(insumo_id) DO UPDATE SET
          quantidade_mili = excluded.quantidade_mili,
          valor_exato = excluded.valor_exato,
          pendente_exato = excluded.pendente_exato,
          ultimo_custo_exato = excluded.ultimo_custo_exato,
          atualizado_em = excluded.atualizado_em
      `);
      const insertPhoto = db.prepare(`
        INSERT INTO estoque_inventario_final (
          inventario_id, insumo_id, descricao, unidade, referencia_mili, contagem_mili,
          diferenca_mili, compensar, tam_embalagem, un_embalagem, preco_centavos,
          valor_antes_exato, valor_depois_exato
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const direction of ['ENTRADA', 'SAÍDA']) {
        const entries = operations[direction];
        if (!entries.length) continue;
        const operationId = nextId(db, 'estoque_operacoes', 'MOV');
        const impact = entries.reduce((total, entry) => add(total, subtract(entry.value, entry.beforeValue)), fraction(0n));
        insertOperation.run(operationId, now, direction, result.inventory.tipo === 'INICIAL' ? 'INVENTÁRIO INICIAL' : 'AJUSTE DE INVENTÁRIO', result.inventory.id, fractionText(impact), 'Contagem finalizada na camada normalizada.');
        entries.forEach((entry) => {
          const movementId = nextId(db, 'estoque_movimentacoes', 'DET');
          insertMovement.run(movementId, operationId, now, entry.item.id, String(entry.delta), fractionText(entry.beforeValue), fractionText(entry.value), fractionText(entry.beforePending), fractionText(entry.pending), entry.item.descricao);
        });
      }
      for (const entry of result.calculated) {
        upsertBalance.run(entry.item.id, String(entry.quantity), fractionText(entry.value), fractionText(entry.pending), fractionText(entry.lastCost), now);
        insertPhoto.run(result.inventory.id, entry.item.id, entry.item.descricao, entry.item.unidade, String(entry.inventory?.reference || entry.beforeQuantity), String(entry.quantity), String(entry.delta), entry.count?.compensar || 'SIM', entry.count?.tam_embalagem || '', entry.count?.unidade_embalagem || '', entry.count?.preco_centavos || '', fractionText(entry.beforeValue), fractionText(entry.value));
      }
      db.prepare("UPDATE estoque_inventarios SET status = 'FINALIZADO', encerrado_em = ?, atualizado_em = ? WHERE id = ?").run(now, now, result.inventory.id);
      db.exec('COMMIT');
      return { ok: true, id: result.inventory.id, movimentos: operations.ENTRADA.length + operations.SAÍDA.length };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function cancelInventory(inventoryId, justification) {
    const just = String(justification || '').trim();
    if (just.length < 8) throw new StockValidationError('Justificativa obrigatória (mínimo de 8 caracteres).');
    const inventory = db.prepare("SELECT 1 FROM estoque_inventarios WHERE id = ? AND status = 'ABERTO'").get(inventoryId);
    if (!inventory) throw new StockValidationError('Este inventário não está aberto para edição.');
    const now = isoNow();
    db.prepare("UPDATE estoque_inventarios SET status = 'CANCELADO', encerrado_em = ?, justificativa = ?, atualizado_em = ? WHERE id = ?").run(now, just, now, inventoryId);
    return { ok: true };
  }

  function pdfInventory(inventoryId) {
    const inventory = db.prepare('SELECT * FROM estoque_inventarios WHERE id = ?').get(inventoryId);
    if (!inventory || !['FINALIZADO', 'CANCELADO'].includes(inventory.status)) throw new StockValidationError('Somente inventários encerrados permitem relatório PDF.');
    const data = inventoryData(inventoryId);
    const lines = [
      'CASA SAO MIGUEL - INVENTARIO',
      `Registro: ${inventory.id} | Tipo: ${inventory.tipo} | Situacao: ${inventory.status}`,
      `Inicio: ${inventory.iniciado_em || ''} | Encerrado: ${inventory.encerrado_em || ''}`,
      inventory.justificativa ? `Justificativa: ${inventory.justificativa}` : '',
      '',
      'INSUMO | UNIDADE | ESTOQUE | CONTAGEM | DIFERENCA'
    ];
    data.itens.forEach((item) => lines.push(`${item.nome} | ${item.unidade} | ${item.estoque || '-'} | ${item.contagem || '-'} | ${item.dif || '-'}`));
    return { nome: `CasaSaoMiguel_Inventario_${inventoryId}.pdf`, base64: buildSimplePdf(lines.filter(Boolean)) };
  }

  return {
    status,
    listInventories,
    openInventory,
    inventoryData,
    saveCounts,
    markCounts,
    reopenCount,
    listMovements,
    referenceCost,
    movementData,
    registerManualMovement,
    movementDetails,
    saveCountDetails,
    correctBalance,
    saveExitDraft,
    listExitDrafts,
    openExitDraft,
    discardExitDraft,
    checkManualExit,
    previewFinalization,
    finalizeInventory,
    cancelInventory,
    pdfInventory
  };
}

module.exports = {
  StockValidationError,
  createNormalizedStockService,
  parseFraction,
  fractionText,
  parseMilli,
  fraction,
  add,
  subtract,
  multiply,
  quantityText
};
