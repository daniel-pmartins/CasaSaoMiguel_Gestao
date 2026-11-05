const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/server/db');
const { createCadastrosService, validCnpj } = require('../src/server/cadastros');

function serviceForTest() {
  const db = createDatabase(':memory:');
  return { db, service: createCadastrosService(db) };
}

test('valida CNPJ conhecido', () => {
  assert.equal(validCnpj('11222333000181'), true);
  assert.equal(validCnpj('11222333000182'), false);
  assert.equal(validCnpj('AB12CD34000184'), true);
});

test('cria, lista e detecta duplicidade de insumo', () => {
  const { db, service } = serviceForTest();
  try {
    const created = service.salvarInsumo({
      descricao: '  Farinha de trigo  ',
      unidade: 'G',
      categoria: 'INGREDIENTE',
      fc: '1,05',
      controlaEstoque: 'SIM'
    });
    assert.equal(created.status, 'CRIADO');
    assert.equal(created.insumo.id, 'INS0001');
    assert.equal(created.insumo.descricao, 'FARINHA DE TRIGO');
    assert.equal(created.insumo.conversao, 'NÃO');
    assert.equal(created.insumo.fatorConversaoGml, '');
    assert.equal(service.listarInsumos().length, 1);

    const duplicate = service.salvarInsumo({
      descricao: 'farinha de trigo',
      unidade: 'G',
      categoria: 'INGREDIENTE',
      fc: 1,
      controlaEstoque: true
    });
    assert.equal(duplicate.status, 'POSSIVEL_DUPLICIDADE');
  } finally {
    db.close();
  }
});

test('aceita qualquer categoria oficial, inclusive categorias com acentos', () => {
  const { db, service } = serviceForTest();
  try {
    const categorias = service.listarCategoriasInsumos();
    categorias.forEach((categoria, index) => {
      const created = service.salvarInsumo({
        descricao: `INSUMO DA CATEGORIA ${index + 1}`,
        unidade: 'UN',
        categoria,
        fc: 1,
        controlaEstoque: 'NÃO'
      }, true);
      assert.equal(created.insumo.categoria, categoria);
    });
    const semAcento = service.salvarInsumo({
      descricao: 'PAPEL TOALHA SEM ACENTO',
      unidade: 'UN',
      categoria: 'DESCARTAVEL',
      fc: 1,
      controlaEstoque: 'NÃO'
    });
    assert.equal(semAcento.insumo.categoria, 'DESCARTAVEL');
  } finally {
    db.close();
  }
});

test('migra categorias sem acentos e permite cadastrar e renomear categorias', () => {
  const db = createDatabase(':memory:');
  db.prepare(`
    INSERT INTO insumos (
      id, data_cadastro, data_ultima_alteracao, descricao, unidade, observacao, categoria, fc,
      controla_estoque, conversao_ativa, fator_conversao_g_ml
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('INS0001', '2026-11-05', '2026-11-05', 'PAPEL TOALHA', 'UN', '', 'DESCARTÁVEL', 1, 0, 0, 0);
  const service = createCadastrosService(db);
  try {
    assert.ok(service.listarCategoriasInsumos().includes('DESCARTAVEL'));
    assert.equal(service.obterInsumoPorId('INS0001').categoria, 'DESCARTAVEL');

    const criada = service.salvarCategoriaInsumo('HIGIÊNE E LIMPEZA');
    assert.equal(criada.categoria, 'HIGIENE E LIMPEZA');
    const item = service.salvarInsumo({
      descricao: 'PANO DE LIMPEZA', unidade: 'UN', categoria: criada.categoria, fc: 1, controlaEstoque: 'NÃO'
    }, true);
    const renomeada = service.renomearCategoriaInsumo(criada.categoria, 'HIGIENE');
    assert.equal(renomeada.categoria, 'HIGIENE');
    assert.equal(service.obterInsumoPorId(item.insumo.id).categoria, 'HIGIENE');

    service.renomearCategoriaInsumo('INGREDIENTE', 'MATERIA PRIMA');
    const serviceAfterRestart = createCadastrosService(db);
    assert.ok(!serviceAfterRestart.listarCategoriasInsumos().includes('INGREDIENTE'));
    assert.ok(serviceAfterRestart.listarCategoriasInsumos().includes('MATERIA PRIMA'));
  } finally {
    db.close();
  }
});

test('salva fator opcional de conversão G/ML', () => {
  const { db, service } = serviceForTest();
  try {
    const created = service.salvarInsumo({
      descricao: 'ÓLEO DE SOJA', unidade: 'G', categoria: 'INGREDIENTE', fc: 1,
      controlaEstoque: 'NÃO', conversao: 'SIM', fatorConversaoGml: '0,920'
    });
    assert.equal(created.insumo.conversao, 'SIM');
    assert.equal(created.insumo.fatorConversaoGml, 0.92);
    const updated = service.salvarInsumo({ ...created.insumo, conversao: 'NÃO', fatorConversaoGml: '' }, true);
    assert.equal(updated.insumo.conversao, 'NÃO');
    assert.equal(updated.insumo.fatorConversaoGml, '');
  } finally {
    db.close();
  }
});

test('cria fornecedor e bloqueia CNPJ inválido', () => {
  const { db, service } = serviceForTest();
  try {
    const created = service.salvarFornecedor({
      cnpj: '11222333000181',
      razaoSocial: 'Fornecedor de Teste',
      uf: 'sp'
    });
    assert.equal(created.status, 'CRIADO');
    assert.equal(created.fornecedor.id, 'FOR0001');
    assert.equal(created.fornecedor.uf, 'SP');
    assert.throws(() => service.salvarFornecedor({ cnpj: '11222333000182', razaoSocial: 'Inválido' }), /CNPJ inválido/);
  } finally {
    db.close();
  }
});
