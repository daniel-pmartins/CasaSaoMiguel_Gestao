const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/server/db');
const { createNormalizedFichaService } = require('../src/server/normalized-ficha');

function fichaForTest() {
  const db = createDatabase(':memory:');
  db.prepare(`INSERT INTO insumos (id, descricao, unidade, categoria, fc, controla_estoque) VALUES ('INS0001', 'FARINHA', 'G', 'INGREDIENTE', 1, 1)`).run();
  return { db, ficha: createNormalizedFichaService(db) };
}

test('cria ficha, categoria e versão normalizadas', () => {
  const { db, ficha } = fichaForTest();
  try {
    assert.deepEqual(ficha.saveCategory('BOLOS'), ['BOLOS']);
    const saved = ficha.save({ receita: { nome: 'BOLO TESTE', categoria: 'BOLOS', base: { qtd: '1', unidade: 'UN' }, componentes: [{ tipo: 'INSUMO', id: 'INS0001', quantidades: { BASE: '100' } }], variacoes: [], preparo: 'Misturar', observacoes: '' } }, false);
    assert.equal(saved.id, 'FT000001');
    assert.equal(saved.status, 'RASCUNHO');
    const activated = ficha.save({ id: saved.id, versao: saved.versao, receita: saved.receita }, true);
    assert.equal(activated.status, 'ATIVA');
    assert.equal(ficha.history(saved.id).length, 1);
    assert.equal(ficha.library().fichas.length, 1);
  } finally {
    db.close();
  }
});

test('salva custo manual e preços de ficha', () => {
  const { db, ficha } = fichaForTest();
  try {
    const saved = ficha.save({ nome: 'FT PREÇO', categoria: 'BOLOS', base: { qtd: '1', unidade: 'UN' }, componentes: [] }, false);
    assert.equal(ficha.saveManualCost('INS0001', '2,50', 'TESTE').valor, '2.50');
    assert.deepEqual(ficha.savePrices(saved.id, { BASE: '10,00' }), { BASE: '10,00' });
    assert.deepEqual(ficha.prices(saved.id), { BASE: '10,00' });
  } finally {
    db.close();
  }
});

test('converte custo informado por embalagem e valor pago', () => {
  const { db, ficha } = fichaForTest();
  try {
    const saved = ficha.saveManualCost('INS0001', '', 'CONVERSÃO TESTE', '500', '10,00');
    assert.equal(saved.valor, '0.02');
    assert.equal(saved.custoExato, '1/50');
    assert.equal(ficha.referenceManual('INS0001').manual, '0.02');
  } finally {
    db.close();
  }
});

test('lista todos os insumos sem custo de referência na prévia', () => {
  const { db, ficha } = fichaForTest();
  try {
    db.prepare("INSERT INTO insumos (id, descricao, unidade, categoria, fc, controla_estoque) VALUES ('INS0002', 'AÇÚCAR', 'G', 'INGREDIENTE', 1, 1)").run();
    const preview = ficha.preview({ nome: 'FT COM CUSTOS PENDENTES', categoria: 'BOLOS', base: { qtd: '1', unidade: 'UN' }, componentes: [
      { tipo: 'INSUMO', id: 'INS0001', quantidades: { BASE: '100' } },
      { tipo: 'INSUMO', id: 'INS0002', quantidades: { BASE: '50' } },
      { tipo: 'INSUMO', id: 'INS0001', quantidades: { BASE: '25' } }
    ], variacoes: [], preparo: '' });
    assert.deepEqual(preview[0].custosAusentes, [
      { id: 'INS0001', nome: 'FARINHA' },
      { id: 'INS0002', nome: 'AÇÚCAR' }
    ]);
  } finally {
    db.close();
  }
});

test('calcula prévia, resumo e simulação administrativa', () => {
  const { db, ficha } = fichaForTest();
  try {
    ficha.saveManualCost('INS0001', '2,50', 'CUSTO TESTE');
    const saved = ficha.save({ receita: { nome: 'FT CUSTO', categoria: 'BOLOS', base: { qtd: '1', unidade: 'UN' }, componentes: [{ tipo: 'INSUMO', id: 'INS0001', quantidades: { BASE: '100' } }], variacoes: [], preparo: '' } }, true);
    const preview = ficha.preview(saved.receita);
    assert.equal(preview[0].custoUnitario, '250');
    assert.equal(ficha.summary(saved.id).configuracoes[0].custoTotal, 'R$ 250,00');
    assert.equal(ficha.simulate(saved.id, [{ key: 'BASE', receitas: '2' }]).linhas[0].receitas, 2);
  } finally {
    db.close();
  }
});

test('preserva custo de alta precisão e arredonda a apresentação para cima', () => {
  const { db, ficha } = fichaForTest();
  try {
    ficha.saveManualCost('INS0001', '0,0812857142857143', 'CUSTO PRECISO');
    const preview = ficha.preview({ nome: 'FT PRECISA', categoria: 'BOLOS', base: { qtd: '1', unidade: 'UN' }, componentes: [{ tipo: 'INSUMO', id: 'INS0001', quantidades: { BASE: '1' } }], variacoes: [], preparo: '' });
    assert.equal(preview[0].custoUnitario, '0.0812857142857143');
    assert.equal(preview[0].custoUnitarioExibido, '0.09');
    assert.equal(preview[0].custoTotal, 'R$ 0,09');
  } finally {
    db.close();
  }
});
