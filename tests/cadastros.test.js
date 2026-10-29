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
