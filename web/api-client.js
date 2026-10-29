(() => {
  function requestJson(url, options = {}) {
    return fetch(url, {
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha na chamada local.');
      return payload;
    });
  }

  function normalizedRequest(name, args) {
    const id = (value) => encodeURIComponent(String(value || ''));
    const inventory = (value) => `/api/v2/estoque/inventarios/${id(value)}`;
    switch (name) {
      case 'estoqueSituacao': return requestJson('/api/v2/estoque');
      case 'estoqueListarInventarios': return requestJson('/api/v2/estoque/inventarios');
      case 'estoqueAbrirInventario': return requestJson('/api/v2/estoque/inventarios', { method: 'POST', body: JSON.stringify({ tipo: args[0] }) });
      case 'estoqueDadosInventario': return requestJson(inventory(args[0]));
      case 'estoqueSalvarContagens': return requestJson(`${inventory(args[0])}/contagens`, { method: 'POST', body: JSON.stringify({ alteracoes: args[1] }) });
      case 'estoqueSalvarDetalhesContagem': return requestJson(`${inventory(args[0])}/detalhes`, { method: 'POST', body: JSON.stringify({ insumoId: args[1], linhas: args[2], compensar: args[3], momento: args[4] }) });
      case 'estoqueGravarContagens': return requestJson(`${inventory(args[0])}/contagens/gravar`, { method: 'POST', body: JSON.stringify({ ids: args[1] }) });
      case 'estoqueReabrirContagem': return requestJson(`${inventory(args[0])}/contagens/${id(args[1])}/reabrir`, { method: 'POST', body: '{}' });
      case 'estoquePreviaFinalizacao': return requestJson(`${inventory(args[0])}/previa`);
      case 'estoqueFinalizarInventario': return requestJson(`${inventory(args[0])}/finalizar`, { method: 'POST', body: '{}' });
      case 'estoqueCancelarInventario': return requestJson(`${inventory(args[0])}/cancelar`, { method: 'POST', body: JSON.stringify({ justificativa: args[1] }) });
      case 'estoquePdfInventario': return requestJson(`${inventory(args[0])}/pdf`);
      case 'estoqueListarMovimentacoes': return requestJson('/api/v2/estoque/movimentacoes');
      case 'estoqueDetalhesMovimentacao': return requestJson(`/api/v2/estoque/movimentacoes/${id(args[0])}`);
      case 'estoqueReferenciaCustoInsumo': return requestJson(`/api/v2/estoque/custos/${id(args[0])}`);
      case 'estoqueDadosMovimentacaoManual': return requestJson(`/api/v2/estoque/movimentacoes/dados?tipo=${id(args[0])}`);
      case 'estoqueRegistrarMovimentacaoManual': return requestJson('/api/v2/estoque/movimentacoes', { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'estoqueCorrigirSaldoManual': return requestJson('/api/v2/estoque/corrigir-saldo', { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'estoqueRascunhoSaidaSalvar': return requestJson('/api/v2/estoque/rascunhos-saida', { method: 'POST', body: JSON.stringify({ id: args[0], dados: args[1] }) });
      case 'estoqueRascunhosSaidaListar': return requestJson('/api/v2/estoque/rascunhos-saida');
      case 'estoqueRascunhoSaidaAbrir': return requestJson(`/api/v2/estoque/rascunhos-saida/${id(args[0])}`);
      case 'estoqueRascunhoSaidaDescartar': return requestJson(`/api/v2/estoque/rascunhos-saida/${id(args[0])}/descartar`, { method: 'POST', body: '{}' });
      case 'estoqueConferirSaidaManual': return requestJson('/api/v2/estoque/conferir-saida', { method: 'POST', body: JSON.stringify({ itens: args[0] }) });
      case 'listarCategoriasInsumos': return requestJson('/api/cadastros/categorias');
      case 'listarInsumos': return requestJson('/api/insumos');
      case 'obterInsumoPorId': return requestJson(`/api/insumos/${id(args[0])}`);
      case 'listarInsumosPorCategoria': return requestJson(`/api/insumos?categoria=${id(args[0])}`);
      case 'verificarPossivelDuplicidade': return requestJson(`/api/insumos/duplicidade?descricao=${id(args[0])}&idAtual=${id(args[1])}`);
      case 'salvarInsumo': return requestJson(`/api/insumos${args[1] ? '?forcarNovo=1' : ''}`, { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'listarFornecedores': return requestJson(`/api/fornecedores${args[0] ? '?incluirExcluidos=1' : ''}`);
      case 'obterFornecedorPorId': return requestJson(`/api/fornecedores/${id(args[0])}`);
      case 'pesquisarFornecedores': return requestJson(`/api/fornecedores?q=${id(args[0])}`);
      case 'salvarFornecedor': return requestJson(`/api/fornecedores${args[1] ? '?forcarDuplicidade=1' : ''}`, { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'excluirFornecedorSemCnpj': return requestJson(`/api/fornecedores/${id(args[0])}`, { method: 'DELETE' });
      case 'comprasVerificarCnpj': return requestJson(`/api/v2/compras/verificar-cnpj?cnpj=${id(args[0])}`);
      case 'comprasDadosIniciais': return requestJson('/api/v2/compras');
      case 'comprasConsulta': return requestJson(`/api/v2/compras/consulta?aba=${id(args[0])}&termo=${id(args[1])}&inicio=${id(args[2])}&fim=${id(args[3])}`);
      case 'comprasObter': return requestJson(`/api/v2/compras/${id(args[0])}`);
      case 'comprasGravar': return requestJson('/api/v2/compras', { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'comprasReceber': return requestJson(`/api/v2/compras/${id(args[0])}/receber`, { method: 'POST', body: JSON.stringify({ itens: args[1] }) });
      case 'comprasCancelarPendente': return requestJson(`/api/v2/compras/${id(args[0]?.id)}/cancelar`, { method: 'POST', body: JSON.stringify(args[0] || {}) });
      case 'comprasRascunhoSalvar': return requestJson('/api/v2/compras/rascunhos', { method: 'POST', body: JSON.stringify({ id: args[0], dados: args[1] }) });
      case 'comprasRascunhosListar': return requestJson('/api/v2/compras/rascunhos');
      case 'comprasRascunhoAbrir': return requestJson(`/api/v2/compras/rascunhos/${id(args[0])}`);
      case 'comprasRascunhoDescartar': return requestJson(`/api/v2/compras/rascunhos/${id(args[0])}/descartar`, { method: 'POST', body: '{}' });
      case 'consultarCepFornecedor': return requestJson(`/api/v2/fornecedores/cep?cep=${id(args[0])}`);
      case 'consultarCnpjFornecedor': return requestJson(`/api/v2/fornecedores/cnpj?cnpj=${id(args[0])}`);
      case 'ftListar': return requestJson('/api/v2/ficha');
      case 'ftObter': return requestJson(`/api/v2/ficha/${id(args[0])}${args[1] ? `?versao=${id(args[1])}` : ''}`);
      case 'ftBiblioteca': return requestJson('/api/v2/ficha/biblioteca');
      case 'ftListarCategorias': return requestJson('/api/v2/ficha/categorias');
      case 'ftSalvarCategoria': return requestJson('/api/v2/ficha/categorias', { method: 'POST', body: JSON.stringify({ nome: args[0] }) });
      case 'ftRenomearCategoria': return requestJson('/api/v2/ficha/categorias/renomear', { method: 'POST', body: JSON.stringify({ anterior: args[0], novo: args[1] }) });
      case 'ftSalvar': return requestJson('/api/v2/ficha', { method: 'POST', body: JSON.stringify({ dados: args[0], ativar: args[1] }) });
      case 'ftAlterarSituacao': return requestJson(`/api/v2/ficha/${id(args[0])}/status`, { method: 'POST', body: JSON.stringify({ status: args[1] }) });
      case 'ftExcluirRascunho': return requestJson(`/api/v2/ficha/${id(args[0])}/excluir`, { method: 'POST', body: '{}' });
      case 'ftHistorico': return requestJson(`/api/v2/ficha/${id(args[0])}/historico`);
      case 'ftCompararVersoes': return requestJson(`/api/v2/ficha/${id(args[0])}/comparar?v1=${id(args[1])}&v2=${id(args[2])}`);
      case 'ftImpactoInsumo': return requestJson(`/api/v2/ficha/impacto/${id(args[0])}`);
      case 'ftConsultaReferenciaManual': return requestJson(`/api/v2/ficha/referencia/${id(args[0])}`);
      case 'ftSalvarCustoManual': return requestJson('/api/v2/ficha/custos', { method: 'POST', body: JSON.stringify({ insumoId: args[0], valor: args[1], observacao: args[2], embalagem: args[3], valorPago: args[4] }) });
      case 'ftPrecosConsultar': return requestJson(`/api/v2/ficha/${id(args[0])}/precos`);
      case 'ftPrecosSalvar': return requestJson(`/api/v2/ficha/${id(args[0])}/precos`, { method: 'POST', body: JSON.stringify({ valores: args[1] }) });
      case 'ftPrevia': return requestJson('/api/v2/ficha/previa', { method: 'POST', body: JSON.stringify({ dados: args[0] }) });
      case 'ftResumo': return requestJson(`/api/v2/ficha/${id(args[0])}/resumo`);
      case 'ftSimular': return requestJson(`/api/v2/ficha/${id(args[0])}/simular`, { method: 'POST', body: JSON.stringify({ configuracoes: args[1] }) });
      default: return null;
    }
  }

  function call(name, args = []) {
    const request = normalizedRequest(name, args);
    if (!request) return Promise.reject(new Error(`Ação de API não implementada: ${name}`));
    return request;
  }

  function createRunner(successHandler = null, failureHandler = null) {
    return new Proxy({}, {
      get(_target, property) {
        if (property === 'call') return (name, ...args) => call(name, args);
        if (property === 'withSuccessHandler') return (handler) => createRunner(handler, failureHandler);
        if (property === 'withFailureHandler') return (handler) => createRunner(successHandler, handler);
        if (typeof property !== 'string') return undefined;
        return (...args) => call(property, args)
          .then((payload) => {
            if (successHandler) successHandler(payload);
            return payload;
          })
          .catch((error) => {
            if (failureHandler) failureHandler(error);
            else console.error(error);
            throw error;
          });
      }
    });
  }

  const localApi = createRunner();
  window.localApi = localApi;
  window.nativeApi = localApi;
})();
