const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupCep, lookupCnpj } = require('../src/server/external-lookups');

function fakeFetch(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
}

test('normaliza resposta de CEP', async () => {
  const result = await lookupCep('01001-000', fakeFetch({ cep: '01001-000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' }));
  assert.deepEqual(result, { cep: '01001000', logradouro: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' });
});

test('normaliza resposta de CNPJ e reconhece existente', async () => {
  const payload = { cnpj: '11222333000181', razao_social: 'Empresa Teste', nome_fantasia: 'Teste', municipio: 'São Paulo', uf: 'SP' };
  const result = await lookupCnpj(payload.cnpj, null, fakeFetch(payload));
  assert.equal(result.status, 'CONSULTADO');
  assert.equal(result.fornecedor.razaoSocial, 'Empresa Teste');
  const existing = await lookupCnpj(payload.cnpj, { id: 'FOR0001' }, fakeFetch(payload));
  assert.equal(existing.status, 'EXISTENTE');
});

test('aceita CNPJ alfanumérico na consulta externa', async () => {
  const payload = { cnpj: 'AB12CD34000184', razao_social: 'Empresa Alfa', nome_fantasia: 'Alfa' };
  const result = await lookupCnpj('AB.12C.D34/0001-84', null, fakeFetch(payload));
  assert.equal(result.status, 'CONSULTADO');
  assert.equal(result.fornecedor.cnpj, 'AB12CD34000184');
});

test('normaliza resposta do CNPJ.ws para o cadastro de fornecedor', async () => {
  const payload = {
    razao_social: 'Empresa CNPJ WS',
    estabelecimento: {
      cnpj: '12539517000485',
      data_inicio_atividade: '2013-06-28',
      situacao_cadastral: 'Ativa',
      data_situacao_cadastral: '2013-06-28',
      nome_fantasia: null,
      tipo_logradouro: 'AVENIDA',
      logradouro: 'DONA BELMIRA MARIN',
      numero: '4225',
      bairro: 'JARDIM ELIANA',
      cep: '04846010',
      cidade: { nome: 'São Paulo' },
      estado: { sigla: 'SP' },
      ddd1: '11',
      telefone1: '30537000',
      email: 'contato@empresa.test'
    }
  };
  const result = await lookupCnpj(payload.estabelecimento.cnpj, null, fakeFetch(payload));
  assert.equal(result.fornecedor.razaoSocial, 'Empresa CNPJ WS');
  assert.equal(result.fornecedor.logradouro, 'AVENIDA DONA BELMIRA MARIN');
  assert.equal(result.fornecedor.telefone, '1130537000');
});
