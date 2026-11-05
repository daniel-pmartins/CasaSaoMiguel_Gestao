const CATEGORIAS_INSUMOS = [
  'INGREDIENTE',
  'EMBALAGEM',
  'DESCARTAVEL',
  'LIMPEZA',
  'MANUTENCAO',
  'PREPARO'
];

const UNIDADES_INSUMOS = ['G', 'ML', 'UN', 'CM', 'KWH'];
const CNPJ_SEM_DOCUMENTO = '00000000000000';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function text(value, limit = 500) {
  return String(value ?? '').trim().slice(0, limit);
}

function compareText(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/\s+/g, ' ');
}

function canonicalInsumoCategory(value, categories = CATEGORIAS_INSUMOS) {
  const normalized = compareText(value);
  return categories.find((category) => compareText(category) === normalized) || '';
}

function normalizeCnpj(value) {
  const cnpj = text(value, 30).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cnpj.length !== 14) throw new ValidationError('Informe um CNPJ com 14 posições.');
  if (cnpj !== CNPJ_SEM_DOCUMENTO && !validCnpj(cnpj)) throw new ValidationError('CNPJ inválido.');
  return cnpj;
}

function isoNow() {
  return new Date().toISOString();
}

function asBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return !['NÃO', 'NAO', 'N', 'FALSE', '0'].includes(compareText(value));
}

function asPublicInsumo(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    dataCadastro: row.data_cadastro || '',
    dataAlteracao: row.data_ultima_alteracao || '',
    descricao: row.descricao,
    unidade: row.unidade,
    observacao: row.observacao,
    categoria: row.categoria,
    fc: Number(row.fc),
    controlaEstoque: Number(row.controla_estoque) === 1 ? 'SIM' : 'NÃO',
    conversao: Number(row.conversao_ativa) === 1 ? 'SIM' : 'NÃO',
    conversaoAtiva: Number(row.conversao_ativa) === 1,
    fatorConversaoGml: Number(row.conversao_ativa) === 1 && Number(row.fator_conversao_g_ml) > 0
      ? Number(row.fator_conversao_g_ml)
      : ''
  };
}

function asPublicFornecedor(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    cnpj: row.cnpj,
    dataAbertura: row.data_abertura || '',
    situacaoCadastral: row.situacao_cadastral,
    dataSituacaoCadastral: row.data_situacao_cadastral || '',
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    cep: row.cep,
    cidade: row.cidade,
    uf: row.uf,
    nomeContato: row.nome_contato,
    telefone: row.telefone,
    email: row.email,
    dataCadastro: row.data_cadastro || '',
    dataAlteracao: row.data_ultima_alteracao || '',
    situacaoCompras: row.situacao_compras,
    excluidoLogico: Number(row.excluido_logicamente) === 1,
    excluidoEm: row.excluido_em || ''
  };
}

