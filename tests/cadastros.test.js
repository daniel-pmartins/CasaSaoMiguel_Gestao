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
