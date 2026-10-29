const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/server/db');
const { createNormalizedStockService, parseMilli, fractionText, parseFraction } = require('../src/server/normalized-stock');

function stockForTest() {
  const db = createDatabase(':memory:');
  db.prepare(`
    INSERT INTO insumos (id, descricao, unidade, categoria, fc, controla_estoque)
    VALUES ('INS0001', 'FARINHA', 'G', 'INGREDIENTE', 1, 1)
  `).run();
  return { db, stock: createNormalizedStockService(db) };
}

function initializedStockForTest() {
  const context = stockForTest();
  context.stock.registerManualMovement({
    direcao: 'ENTRADA',
    justificativa: 'AQUISICAO TESTE',
    itens: [{ id: 'INS0001', quantidade: '2,500', tamanho: '1', unidade: 'G', precoUnitario: '1,00' }]
  });
  const opened = context.stock.openInventory('INVENTARIO');
  context.stock.saveCounts(opened.id, [{
    id: 'INS0001', contagem: '2,500', compensar: 'SIM'
  }]);
  context.stock.markCounts(opened.id, ['INS0001']);
  context.stock.finalizeInventory(opened.id);
  return context;
}

test('preserva frações e converte quantidades em milésimos', () => {
  assert.equal(fractionText(parseFraction('1/2')), '1/2');
  assert.equal(fractionText(parseFraction('0,25')), '1/4');
  assert.equal(String(parseMilli('1,250')), '1250');
});

test('abre inventário periódico e grava contagem no banco normalizado', () => {
  const { db, stock } = stockForTest();
  try {
    stock.registerManualMovement({
      direcao: 'ENTRADA',
      justificativa: 'AQUISICAO TESTE',
      itens: [{ id: 'INS0001', quantidade: '2,500', tamanho: '1', unidade: 'G', precoUnitario: '1,00' }]
    });
    const opened = stock.openInventory('INVENTARIO');
    assert.equal(opened.id, 'INV000001');
    stock.saveCounts(opened.id, [{ id: 'INS0001', contagem: '2,500', compensar: 'SIM' }]);
    stock.markCounts(opened.id, ['INS0001']);
    const data = stock.inventoryData(opened.id);
    assert.equal(data.itens.length, 1);
    assert.equal(data.itens[0].contagem, '2.5');
    assert.equal(data.itens[0].gravado, true);
  } finally {
    db.close();
  }
});

test('abre inventário periódico sem inventário inicial', () => {
  const { db, stock } = stockForTest();
  try {
    const opened = stock.openInventory('INVENTARIO');
    assert.equal(opened.tipo, 'INVENTARIO');
  } finally {
    db.close();
  }
});

test('finaliza inventário periódico e preserva movimentação normalizada', () => {
  const { db, stock } = stockForTest();
  try {
    stock.registerManualMovement({
      direcao: 'ENTRADA',
      justificativa: 'AQUISICAO TESTE',
      itens: [{ id: 'INS0001', quantidade: '2,500', tamanho: '1', unidade: 'G', precoUnitario: '1,00' }]
    });
    const opened = stock.openInventory('INVENTARIO');
    stock.saveCounts(opened.id, [{
      id: 'INS0001',
      contagem: '2,500',
      compensar: 'SIM'
    }]);
    stock.markCounts(opened.id, ['INS0001']);
    assert.equal(stock.previewFinalization(opened.id).valorInicial, '');
    const finalized = stock.finalizeInventory(opened.id);
    assert.equal(finalized.ok, true);
    assert.equal(stock.status().inventarioInicialNecessario, false);
    assert.equal(stock.listMovements().length, 1);
    assert.equal(stock.status().saldos[0].quantidadeMili, '2500');
  } finally {
    db.close();
  }
});

test('cancela inventário aberto com justificativa', () => {
  const { db, stock } = stockForTest();
  try {
    const opened = stock.openInventory('INVENTARIO');
    assert.deepEqual(stock.cancelInventory(opened.id, 'AJUSTE DE TESTE'), { ok: true });
    assert.equal(stock.listInventories()[0].status, 'CANCELADO');
  } finally {
    db.close();
  }
});

test('registra entrada e saída manual com custo normalizado', () => {
  const { db, stock } = initializedStockForTest();
  try {
    assert.equal(stock.referenceCost('INS0001').custoExibido, '1');
    stock.registerManualMovement({
      direcao: 'ENTRADA',
      justificativa: 'REPOSIÇÃO TESTE',
      itens: [{ id: 'INS0001', quantidade: '1', tamanho: '1', unidade: 'G', precoUnitario: '2,00' }]
    });
    assert.equal(stock.status().saldos[0].quantidadeMili, '3500');
    stock.registerManualMovement({
      direcao: 'SAÍDA',
      motivo: 'PRODUÇÃO MANUAL',
      justificativa: 'CONSUMO TESTE',
      itens: [{ id: 'INS0001', quantidade: '0,5', tamanho: '1', unidade: 'G' }]
    });
    assert.equal(stock.status().saldos[0].quantidadeMili, '3000');
    assert.equal(stock.listMovements().length, 3);
  } finally {
    db.close();
  }
});

test('salva detalhes de contagem e expõe as embalagens ativas', () => {
  const { db, stock } = initializedStockForTest();
  try {
    const opened = stock.openInventory('INVENTARIO');
    const result = stock.saveCountDetails(opened.id, 'INS0001', [{ quantidade: '2', tamanho: '1', unidade: 'G' }], 'SIM');
    assert.equal(result.quantidade, '2');
    const data = stock.inventoryData(opened.id);
    assert.equal(data.itens[0].detalhesCount, 1);
    assert.equal(data.itens[0].detalhes[0].quantidade, '2');
  } finally {
    db.close();
  }
});

test('corrige saldo e preserva o ajuste no histórico', () => {
  const { db, stock } = initializedStockForTest();
  try {
    const result = stock.correctBalance({ id: 'INS0001', quantidade: '3', saldoReferencialMili: '2500', compensar: 'SIM', justificativa: 'CONFERÊNCIA TESTE' });
    assert.equal(result.novo, '3');
    assert.equal(stock.status().saldos[0].quantidadeMili, '3000');
    assert.equal(stock.listMovements().length, 2);
  } finally {
    db.close();
  }
});

test('persiste ciclo de rascunho de saída', () => {
  const { db, stock } = initializedStockForTest();
  try {
    const saved = stock.saveExitDraft('', { direcao: 'SAÍDA', motivo: 'PRODUÇÃO MANUAL', referencia: 'TESTE', itens: [{ id: 'INS0001', quantidade: '1', tamanho: '1', unidade: 'G' }] });
    assert.equal(saved.id, 'RSM000001');
    assert.equal(stock.listExitDrafts()[0].itens, 1);
    assert.equal(stock.openExitDraft(saved.id).dados.itens[0].id, 'INS0001');
    assert.deepEqual(stock.discardExitDraft(saved.id), { ok: true });
    assert.equal(stock.listExitDrafts().length, 0);
  } finally {
    db.close();
  }
});

test('gera relatório PDF local de inventário encerrado', () => {
  const { db, stock } = initializedStockForTest();
  try {
    const result = stock.pdfInventory('INV000001');
    assert.equal(result.nome, 'CasaSaoMiguel_Inventario_INV000001.pdf');
    assert.equal(result.base64.startsWith('JVBERi0xLjQ'), true);
  } finally {
    db.close();
  }
});