function nextId(db, table, prefix) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`);
  let greatest = 0;
  for (const row of rows) {
    const match = String(row.id).match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    if (match) greatest = Math.max(greatest, Number(match[1]));
  }
  return `${prefix}${String(greatest + 1).padStart(4, '0')}`;
}

function levenshtein(left, right) {
  const a = compareText(left);
  const b = compareText(right);
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function candidateForDescription(description, rows, currentId = '') {
  const wanted = compareText(description);
  if (!wanted) return null;
  const candidates = rows
    .filter((row) => String(row.id) !== String(currentId || ''))
    .map((row) => ({ row, normalized: compareText(row.descricao) }))
    .filter(({ normalized }) => normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized));
  if (candidates.length) return candidates[0].row;

  const threshold = wanted.length < 8 ? 1 : Math.max(2, Math.floor(wanted.length * 0.18));
  let best = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (String(row.id) === String(currentId || '')) continue;
    const currentDistance = levenshtein(wanted, row.descricao);
    if (currentDistance < distance) {
      distance = currentDistance;
      best = row;
    }
  }
  return distance <= threshold ? best : null;
}

function validateInsumo(input, categories = CATEGORIAS_INSUMOS) {
  if (!input) throw new ValidationError('Não foram recebidos dados para salvar.');
  const descricao = compareText(input.descricao);
  const categoria = canonicalInsumoCategory(input.categoria, categories);
  const unidade = compareText(input.unidade);
  const observacao = text(input.observacao);
  const fc = Number(String(input.fc ?? '1').replace(',', '.'));
  const conversaoInformada = Object.prototype.hasOwnProperty.call(input, 'conversao') || Object.prototype.hasOwnProperty.call(input, 'conversaoAtiva') || Object.prototype.hasOwnProperty.call(input, 'fatorConversaoGml') || Object.prototype.hasOwnProperty.call(input, 'densidadeGml');
  const conversaoAtiva = conversaoInformada ? asBoolean(input.conversao ?? input.conversaoAtiva, false) : false;
  const fatorConversaoGml = Number(String(input.fatorConversaoGml ?? input.densidadeGml ?? '').replace(',', '.'));
  if (!descricao) throw new ValidationError('A descrição é obrigatória.');
  if (!categoria) throw new ValidationError('Selecione uma categoria válida.');
  if (!UNIDADES_INSUMOS.includes(unidade)) throw new ValidationError('Selecione G, ML, UN, CM ou KWH como unidade de medida.');
  if (!Number.isFinite(fc) || fc <= 0 || fc > 1000000) throw new ValidationError('O fator de correção deve ser maior que zero.');
  if (conversaoAtiva && (!Number.isFinite(fatorConversaoGml) || fatorConversaoGml <= 0 || fatorConversaoGml > 100)) {
    throw new ValidationError('Informe um fator de conversão G/ML maior que zero.');
  }
  return {
    id: text(input.id, 40),
    descricao,
    unidade,
    observacao,
    categoria,
    fc,
    controlaEstoque: asBoolean(input.controlaEstoque, true),
    conversaoInformada,
    conversaoAtiva,
    fatorConversaoGml: conversaoAtiva ? fatorConversaoGml : 0
  };
}

function createCadastrosService(db) {
  function lerCategoriasInsumos() {
    return db.prepare('SELECT nome FROM categorias_insumos ORDER BY ordem, nome COLLATE NOCASE').all().map((row) => row.nome);
  }

  function garantirCatalogoCategorias() {
    const agora = isoNow();
    const inserir = db.prepare('INSERT OR IGNORE INTO categorias_insumos (nome, ordem, criado_em) VALUES (?, ?, ?)');
    const atualizarInsumos = db.prepare('UPDATE insumos SET categoria = ? WHERE categoria = ?');
    const categoriasAntigas = db.prepare('SELECT DISTINCT categoria FROM insumos').all().map((row) => row.categoria);
    const categoriasTabela = db.prepare('SELECT nome FROM categorias_insumos ORDER BY ordem, nome COLLATE NOCASE').all().map((row) => row.nome);
    const catalogoNovo = categoriasTabela.length === 0;

    db.exec('BEGIN');
    try {
      for (const categoria of categoriasTabela) {
        const normalizada = compareText(categoria);
        if (!normalizada || normalizada === categoria) continue;
        const conflito = db.prepare('SELECT nome FROM categorias_insumos WHERE nome = ?').get(normalizada);
        if (conflito) {
          atualizarInsumos.run(normalizada, categoria);
          db.prepare('DELETE FROM categorias_insumos WHERE nome = ?').run(categoria);
        } else {
          db.prepare('UPDATE categorias_insumos SET nome = ? WHERE nome = ?').run(normalizada, categoria);
          atualizarInsumos.run(normalizada, categoria);
        }
      }

      const existentes = new Set(lerCategoriasInsumos());
      if (catalogoNovo) {
        CATEGORIAS_INSUMOS.forEach((categoria, ordem) => {
          const normalizada = compareText(categoria);
          if (existentes.has(normalizada)) return;
          inserir.run(normalizada, ordem, agora);
          existentes.add(normalizada);
        });
      }

      let proximaOrdem = Number(db.prepare('SELECT COALESCE(MAX(ordem), -1) AS maior FROM categorias_insumos').get().maior) + 1;
      for (const categoria of categoriasAntigas) {
        const normalizada = compareText(categoria);
        if (!normalizada) continue;
        const categoriaOficial = canonicalInsumoCategory(normalizada, [...existentes]);
        const nomeFinal = categoriaOficial || normalizada;
        if (!existentes.has(nomeFinal)) {
          inserir.run(nomeFinal, proximaOrdem, agora);
          existentes.add(nomeFinal);
          proximaOrdem += 1;
        }
        if (categoria !== nomeFinal) atualizarInsumos.run(nomeFinal, categoria);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  garantirCatalogoCategorias();

  function listarCategoriasInsumos() {
    return lerCategoriasInsumos();
  }

  function salvarCategoriaInsumo(nome) {
    const categoria = compareText(nome);
    if (!categoria) throw new ValidationError('Informe o nome da categoria.');
    const existente = canonicalInsumoCategory(categoria, listarCategoriasInsumos());
    if (existente) throw new ValidationError('Essa categoria já está cadastrada.');
    const maiorOrdem = Number(db.prepare('SELECT COALESCE(MAX(ordem), -1) AS maior FROM categorias_insumos').get().maior);
    db.prepare('INSERT INTO categorias_insumos (nome, ordem, criado_em) VALUES (?, ?, ?)').run(categoria, maiorOrdem + 1, isoNow());
    return { status: 'CRIADO', mensagem: 'Categoria cadastrada com sucesso.', categoria, categorias: listarCategoriasInsumos() };
  }

  function renomearCategoriaInsumo(anterior, novo) {
    const categorias = listarCategoriasInsumos();
    const categoriaAnterior = canonicalInsumoCategory(anterior, categorias);
    const categoriaNova = compareText(novo);
    if (!categoriaAnterior) throw new ValidationError('Selecione uma categoria cadastrada.');
    if (!categoriaNova) throw new ValidationError('Informe o novo nome da categoria.');
    const duplicada = canonicalInsumoCategory(categoriaNova, categorias);
    if (duplicada && duplicada !== categoriaAnterior) throw new ValidationError('Essa categoria já está cadastrada.');
    if (categoriaAnterior === categoriaNova) {
      return { status: 'ATUALIZADO', mensagem: 'A categoria já possui esse nome.', categoria: categoriaNova, categorias };
    }

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE categorias_insumos SET nome = ? WHERE nome = ?').run(categoriaNova, categoriaAnterior);
      db.prepare('UPDATE insumos SET categoria = ? WHERE categoria = ?').run(categoriaNova, categoriaAnterior);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { status: 'ATUALIZADO', mensagem: 'Categoria renomeada com sucesso.', categoria: categoriaNova, categorias: listarCategoriasInsumos() };
  }

  function listarInsumos({ categoria = '', q = '' } = {}) {
    const rows = db.prepare('SELECT * FROM insumos ORDER BY descricao COLLATE NOCASE').all();
    const wantedCategory = compareText(categoria);
    const wantedQuery = compareText(q);
    return rows
      .filter((row) => !wantedCategory || compareText(row.categoria) === wantedCategory)
      .filter((row) => !wantedQuery || compareText(row.descricao).includes(wantedQuery))
      .map(asPublicInsumo);
  }

  function obterInsumoPorId(id) {
    const row = db.prepare('SELECT * FROM insumos WHERE id = ?').get(text(id, 40));
    return asPublicInsumo(row);
  }

  function verificarPossivelDuplicidade(descricao, idAtual = '') {
    const rows = db.prepare('SELECT * FROM insumos').all();
    const candidate = candidateForDescription(descricao, rows, idAtual);
    if (!candidate) return { encontrado: false };
    return {
      encontrado: true,
      insumo: asPublicInsumo(candidate),
      correspondenciaExata: compareText(candidate.descricao) === compareText(descricao)
    };
  }

  function salvarInsumo(input, forcarNovo = false) {
    const data = validateInsumo(input, listarCategoriasInsumos());
    const duplicate = verificarPossivelDuplicidade(data.descricao, data.id);
    if (duplicate.encontrado && !forcarNovo) {
      return {
        status: 'POSSIVEL_DUPLICIDADE',
        insumo: duplicate.insumo,
        correspondenciaExata: duplicate.correspondenciaExata
      };
    }

    const now = isoNow();
    if (data.id) {
      const existing = db.prepare('SELECT * FROM insumos WHERE id = ?').get(data.id);
      if (!existing) throw new ValidationError('O insumo selecionado não foi encontrado.');
      const conversaoAtiva = data.conversaoInformada ? data.conversaoAtiva : Number(existing.conversao_ativa) === 1;
      const fatorConversaoGml = data.conversaoInformada ? data.fatorConversaoGml : Number(existing.fator_conversao_g_ml || 0);
      db.prepare(`
        UPDATE insumos
        SET data_ultima_alteracao = ?, descricao = ?, unidade = ?, observacao = ?,
            categoria = ?, fc = ?, controla_estoque = ?, conversao_ativa = ?, fator_conversao_g_ml = ?
        WHERE id = ?
      `).run(now, data.descricao, data.unidade, data.observacao, data.categoria, data.fc,
        data.controlaEstoque ? 1 : 0, conversaoAtiva ? 1 : 0, fatorConversaoGml, data.id);
      return { status: 'ATUALIZADO', mensagem: 'Insumo atualizado com sucesso.', insumo: obterInsumoPorId(data.id) };
    }

    const id = nextId(db, 'insumos', 'INS');
    db.prepare(`
      INSERT INTO insumos (
        id, data_cadastro, data_ultima_alteracao, descricao, unidade, observacao, categoria, fc,
        controla_estoque, conversao_ativa, fator_conversao_g_ml
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, now, data.descricao, data.unidade, data.observacao, data.categoria, data.fc,
      data.controlaEstoque ? 1 : 0, data.conversaoAtiva ? 1 : 0, data.fatorConversaoGml);
    return { status: 'CRIADO', mensagem: 'Insumo cadastrado com sucesso.', insumo: obterInsumoPorId(id) };
  }

  function listarFornecedores({ incluirExcluidos = false, q = '' } = {}) {
    const rows = db.prepare('SELECT * FROM fornecedores ORDER BY razao_social COLLATE NOCASE').all();
    const wanted = compareText(q);
    return rows
      .filter((row) => incluirExcluidos || Number(row.excluido_logicamente) !== 1)
      .filter((row) => !wanted || [row.razao_social, row.nome_fantasia, row.cnpj].some((value) => compareText(value).includes(wanted)))
      .map(asPublicFornecedor);
  }

  function obterFornecedorPorId(id) {
    return asPublicFornecedor(db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(text(id, 40)));
  }

  function validateFornecedor(input) {
    if (!input) throw new ValidationError('Os dados do fornecedor não foram recebidos.');
    const cnpj = normalizeCnpj(input.cnpj);
    const razaoSocial = text(input.razaoSocial, 200);
    const situacaoCompras = compareText(input.situacaoCompras || 'ATIVO');
    if (!razaoSocial) throw new ValidationError('A razão social é obrigatória.');
    if (!['ATIVO', 'INATIVO'].includes(situacaoCompras)) throw new ValidationError('Situação para compras inválida.');
    return {
      id: text(input.id, 40),
      cnpj,
      dataAbertura: text(input.dataAbertura, 20),
      situacaoCadastral: text(input.situacaoCadastral, 80),
      dataSituacaoCadastral: text(input.dataSituacaoCadastral, 20),
      razaoSocial,
      nomeFantasia: text(input.nomeFantasia, 200),
      logradouro: text(input.logradouro, 200),
      numero: text(input.numero, 30),
      complemento: text(input.complemento, 120),
      bairro: text(input.bairro, 120),
      cep: text(input.cep, 20).replace(/\D/g, ''),
      cidade: text(input.cidade, 120),
      uf: compareText(input.uf).slice(0, 2),
      nomeContato: text(input.nomeContato, 120),
      telefone: text(input.telefone, 40),
      email: text(input.email, 200),
      situacaoCompras,
      semCnpj: cnpj === CNPJ_SEM_DOCUMENTO
    };
  }

  function salvarFornecedor(input, forcarDuplicidade = false) {
    const data = validateFornecedor(input);
    const duplicate = db.prepare(`
      SELECT * FROM fornecedores
      WHERE id <> ? AND (cnpj = ? OR lower(razao_social) = lower(?))
      LIMIT 1
    `).get(data.id || '', data.cnpj, data.razaoSocial);
    if (duplicate && !forcarDuplicidade) {
      return { status: 'POSSIVEL_DUPLICIDADE', fornecedor: asPublicFornecedor(duplicate) };
    }

    const now = isoNow();
    const values = [
      data.cnpj, data.dataAbertura || null, data.situacaoCadastral, data.dataSituacaoCadastral || null,
      data.razaoSocial, data.nomeFantasia, data.logradouro, data.numero, data.complemento,
      data.bairro, data.cep, data.cidade, data.uf, data.nomeContato, data.telefone, data.email,
      data.situacaoCompras
    ];
    if (data.id) {
      if (!obterFornecedorPorId(data.id)) throw new ValidationError('O fornecedor selecionado não foi encontrado.');
      db.prepare(`
        UPDATE fornecedores SET cnpj = ?, data_abertura = ?, situacao_cadastral = ?, data_situacao_cadastral = ?,
          razao_social = ?, nome_fantasia = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cep = ?,
          cidade = ?, uf = ?, nome_contato = ?, telefone = ?, email = ?, situacao_compras = ?,
          data_ultima_alteracao = ?
        WHERE id = ?
      `).run(...values, now, data.id);
      return { status: 'ATUALIZADO', mensagem: 'Fornecedor atualizado com sucesso.', fornecedor: obterFornecedorPorId(data.id) };
    }

    const id = nextId(db, 'fornecedores', 'FOR');
    db.prepare(`
      INSERT INTO fornecedores (
        id, cnpj, data_abertura, situacao_cadastral, data_situacao_cadastral, razao_social, nome_fantasia,
        logradouro, numero, complemento, bairro, cep, cidade, uf, nome_contato, telefone, email,
        data_cadastro, data_ultima_alteracao, situacao_compras
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ...values.slice(0, 16), now, now, data.situacaoCompras);
    return { status: 'CRIADO', mensagem: 'Fornecedor cadastrado com sucesso.', fornecedor: obterFornecedorPorId(id) };
  }

  function excluirFornecedorSemCnpj(id) {
    const fornecedor = obterFornecedorPorId(id);
    if (!fornecedor) throw new ValidationError('Fornecedor não localizado.');
    if (fornecedor.cnpj !== CNPJ_SEM_DOCUMENTO) throw new ValidationError('Somente fornecedores sem CNPJ podem ser excluídos.');
    const now = isoNow();
    db.prepare('UPDATE fornecedores SET excluido_logicamente = 1, excluido_em = ?, data_ultima_alteracao = ? WHERE id = ?').run(now, now, id);
    return { ok: true };
  }

  return {
    listarCategoriasInsumos,
    salvarCategoriaInsumo,
    renomearCategoriaInsumo,
    listarInsumos,
    obterInsumoPorId,
    verificarPossivelDuplicidade,
    salvarInsumo,
    listarFornecedores,
    obterFornecedorPorId,
    salvarFornecedor,
    excluirFornecedorSemCnpj
  };
}

function validCnpj(cnpj) {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const valor = (caractere) => caractere.charCodeAt(0) - 48;
  const calculate = (length) => {
    let sum = 0;
    let position = length - 7;
    for (let i = length; i >= 1; i -= 1) {
      sum += valor(cnpj[length - i]) * position;
      position -= 1;
      if (position < 2) position = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

module.exports = {
  CATEGORIAS_INSUMOS,
  UNIDADES_INSUMOS,
  CNPJ_SEM_DOCUMENTO,
  ValidationError,
  createCadastrosService,
  normalizeCnpj,
  validCnpj
};
