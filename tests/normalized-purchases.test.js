const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/server/db');
const { createNormalizedPurchaseService } = require('../src/server/normalized-purchases');
const { createNormalizedStockService } = require('../src/server/normalized-stock');

function purchasesForTest() {
  const db = createDatabase(':memory:');
  db.prepare(`
    INSERT INTO insumos (id, descricao, unidade, categoria, fc, controla_estoque)
    VALUES ('INS0001', 'FARINHA', 'G', 'INGREDIENTE', 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO fornecedores (id, cnpj, razao_social, situacao_compras)
    VALUES ('FOR0001', '00000000000000', 'FORNECEDOR TESTE', 'ATIVO')
  `).run();
  return { db, purchases: createNormalizedPurchaseService(db) };
}

test('consulta base normalizada de compras', () => {
  const { db, purchases } = purchasesForTest();
  try {
    const data = purchases.initialData();
    assert.equal(data.fornecedores[0].id, 'FOR0001');
    assert.equal(data.insumos[0].id, 'INS0001');
    assert.deepEqual(purchases.query('PENDENTES', '', '', ''), []);
  } finally {
    db.close();
  }
});

test('localiza fornecedor por CNPJ alfanumérico antes de abrir o cadastro', () => {
  const { db, purchases } = purchasesForTest();
  try {
    db.prepare(`
      INSERT INTO fornecedores (id, cnpj, razao_social, situacao_compras)
      VALUES ('FOR0002', 'AB12CD34000184', 'FORNECEDOR ALFA', 'ATIVO')
    `).run();
    assert.deepEqual(purchases.verifySupplierCnpj('AB.12C.D34/0001-84'), {
      status: 'EXISTENTE',
      fornecedor: { id: 'FOR0002', cnpj: 'AB12CD34000184', nome: 'FORNECEDOR ALFA', nomeFantasia: '' }
    });
    assert.deepEqual(purchases.verifySupplierCnpj('XY98ZT76000168'), { status: 'NAO_LOCALIZADO' });
  } finally {
    db.close();
  }
});

test('persiste rascunho normalizado de compra', () => {
  const { db, purchases } = purchasesForTest();
  try {
    const saved = purchases.saveDraft('', { fornecedorNome: 'FORNECEDOR TESTE', itens: [{ descricao: 'FARINHA' }] });
    assert.equal(saved.id, 'RAS000001');
    assert.equal(purchases.listDrafts()[0].fornecedor, 'FORNECEDOR TESTE');
    assert.deepEqual(purchases.openDraft(saved.id), { fornecedorNome: 'FORNECEDOR TESTE', itens: [{ descricao: 'FARINHA' }] });
    assert.deepEqual(purchases.discardDraft(saved.id), { ok: true });
    assert.equal(purchases.listDrafts().length, 0);
  } finally {
    db.close();
  }
});

test('grava compra normalizada com item e pagamento', () => {
  const { db, purchases } = purchasesForTest();
  try {
    const saved = purchases.savePurchase({
      origem: 'MANUAL',
      fornecedorId: 'FOR0001',
      numero: '10',
      serie: '1',
      emissao: '2026-10-27',
      totalNota: '10,00',
      frete: '0,00',
      desconto: '0,00',
      outrosXml: '0,00',
      externos: '0,00',
      itens: [{ id: 'IT0001', descricao: 'FARINHA', qtd: '1', preco: '10,00', valorTotal: '10,00', insumoId: 'INS0001' }],
      pagamentos: [{ forma: 'PIX', valor: '10,00', vencimento: '2026-10-27', pago: true, referencia: 'FORNECEDOR' }]
    });
    assert.equal(saved.status, 'PENDENTE');
    assert.equal(purchases.get(saved.id).itens[0].insumoId, 'INS0001');
    assert.equal(purchases.get(saved.id).pagamentos[0].valor, '10,00');
  } finally {
    db.close();
  }
});

test('recebe compra e atualiza estoque normalizado', () => {
  const { db, purchases } = purchasesForTest();
  const stock = createNormalizedStockService(db);
  try {
    const saved = purchases.savePurchase({
      origem: 'MANUAL', fornecedorId: 'FOR0001', numero: '11', totalNota: '10,00', frete: '0,00', desconto: '0,00', outrosXml: '0,00', externos: '0,00',
      itens: [{ id: 'IT0001', descricao: 'FARINHA', qtd: '1', preco: '10,00', valorTotal: '10,00', insumoId: 'INS0001' }],
      pagamentos: [{ forma: 'PIX', valor: '10,00', vencimento: '2026-10-27', pago: true, referencia: 'FORNECEDOR' }]
    });
    const received = purchases.receive(saved.id, [{ itemId: 'IT0001', quantidade: '1', insumoId: 'INS0001', embalagem: '1', unidade: 'G' }]);
    assert.equal(received.status, 'RECEBIDA');
    assert.equal(stock.status().saldos[0].quantidadeMili, '1000');
    assert.equal(purchases.get(saved.id).itens[0].recebida, '1');
  } finally {
    db.close();
  }
});

test('cancela saldo pendente e gera crédito normalizado', () => {
  const { db, purchases } = purchasesForTest();
  try {
    const saved = purchases.savePurchase({
      origem: 'MANUAL', fornecedorId: 'FOR0001', numero: '12', totalNota: '10,00', frete: '0,00', desconto: '0,00', outrosXml: '0,00', externos: '0,00',
      itens: [{ id: 'IT0001', descricao: 'FARINHA', qtd: '1', preco: '10,00', valorTotal: '10,00', insumoId: 'INS0001' }],
      pagamentos: [{ forma: 'PIX', valor: '10,00', vencimento: '2026-10-27', pago: false, referencia: 'FORNECEDOR' }]
    });
    const result = purchases.cancelPending({ id: saved.id, itemId: 'IT0001', quantidade: '1', destino: 'CREDITO', justificativa: 'CANCELAMENTO TESTE' });
    assert.equal(result.status, 'CONCLUIDA_COM_CANCELAMENTO');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compras_creditos').get().count, 1);
  } finally {
    db.close();
  }
});
