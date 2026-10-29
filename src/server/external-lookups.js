const { normalizeCnpj, validCnpj } = require('./cadastros');

const CNPJ_WITHOUT_DOCUMENT = '00000000000000';

function digits(value) { return String(value ?? '').replace(/\D/g, ''); }
function clean(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }

async function requestJson(url, fetchImpl = fetch, provider = 'serviço externo') {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('Não foi possível acessar a BrasilAPI. Tente novamente.');
  }
  if (response.status === 404) throw new Error(`Registro não localizado no ${provider}.`);
  if (response.status === 400) throw new Error(`O ${provider} recusou o valor informado.`);
  if (response.status === 429 || response.status >= 500) throw new Error(`O ${provider} está temporariamente indisponível.`);
  if (!response.ok) throw new Error(`Não foi possível consultar o ${provider} (HTTP ${response.status}).`);
  try { return await response.json(); } catch { throw new Error(`O ${provider} retornou dados inválidos.`); }
}

async function lookupCep(value, fetchImpl = fetch) {
  const cep = digits(value);
  if (!/^\d{8}$/.test(cep)) throw new Error('O CEP deve ter exatamente 8 dígitos.');
  const data = await requestJson(`https://brasilapi.com.br/api/cep/v1/${cep}`, fetchImpl, 'BrasilAPI');
  if (digits(data.cep) !== cep) throw new Error('A BrasilAPI não confirmou o CEP informado.');
  return {
    cep,
    logradouro: clean(data.street, 200),
    bairro: clean(data.neighborhood, 120),
    cidade: clean(data.city, 120),
    uf: clean(data.state, 2).toUpperCase()
  };
}

function fornecedorCnpjWs(data, cnpj) {
  const estabelecimento = data?.estabelecimento;
  if (!estabelecimento || normalizeCnpj(estabelecimento.cnpj) !== cnpj || !data.razao_social) {
    throw new Error('O CNPJ.ws não retornou os dados cadastrais esperados.');
  }
  return {
    cnpj,
    dataAbertura: clean(estabelecimento.data_inicio_atividade, 20),
    situacao: clean(estabelecimento.situacao_cadastral, 80),
    dataSituacao: clean(estabelecimento.data_situacao_cadastral, 20),
    razaoSocial: clean(data.razao_social, 200),
    nomeFantasia: clean(estabelecimento.nome_fantasia, 200),
    logradouro: clean([estabelecimento.tipo_logradouro, estabelecimento.logradouro].filter(Boolean).join(' '), 200),
    numero: clean(estabelecimento.numero, 30),
    complemento: clean(estabelecimento.complemento, 120),
    bairro: clean(estabelecimento.bairro, 120),
    cep: digits(estabelecimento.cep).slice(0, 8),
    cidade: clean(estabelecimento.cidade?.nome, 120),
    uf: clean(estabelecimento.estado?.sigla, 2).toUpperCase(),
    telefone: digits(String(estabelecimento.ddd1 || '') + String(estabelecimento.telefone1 || estabelecimento.telefone2 || '')).slice(0, 11),
    email: clean(estabelecimento.email, 200)
  };
}

async function lookupCnpjWs(cnpj, fetchImpl) {
  const data = await requestJson(`https://publica.cnpj.ws/cnpj/${cnpj}`, fetchImpl, 'CNPJ.ws');
  return { status: 'CONSULTADO', fornecedor: fornecedorCnpjWs(data, cnpj) };
}

async function lookupCnpjBrasilApi(cnpj, fetchImpl) {
  const data = await requestJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, fetchImpl, 'BrasilAPI');
  if (normalizeCnpj(data.cnpj) !== cnpj || !data.razao_social) throw new Error('A BrasilAPI não retornou os dados cadastrais esperados.');
  return {
    status: 'CONSULTADO',
    fornecedor: {
      cnpj,
      dataAbertura: clean(data.data_inicio_atividade, 20),
      situacao: clean(data.descricao_situacao_cadastral, 80),
      dataSituacao: clean(data.data_situacao_cadastral, 20),
      razaoSocial: clean(data.razao_social, 200),
      nomeFantasia: clean(data.nome_fantasia, 200),
      logradouro: clean([data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' '), 200),
      numero: clean(data.numero, 30),
      complemento: clean(data.complemento, 120),
      bairro: clean(data.bairro, 120),
      cep: digits(data.cep).slice(0, 8),
      cidade: clean(data.municipio, 120),
      uf: clean(data.uf, 2).toUpperCase(),
      telefone: digits(data.ddd_telefone_1 || data.ddd_telefone_2).slice(0, 11),
      email: clean(data.email, 200)
    }
  };
}

async function lookupCnpj(value, existing, fetchImpl = fetch) {
  const cnpj = normalizeCnpj(value);
  if (cnpj === CNPJ_WITHOUT_DOCUMENT) return { status: 'SEM_CNPJ' };
  if (cnpj.length !== 14 || !validCnpj(cnpj)) throw new Error('CNPJ inválido.');
  if (existing) return { status: 'EXISTENTE', fornecedor: existing };
  let erroCnpjWs;
  try {
    return await lookupCnpjWs(cnpj, fetchImpl);
  } catch (error) {
    erroCnpjWs = error;
  }
  try {
    return await lookupCnpjBrasilApi(cnpj, fetchImpl);
  } catch (error) {
    throw new Error(`${erroCnpjWs.message} ${error.message}`);
  }
}

module.exports = { lookupCep, lookupCnpj, CNPJ_WITHOUT_DOCUMENT };
