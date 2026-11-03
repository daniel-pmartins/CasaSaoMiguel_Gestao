const { parseFraction, fraction, fractionText, add, multiply, subtract } = require('./normalized-stock');

class FichaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FichaValidationError';
  }
}

function text(value, limit = 10000) { return String(value ?? '').trim().slice(0, limit); }
function now() { return new Date().toISOString(); }

function divide(left, right) { return fraction(left.n * right.d, left.d * right.n); }
function compare(left, right) {
  const value = left.n * right.d - right.n * left.d;
  return value < 0n ? -1 : value > 0n ? 1 : 0;
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

function decimalCeilText(value, places = 2) {
  const normalized = fraction(value.n, value.d);
  const negative = normalized.n < 0n;
  const absolute = negative ? -normalized.n : normalized.n;
  const scale = 10n ** BigInt(places);
  const scaled = negative
    ? (absolute * scale) / normalized.d
    : (absolute * scale + normalized.d - 1n) / normalized.d;
  const whole = scaled / scale;
  const decimals = String(scaled % scale).padStart(places, '0');
  return `${negative ? '-' : ''}${whole}.${decimals}`;
}

function moneyText(value) {
  return `R$ ${decimalCeilText(value, 2).replace('.', ',')}`;
}

const FT_PREPARO_CATEGORY = 'FT DE PREPARO';
const SALE_UNITS = ['KG', 'G', 'L', 'ML', 'UN'];
const COMPOSITION_MODEL = 'VINCULO_V1';

function unitScale(unit) {
  return { G: 1, KG: 1000, ML: 1, L: 1000, UN: 1 }[String(unit || '').toUpperCase()] || 0;
}

function quantityInUnit(value, fromUnit, toUnit) {
  const from = String(fromUnit || '').toUpperCase();
  const to = String(toUnit || '').toUpperCase();
  const fromScale = unitScale(from);
  const toScale = unitScale(to);
  if (!fromScale || !toScale || ((from === 'G' || from === 'KG') !== (to === 'G' || to === 'KG')) || ((from === 'ML' || from === 'L') !== (to === 'ML' || to === 'L')) || (from === 'UN' || to === 'UN') && from !== to) {
    throw new FichaValidationError(`Unidade de venda incompatível com o rendimento: ${from} → ${to}.`);
  }
  return multiply(parseFraction(value), fraction(BigInt(fromScale), BigInt(toScale)));
}

function normalizeStoredRecipe(recipe) {
  const data = recipe || {};
  if (data.modeloComposicao === COMPOSITION_MODEL) return data;
  const componentes = (Array.isArray(data.componentes) ? data.componentes : []).map((component) => {
    const { quantidades, ...rest } = component || {};
    return { ...rest, quantidade: String(component?.quantidade ?? quantidades?.BASE ?? ''), vinculo: 'COMUM' };
  });
  const variacoes = (Array.isArray(data.variacoes) ? data.variacoes : []).map((variation) => {
    const { modo, ...rest } = variation || {};
    return rest;
  });
  return { ...data, modeloComposicao: COMPOSITION_MODEL, componentes, variacoes };
}

function nextId(db) {
  const rows = db.prepare("SELECT ft_id FROM ft_cadastros WHERE ft_id LIKE 'FT%'").all();
  let max = 0;
  for (const row of rows) {
    const match = String(row.ft_id).match(/^FT(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `FT${String(max + 1).padStart(6, '0')}`;
}

function nextOperationalId(db, table, prefix) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`);
  let max = 0;
  for (const row of rows) {
    const match = String(row.id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

function publicRow(row) {
  return row ? {
    id: row.ft_id,
    nome: row.nome,
    categoria: row.categoria,
    status: row.status,
    versao: Number(row.versao_atual || 0),
    atualizado: row.atualizado_em || '',
    observacoes: row.observacoes || ''
  } : null;
}

function createNormalizedFichaService(db) {
  function ensureFixedCategory() {
    db.prepare('INSERT OR IGNORE INTO ft_categorias (nome, criado_em) VALUES (?, ?)').run(FT_PREPARO_CATEGORY, now());
  }

  ensureFixedCategory();

  function migrateStoredRecipes() {
    const rows = db.prepare('SELECT ft_id, versao, receita_json FROM ft_versoes').all();
    const update = db.prepare('UPDATE ft_versoes SET receita_json = ? WHERE ft_id = ? AND versao = ?');
    for (const row of rows) {
      let recipe;
      try { recipe = JSON.parse(row.receita_json); } catch { continue; }
      const normalized = normalizeStoredRecipe(recipe);
      if (JSON.stringify(recipe) !== JSON.stringify(normalized)) update.run(JSON.stringify(normalized), row.ft_id, row.versao);
    }
  }

  migrateStoredRecipes();

  function list() {
    return db.prepare("SELECT * FROM ft_cadastros WHERE excluido = 0 ORDER BY nome COLLATE NOCASE").all().map(publicRow);
  }

  function snapshot(id, version) {
    const row = db.prepare('SELECT * FROM ft_versoes WHERE ft_id = ? AND versao = ?').get(id, version);
    if (!row) return null;
    let recipe;
    try { recipe = normalizeStoredRecipe(JSON.parse(row.receita_json)); } catch { throw new FichaValidationError(`Versão corrompida: ${id}`); }
    return { versao: Number(row.versao), data: row.data || '', receita: recipe, motivo: row.motivo || '' };
  }

  function get(id, version) {
    const row = db.prepare('SELECT * FROM ft_cadastros WHERE ft_id = ? AND excluido = 0').get(String(id || ''));
    if (!row) throw new FichaValidationError('FT não localizada.');
    const selectedVersion = Number(version || row.versao_atual);
    const snap = snapshot(row.ft_id, selectedVersion);
    const result = { id: row.ft_id, status: row.status, categoria: row.categoria, atualizado: row.atualizado_em || '', observacoes: row.observacoes || '', ...(snap || { versao: 0, receita: null }) };
    if (result.receita) {
      result.receita.nome = row.nome;
      result.receita.categoria = row.categoria;
      result.receita.base = { ...(result.receita.base || {}), unidadeVenda: result.receita.base?.unidadeVenda || result.receita.base?.unidade || '' };
      result.receita.observacoes = row.observacoes || '';
    }
    return result;
  }

  function categories() {
    ensureFixedCategory();
    return db.prepare('SELECT nome FROM ft_categorias ORDER BY nome COLLATE NOCASE').all().map((row) => row.nome);
  }

  function saveCategory(name) {
    const value = text(name, 100).toUpperCase();
    if (!value) throw new FichaValidationError('Informe a categoria.');
    db.prepare('INSERT OR IGNORE INTO ft_categorias (nome, criado_em) VALUES (?, ?)').run(value, now());
    return categories();
  }

  function renameCategory(previous, next) {
    const before = text(previous, 100).toUpperCase();
    const after = text(next, 100).toUpperCase();
    if (!before || !after) throw new FichaValidationError('Informe ambos os nomes de categoria.');
    if (before === FT_PREPARO_CATEGORY || after === FT_PREPARO_CATEGORY) {
      throw new FichaValidationError(`A categoria ${FT_PREPARO_CATEGORY} é fixa e não pode ser renomeada.`);
    }
    if (!db.prepare('SELECT 1 FROM ft_categorias WHERE nome = ?').get(before)) throw new FichaValidationError('Categoria anterior não localizada.');
    if (db.prepare('SELECT 1 FROM ft_categorias WHERE nome = ?').get(after)) throw new FichaValidationError('Já existe categoria com este nome.');
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE ft_categorias SET nome = ? WHERE nome = ?').run(after, before);
      db.prepare('UPDATE ft_cadastros SET categoria = ? WHERE categoria = ?').run(after, before);
      db.exec('COMMIT');
      return categories();
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function validateRecipe(recipe, activating) {
    const data = recipe || {};
    const name = text(data.nome, 200);
    const category = text(data.categoria, 100).toUpperCase();
    const base = data.base || {};
    const components = Array.isArray(data.componentes) ? data.componentes : [];
    const unidadeBase = text(base.unidade, 12).toUpperCase();
    const unidadeVenda = text(base.unidadeVenda || unidadeBase, 12).toUpperCase();
    if (!name) throw new FichaValidationError('Informe o nome da ficha técnica.');
    if (!category) throw new FichaValidationError('Informe a categoria.');
    if (!SALE_UNITS.includes(unidadeVenda)) throw new FichaValidationError('Selecione uma unidade de venda válida.');
    if (unidadeBase) quantityInUnit('1', unidadeBase, unidadeVenda);
    if (activating && (!base.qtd || !base.unidade || !components.length)) throw new FichaValidationError('Rendimento principal e componentes são obrigatórios para ativar.');
    const variations = (Array.isArray(data.variacoes) ? data.variacoes : []).map((variation) => {
      const { modo, ...rest } = variation || {};
      return rest;
    });
    const validLinks = new Set(['COMUM', 'PRINCIPAL', ...variations.map((variation) => String(variation.key || ''))]);
    const normalizedComponents = components.map((component) => {
      const { quantidades, ...rest } = component || {};
      const vinculo = String(component?.vinculo || 'COMUM');
      if (!validLinks.has(vinculo)) throw new FichaValidationError(`Vínculo de composição inválido: ${vinculo}.`);
      return { ...rest, vinculo, quantidade: text(component?.quantidade ?? quantidades?.BASE, 40) };
    });
    return {
      ...data,
      modeloComposicao: COMPOSITION_MODEL,
      nome: name,
      categoria: category,
      base: { qtd: text(base.qtd, 40), unidade: unidadeBase, unidadeVenda },
      variacoes: variations,
      componentes: normalizedComponents,
      preparo: text(data.preparo, 30000),
      observacoes: text(data.observacoes, 10000)
    };
  }

  function validateCompositionTypes(recipe, allowedLegacyFTIds = new Set()) {
    for (const [index, component] of (recipe.componentes || []).entries()) {
      const type = String(component?.tipo || '').toUpperCase();
      if (!['INSUMO', 'FT'].includes(type)) throw new FichaValidationError(`Tipo de componente inválido na linha ${index + 1}.`);
      if (type !== 'FT') continue;
      const id = text(component.id, 50);
      const child = db.prepare('SELECT ft_id, categoria, status, excluido FROM ft_cadastros WHERE ft_id = ?').get(id);
      if (!child || Number(child.excluido) === 1) throw new FichaValidationError(`FT intermediária não localizada na linha ${index + 1}.`);
      const category = String(child.categoria || '').trim().toUpperCase();
      if (category !== FT_PREPARO_CATEGORY && !allowedLegacyFTIds.has(id)) {
        throw new FichaValidationError(`A linha ${index + 1} só pode usar uma FT da categoria ${FT_PREPARO_CATEGORY}.`);
      }
    }
  }

  function save(data, activate = false) {
    const id = text(data?.id, 50);
    const current = id ? db.prepare('SELECT * FROM ft_cadastros WHERE ft_id = ? AND excluido = 0').get(id) : null;
    if (id && !current) throw new FichaValidationError('FT para edição não encontrada.');
    const statusBefore = current?.status || 'RASCUNHO';
    const currentSnapshot = current ? snapshot(id, current.versao_atual) : null;
    const allowedLegacyFTIds = new Set((currentSnapshot?.receita?.componentes || [])
      .filter((component) => String(component?.tipo || '').toUpperCase() === 'FT' && component.id)
      .map((component) => String(component.id)));
    const recipe = validateRecipe(data?.receita || data, Boolean(activate || statusBefore === 'ATIVA'));
    validateCompositionTypes(recipe, allowedLegacyFTIds);
    if (current && Number(data.versao || 0) !== Number(current.versao_atual || 0)) throw new FichaValidationError('Esta FT foi atualizada em outra sessão. Reabra antes de salvar.');
    if (activate) costModel(recipe, 'BASE', [], true);
    const serialized = JSON.stringify(recipe);
    const changed = !currentSnapshot || JSON.stringify(currentSnapshot.receita) !== serialized;
    const timestamp = now();
    const status = activate ? 'ATIVA' : statusBefore;
    if (!current) {
      const newId = nextId(db);
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO ft_cadastros (ft_id, nome, categoria, status, versao_atual, criado_em, atualizado_em, observacoes, excluido) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)')
          .run(newId, recipe.nome, recipe.categoria, status, timestamp, timestamp, recipe.observacoes);
        db.prepare('INSERT INTO ft_versoes (ft_id, versao, data, responsavel, receita_json, motivo) VALUES (?, 1, ?, ?, ?, ?)')
          .run(newId, timestamp, 'local', serialized, 'CRIAÇÃO');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return get(newId);
    }
    const version = changed ? Number(current.versao_atual || 0) + 1 : Number(current.versao_atual || 1);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE ft_cadastros SET nome = ?, categoria = ?, status = ?, versao_atual = ?, atualizado_em = ?, observacoes = ? WHERE ft_id = ?')
        .run(recipe.nome, recipe.categoria, status, version, timestamp, recipe.observacoes, id);
      if (changed) db.prepare('INSERT INTO ft_versoes (ft_id, versao, data, responsavel, receita_json, motivo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, version, timestamp, 'local', serialized, 'REVISÃO');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return get(id);
  }

  function library() {
    const todas = list();
    const fichas = todas.filter((item) => item.status !== 'INATIVA');
    const rascunhos = todas.filter((item) => item.status === 'RASCUNHO');
    const rendimentos = {};
    const components = {};
    for (const ficha of fichas.filter((item) => item.status === 'ATIVA')) {
      const result = get(ficha.id);
      rendimentos[ficha.id] = [{ key: 'BASE', nome: 'PRINCIPAL', unidade: result.receita?.base?.unidade || '' }, ...(result.receita?.variacoes || []).map((variation) => ({ key: variation.key, nome: variation.nome, unidade: variation.unidade }))];
      components[ficha.id] = (result.receita?.componentes || []).map((component) => component.id);
    }
    return { fichas, rascunhos, insumos: db.prepare('SELECT id, descricao, unidade, controla_estoque AS controla FROM insumos ORDER BY descricao COLLATE NOCASE').all().map((row) => ({ ...row, controla: Number(row.controla) === 1 ? 'SIM' : 'NÃO' })), categorias: categories(), rendimentosFT: rendimentos, componentesFT: components };
  }

  function changeStatus(id, status) {
    if (!['ATIVA', 'INATIVA'].includes(status)) throw new FichaValidationError('Situação inválida.');
    const row = db.prepare('SELECT 1 FROM ft_cadastros WHERE ft_id = ? AND excluido = 0').get(id);
    if (!row) throw new FichaValidationError('FT não localizada.');
    db.prepare('UPDATE ft_cadastros SET status = ?, atualizado_em = ? WHERE ft_id = ?').run(status, now(), id);
    return { status, dependentes: [] };
  }

  function deleteDraft(id) {
    const row = db.prepare("SELECT status FROM ft_cadastros WHERE ft_id = ? AND excluido = 0").get(id);
    if (!row || row.status !== 'RASCUNHO') throw new FichaValidationError('Somente rascunhos podem ser excluídos.');
    db.prepare('UPDATE ft_cadastros SET excluido = 1, atualizado_em = ? WHERE ft_id = ?').run(now(), id);
    return { ok: true };
  }

  function history(id) {
    return db.prepare('SELECT versao, data, motivo FROM ft_versoes WHERE ft_id = ? ORDER BY versao').all(id).map((row) => ({ versao: Number(row.versao), data: row.data, motivo: row.motivo }));
  }

  function calculateManualCost(value, packageSize, paidValue) {
    const embalagem = text(packageSize, 40);
    const pago = text(paidValue, 40);
    let cost;
    let displayValue;
    if (embalagem || pago) {
      if (!embalagem || !pago) throw new FichaValidationError('Informe o tamanho da embalagem e o valor pago.');
      try {
        const tamanho = parseFraction(embalagem);
        const valorPago = parseFraction(pago);
        if (tamanho.n <= 0n || valorPago.n <= 0n) throw new Error('non-positive');
        cost = divide(valorPago, tamanho);
      } catch {
        throw new FichaValidationError('Tamanho da embalagem ou valor pago inválido.');
      }
      displayValue = decimalText(cost, 18);
    } else {
      const rawCost = text(value, 40).replace(',', '.');
      if (!/^\d+(?:\.\d{1,18})?$/.test(rawCost) || Number(rawCost) <= 0) throw new FichaValidationError('Custo inválido.');
      cost = parseFraction(rawCost);
      displayValue = rawCost;
    }
    return { cost, displayValue };
  }

  function saveManualCost(insumoId, value, observation, packageSize, paidValue) {
    const insumo = db.prepare('SELECT id, unidade FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo) throw new FichaValidationError('Insumo não encontrado.');
    const calculated = calculateManualCost(value, packageSize, paidValue);
    const cost = calculated.cost;
    const displayValue = calculated.displayValue;
    const exact = fractionText(cost);
    db.prepare(`
      INSERT INTO ft_custos_manuais (insumo_id, unidade, custo_exato, data, origem, observacao)
      VALUES (?, ?, ?, ?, 'MANUAL FT', ?)
      ON CONFLICT(insumo_id) DO UPDATE SET unidade = excluded.unidade, custo_exato = excluded.custo_exato, data = excluded.data, origem = excluded.origem, observacao = excluded.observacao
    `).run(insumoId, insumo.unidade, exact, now(), text(observation, 400));
    return { ok: true, id: insumoId, unidade: insumo.unidade, valor: displayValue, custoExato: exact };
  }

  function originLabel(origin) {
    const value = String(origin || '').toUpperCase();
    if (value.includes('COMPRA')) return 'COMPRAS';
    if (value.includes('ESTOQUE') || value.includes('ENTRADA MANUAL') || value.includes('AQUISIÇÃO')) return 'ESTOQUE';
    if (value.includes('MANUAL FT') || value.includes('FICHA')) return 'FICHA TÉCNICA';
    if (value.includes('ALTERAÇÃO MANUAL')) return 'ALTERAÇÃO MANUAL';
    return value || 'NÃO INFORMADA';
  }

  function updateManualCost(insumoId, packageSize, paidValue, observation = 'Atualização manual pelo módulo INSUMOS') {
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo) throw new FichaValidationError('Insumo não encontrado.');
    const calculated = calculateManualCost('', packageSize, paidValue);
    const cost = calculated.cost;
    const exact = fractionText(cost);
    const timestamp = now();
    const balance = db.prepare('SELECT * FROM estoque_saldos WHERE insumo_id = ?').get(insumo.id);
    const quantityMili = BigInt(balance?.quantidade_mili || '0');
    const beforeValue = parseFraction(balance?.valor_exato || '0/1');
    const afterValue = quantityMili > 0n ? multiply(cost, fraction(quantityMili, 1000n)) : beforeValue;
    const pending = parseFraction(balance?.pendente_exato || '0/1');
    const lastCost = quantityMili > 0n ? cost : parseFraction(balance?.ultimo_custo_exato || '0/1');
    const reference = db.prepare('SELECT * FROM estoque_custos_referencia WHERE insumo_id = ?').get(insumo.id);
    db.exec('BEGIN');
    try {
      if (balance && quantityMili > 0n) {
        db.prepare(`
          UPDATE estoque_saldos
          SET valor_exato = ?, ultimo_custo_exato = ?, atualizado_em = ?
          WHERE insumo_id = ?
        `).run(fractionText(afterValue), fractionText(lastCost), timestamp, insumo.id);
      }
      db.prepare(`
        INSERT INTO estoque_custos_referencia (insumo_id, unidade, custo_exato, atualizado_em, origem, referencia)
        VALUES (?, ?, ?, ?, 'ALTERAÇÃO MANUAL', ?)
        ON CONFLICT(insumo_id) DO UPDATE SET unidade = excluded.unidade, custo_exato = excluded.custo_exato,
          atualizado_em = excluded.atualizado_em, origem = excluded.origem, referencia = excluded.referencia
      `).run(insumo.id, insumo.unidade, exact, timestamp, 'INSUMOS');
      db.prepare(`
        INSERT INTO ft_custos_manuais (insumo_id, unidade, custo_exato, data, origem, observacao)
        VALUES (?, ?, ?, ?, 'ALTERAÇÃO MANUAL', ?)
        ON CONFLICT(insumo_id) DO UPDATE SET unidade = excluded.unidade, custo_exato = excluded.custo_exato,
          data = excluded.data, origem = excluded.origem, observacao = excluded.observacao
      `).run(insumo.id, insumo.unidade, exact, timestamp, text(observation, 400));
      if (balance && quantityMili > 0n) {
        const operationId = nextOperationalId(db, 'estoque_operacoes', 'MOV');
        const movementId = nextOperationalId(db, 'estoque_movimentacoes', 'DET');
        const impact = subtract(afterValue, beforeValue);
        db.prepare(`
          INSERT INTO estoque_operacoes (id, data, movimento, tipo, referencia, valor_impacto_exato, observacao)
          VALUES (?, ?, 'AJUSTE', 'ALTERAÇÃO MANUAL DE CUSTO', ?, ?, ?)
        `).run(operationId, timestamp, insumo.id, fractionText(impact), text(observation, 400));
        db.prepare(`
          INSERT INTO estoque_movimentacoes (
            id, operacao_id, data, insumo_id, quantidade_mili, valor_antes_exato, valor_depois_exato,
            pendente_antes_exato, pendente_depois_exato, descricao
          ) VALUES (?, ?, ?, ?, '0', ?, ?, ?, ?, ?)
        `).run(movementId, operationId, timestamp, insumo.id, fractionText(beforeValue), fractionText(afterValue), fractionText(pending), fractionText(pending), 'ALTERAÇÃO MANUAL DE CUSTO');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, id: insumo.id, unidade: insumo.unidade, valor: calculated.displayValue, custoExato: exact, quantidadeMili: String(quantityMili), valorEstoqueExato: fractionText(afterValue), origem: 'ALTERAÇÃO MANUAL', atualizado: timestamp };
  }

  function referenceManual(insumoId) {
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
    if (!insumo) throw new FichaValidationError('Selecione um insumo cadastrado.');
    const balance = db.prepare('SELECT * FROM estoque_saldos WHERE insumo_id = ?').get(insumo.id);
    const reference = db.prepare('SELECT * FROM estoque_custos_referencia WHERE insumo_id = ? AND unidade = ?').get(insumo.id, insumo.unidade);
    const manual = db.prepare('SELECT * FROM ft_custos_manuais WHERE insumo_id = ? AND unidade = ?').get(insumo.id, insumo.unidade);
    let operational = { cost: fraction(0n), method: 'AGUARDANDO NOVA AQUISIÇÃO', date: '', origin: '' };
    try {
      const current = costReference(insumo);
      const date = reference?.atualizado_em || manual?.data || balance?.atualizado_em || '';
      const origin = originLabel(reference?.origem || manual?.origem || current.method);
      operational = { ...current, date, origin };
    } catch {}
    return {
      insumo: insumo.descricao,
      unidade: insumo.unidade,
      operacional: decimalText(operational.cost, 18),
      metodo: operational.method,
      custoExistente: decimalText(operational.cost, 18),
      dataUltimaAtualizacao: operational.date || '',
      origemAlteracao: operational.origin || 'NÃO INFORMADA',
      manual: manual ? decimalText(parseFraction(manual.custo_exato), 18) : '',
      atualizado: manual?.data || '',
      podeEditar: true
    };
  }

  function impactInsumo(insumoId) {
    const results = [];
    for (const ficha of list().filter((item) => item.versao > 0)) {
      try {
        const data = get(ficha.id);
        if ((data.receita?.componentes || []).some((component) => component.tipo === 'INSUMO' && component.id === insumoId)) results.push(ficha);
      } catch {}
    }
    return results;
  }

  function compareVersions(id, first, second) {
    const a = get(id, first);
    const b = get(id, second);
    const differences = [];
    const compare = (name, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ campo: name, antes: left, depois: right }); };
    compare('Rendimento principal', a.receita?.base, b.receita?.base);
    compare('Rendimentos adicionais', a.receita?.variacoes, b.receita?.variacoes);
    compare('Composição / ingredientes', a.receita?.componentes, b.receita?.componentes);
    compare('Modo de preparo', a.receita?.preparo, b.receita?.preparo);
    return { a: a.versao, b: b.versao, diferencas: differences };
  }

  function prices(id) {
    return Object.fromEntries(db.prepare('SELECT config_key, pdv FROM ft_precos WHERE ft_id = ?').all(id).map((row) => [row.config_key, row.pdv]));
  }

  function savePrices(id, values) {
    const timestamp = now();
    const upsert = db.prepare(`
      INSERT INTO ft_precos (ft_id, config_key, pdv, data, responsavel) VALUES (?, ?, ?, ?, 'local')
      ON CONFLICT(ft_id, config_key) DO UPDATE SET pdv = excluded.pdv, data = excluded.data, responsavel = excluded.responsavel
    `);
    Object.entries(values || {}).forEach(([key, value]) => upsert.run(id, key, text(value, 100), timestamp));
    return prices(id);
  }

  function costReference(insumo) {
    const balance = db.prepare('SELECT * FROM estoque_saldos WHERE insumo_id = ?').get(insumo.id);
    const reference = db.prepare('SELECT * FROM estoque_custos_referencia WHERE insumo_id = ? AND unidade = ?').get(insumo.id, insumo.unidade);
    const manual = db.prepare('SELECT * FROM ft_custos_manuais WHERE insumo_id = ? AND unidade = ?').get(insumo.id, insumo.unidade);
    if (balance && BigInt(balance.quantidade_mili || '0') > 0n) return { cost: divide(parseFraction(balance.valor_exato), fraction(BigInt(balance.quantidade_mili), 1000n)), method: 'MÉDIA PONDERADA' };
    if (reference && reference.custo_exato) return { cost: parseFraction(reference.custo_exato), method: reference.origem || 'REFERÊNCIA' };
    if (manual && manual.custo_exato) return { cost: parseFraction(manual.custo_exato), method: 'MANUAL' };
    if (balance && balance.ultimo_custo_exato && parseFraction(balance.ultimo_custo_exato).n !== 0n) return { cost: parseFraction(balance.ultimo_custo_exato), method: 'REFERÊNCIA HISTÓRICA' };
    throw new FichaValidationError(`CUSTO_AUSENTE:${insumo.id}:${insumo.descricao}`);
  }

  function variation(recipe, key) {
    if (key === 'BASE') return { key: 'BASE', nome: 'PRINCIPAL', qtd: recipe.base?.qtd, unidade: recipe.base?.unidade };
    const found = (recipe.variacoes || []).find((item) => item.key === key);
    if (!found) throw new FichaValidationError(`Rendimento não encontrado: ${key}`);
    return found;
  }

  function costModel(recipe, key, path = [], required = false) {
    const current = variation(recipe, key);
    if (!current.qtd || !current.unidade) throw new FichaValidationError('Rendimento não definido.');
    const components = Array.isArray(recipe.componentes) ? recipe.componentes : [];
    let total = fraction(0n);
    const details = [];
    const missing = new Map();
    const addMissing = (items) => (items || []).forEach((item) => {
      if (item?.id) missing.set(String(item.id), { id: String(item.id), nome: String(item.nome || item.id) });
    });
    const insumos = new Map(db.prepare('SELECT * FROM insumos').all().map((row) => [row.id, row]));
    for (const component of components) {
      const vinculo = String(component.vinculo || 'COMUM');
      const applies = vinculo === 'COMUM' || (key === 'BASE' ? vinculo === 'PRINCIPAL' : vinculo === key);
      if (!applies) continue;
      const raw = component.quantidade ?? component.quantidades?.BASE ?? (key === 'BASE' ? component.quantidades?.BASE : component.quantidades?.[key]);
      if (raw === undefined || raw === '' || Number(raw) === 0) continue;
      const quantity = parseFraction(raw);
      let unitCost;
      let label;
      let unit;
      let method;
      let factor = parseFraction('1');
      if (component.tipo === 'FT') {
        if (path.includes(component.id)) throw new FichaValidationError(`Dependência circular entre FTs: ${path.concat([component.id]).join(' → ')}`);
        const childRow = db.prepare("SELECT * FROM ft_cadastros WHERE ft_id = ? AND status = 'ATIVA' AND excluido = 0").get(component.id);
        if (!childRow) throw new FichaValidationError(`FT intermediária ausente ou inativa: ${component.id}`);
        const child = get(component.id);
        const isPreparationFT = String(childRow.categoria || '').trim().toUpperCase() === FT_PREPARO_CATEGORY;
        let nested;
        try {
          nested = costModel(child.receita, isPreparationFT ? 'BASE' : (component.configKey || 'BASE'), path.concat([component.id]), required);
        } catch (error) {
          if (Array.isArray(error.custosAusentes)) { addMissing(error.custosAusentes); continue; }
          throw error;
        }
        unitCost = nested.unit;
        label = `FT · ${child.receita.nome}`;
        unit = nested.unidade;
        method = `${component.id} V${child.versao}${isPreparationFT ? ' · PRINCIPAL' : ''}`;
      } else {
        const insumo = insumos.get(component.id);
        if (!insumo) throw new FichaValidationError(`Insumo não encontrado: ${component.id}`);
        let reference;
        try {
          reference = costReference(insumo);
        } catch (error) {
          if (String(error.message || '').startsWith('CUSTO_AUSENTE:')) { addMissing([{ id: insumo.id, nome: insumo.descricao }]); continue; }
          throw error;
        }
        factor = parseFraction(String(insumo.fc || '1'));
        unitCost = multiply(reference.cost, factor);
        label = insumo.descricao;
        unit = insumo.unidade;
        method = reference.method;
      }
      const subtotal = multiply(quantity, unitCost);
      total = add(total, subtotal);
      details.push({ tipo: component.tipo || 'INSUMO', id: component.id, nome: label, quantidade: Number(raw), unidade: unit, fc: Number(decimalText(factor, 6)), subtotal: moneyText(subtotal), referencia: method, configKey: component.configKey || 'BASE', vinculo, etapa: component.etapa || '' });
    }
    if (missing.size) {
      const custosAusentes = [...missing.values()];
      const error = new FichaValidationError(`CUSTOS_AUSENTES:${custosAusentes.map((item) => `${item.id}:${item.nome}`).join('|')}`);
      error.custosAusentes = custosAusentes;
      throw error;
    }
    if (required && !details.length) throw new FichaValidationError('A configuração não possui componentes com quantidades.');
    const unidadeVenda = key === 'BASE' ? (recipe.base?.unidadeVenda || current.unidade) : current.unidade;
    const rendimentoVenda = quantityInUnit(current.qtd, current.unidade, unidadeVenda);
    const unit = divide(total, rendimentoVenda);
    return {
      total,
      unit,
      nome: current.nome,
      rendimento: Number(current.qtd),
      unidade: current.unidade,
      rendimentoVenda: decimalText(rendimentoVenda, 6),
      unidadeVenda,
      custoTotal: moneyText(total),
      custoTotalExato: decimalText(total, 18),
      custoUnitario: decimalText(unit, 18),
      custoUnitarioExato: decimalText(unit, 18),
      custoUnitarioExibido: decimalCeilText(unit, 2),
      detalhes: details
    };
  }

  function preview(data) {
    const recipe = validateRecipe(data, false);
    const configurations = [{ key: 'BASE', nome: 'PRINCIPAL' }, ...(recipe.variacoes || []).map((item) => ({ key: item.key, nome: item.nome }))];
    return configurations.map((configuration) => {
      try {
        const result = costModel(recipe, configuration.key, [], false);
        return { ...configuration, custoTotal: result.custoTotal, custoTotalExato: result.custoTotalExato, custoUnitario: result.custoUnitario, custoUnitarioExato: result.custoUnitarioExato, custoUnitarioExibido: result.custoUnitarioExibido, rendimento: result.rendimento, rendimentoVenda: result.rendimentoVenda, unidade: result.unidade, unidadeVenda: result.unidadeVenda, detalhes: result.detalhes };
      } catch (error) { return { ...configuration, erro: error.message, custosAusentes: error.custosAusentes || [] }; }
    });
  }

  function summary(id) {
    const ficha = get(id);
    if (!ficha.receita || ficha.status === 'RASCUNHO') return { ft: ficha, configuracoes: [] };
    const configurations = [{ key: 'BASE', nome: 'PRINCIPAL' }, ...(ficha.receita.variacoes || []).map((item) => ({ key: item.key, nome: item.nome }))];
    return {
      ft: { id: ficha.id, nome: ficha.receita.nome, versao: ficha.versao, status: ficha.status },
      configuracoes: configurations.map((configuration) => {
        try {
          const result = costModel(ficha.receita, configuration.key, [id], false);
          return { ...configuration, custoTotal: result.custoTotal, custoTotalExato: result.custoTotalExato, custoUnitario: result.custoUnitario, custoUnitarioExato: result.custoUnitarioExato, custoUnitarioExibido: result.custoUnitarioExibido, rendimento: result.rendimento, rendimentoVenda: result.rendimentoVenda, unidade: result.unidade, unidadeVenda: result.unidadeVenda, detalhes: result.detalhes };
        } catch (error) { return { ...configuration, erro: error.message, custosAusentes: error.custosAusentes || [] }; }
      })
    };
  }

  function simulate(id, configurations) {
    const ficha = get(id);
    if (ficha.status !== 'ATIVA') throw new FichaValidationError('Somente FTs ativas podem ser simuladas.');
    if (!Array.isArray(configurations) || !configurations.length) throw new FichaValidationError('Selecione um rendimento.');
    let total = fraction(0n);
    const lines = [];
    const consolidated = new Map();
    for (const configuration of configurations) {
      const times = parseFraction(configuration.receitas);
      if (times.n <= 0n || (times.n * 4n) % times.d !== 0n) throw new FichaValidationError('Quantidade de receitas deve ser múltiplo de 0,25.');
      const result = costModel(ficha.receita, text(configuration.key, 50), [id], true);
      const subtotal = multiply(result.total, times);
      total = add(total, subtotal);
      result.detalhes.forEach((detail) => {
        const key = [detail.tipo, detail.id, detail.configKey, detail.unidade].join('|');
        const current = consolidated.get(key) || { id: detail.id, nome: detail.nome, tipo: detail.tipo, unidade: detail.unidade, quantidade: fraction(0n), bruto: fraction(0n) };
        current.quantidade = add(current.quantidade, multiply(parseFraction(String(detail.quantidade)), times));
        current.bruto = add(current.bruto, multiply(multiply(parseFraction(String(detail.quantidade)), times), parseFraction(String(detail.fc || 1))));
        consolidated.set(key, current);
      });
      lines.push({ nome: result.nome, receitas: Number(times.n) / Number(times.d), rendimento: result.rendimento * Number(times.n) / Number(times.d), unidade: result.unidade, custo: result.custoTotal, componentes: result.detalhes.map((detail) => ({ ...detail, quantidade: detail.quantidade * Number(times.n) / Number(times.d) })) });
    }
    const materials = [...consolidated.values()].map((item) => {
      const insumo = item.tipo === 'INSUMO' ? db.prepare('SELECT * FROM insumos WHERE id = ?').get(item.id) : null;
      const controlled = Boolean(insumo && Number(insumo.controla_estoque) === 1);
      const balance = controlled ? db.prepare('SELECT quantidade_mili FROM estoque_saldos WHERE insumo_id = ?').get(item.id) : null;
      const available = balance ? fraction(BigInt(balance.quantidade_mili || '0'), 1000n) : null;
      const shortage = available && compare(available, item.bruto) < 0 ? subtract(item.bruto, available) : fraction(0n);
      return { nome: item.nome, tipo: item.tipo, unidade: item.unidade, quantidade: decimalText(item.quantidade, 6), quantidadeBruta: decimalText(item.bruto, 6), saldoDisponivel: available ? decimalText(available, 6) : null, falta: available ? decimalText(shortage, 6) : null, consultaSaldo: controlled ? 'DISPONÍVEL' : 'SALDO NÃO DISPONÍVEL' };
    });
    return { data: now(), linhas: lines, custoTotal: moneyText(total), materiais: materials };
  }

  return { list, get, library, categories, saveCategory, renameCategory, save, changeStatus, deleteDraft, history, saveManualCost, updateManualCost, referenceManual, impactInsumo, compareVersions, prices, savePrices, preview, summary, simulate };
}

module.exports = { FichaValidationError, FT_PREPARO_CATEGORY, createNormalizedFichaService };
