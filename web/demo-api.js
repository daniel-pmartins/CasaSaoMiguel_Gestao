/* Casa São Miguel | Simulação do Sistema | API local somente leitura */
(function () {
  'use strict';

  const readOnlyMessage = 'A Simulação do Sistema é somente leitura. Nenhuma alteração foi gravada.';
  const categorias = ['INGREDIENTE', 'EMBALAGEM', 'DESCARTÁVEL', 'PREPARO'];
  const categoriasFicha = ['COOKIES RECHEADOS'];
  const insumos = [
    { id: 'INS0001', descricao: 'NUTELLA', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.08 },
    { id: 'INS0002', descricao: 'DOCE DE LEITE', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.05 },
    { id: 'INS0003', descricao: 'MANTEIGA SEM SAL', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.06 },
    { id: 'INS0004', descricao: 'ACUCAR MASCAVO', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.012 },
    { id: 'INS0005', descricao: 'ACUCAR CRISTAL', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.01 },
    { id: 'INS0006', descricao: 'OVO', unidade: 'UN', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.5 },
    { id: 'INS0007', descricao: 'BAUNILHA', unidade: 'ML', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.014 },
    { id: 'INS0008', descricao: 'FARINHA DE TRIGO', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.0031 },
    { id: 'INS0009', descricao: 'FERMENTO QUIMICO', unidade: 'G', categoria: 'INGREDIENTE', controla: 'SIM', controlaEstoque: 'SIM', fc: '1,00', custo: 0.02 },
    { id: 'INS0010', descricao: 'EMBALAGEM PP DEMONSTRAÇÃO', unidade: 'UN', categoria: 'EMBALAGEM', controla: 'NÃO', controlaEstoque: 'NÃO', fc: '1,00', custo: 0.12 }
  ];

  const fornecedores = [{
    id: 'FOR-DEMO-01',
    cnpj: '00.000.000/0001-00',
    nome: 'FORNECEDOR DEMONSTRATIVO LTDA',
    razaoSocial: 'FORNECEDOR DEMONSTRATIVO LTDA',
    nomeFantasia: 'FORNECEDOR DEMO',
    situacaoCompras: 'ATIVO',
    cidade: 'CIDADE DEMONSTRAÇÃO',
    uf: 'SP',
    telefone: '(11) 0000-0000',
    email: 'contato@exemplo.test'
  }];

  function component(tipo, id, quantity, unit) {
    return { tipo, id, configKey: 'BASE', quantidades: { BASE: String(quantity) }, etapa: '', unidade: unit };
  }

  const receitas = {
    FTD0001: {
      nome: 'BAUNILHA NUTELLA — DEMONSTRAÇÃO', categoria: 'COOKIES RECHEADOS', status: 'ATIVA', versao: 5,
      base: { qtd: '12', unidade: 'UN', pdv: '15,00' },
      variacoes: [{ key: 'V1', nome: 'COMBO 2 UNIDADES', qtd: '6', unidade: 'UN', modo: 'DIVIDIR', pdv: '25,00' }],
      componentes: [component('INSUMO', 'INS0003', 200, 'G'), component('INSUMO', 'INS0004', 150, 'G'), component('INSUMO', 'INS0005', 100, 'G'), component('INSUMO', 'INS0006', 2, 'UN'), component('INSUMO', 'INS0007', 5, 'ML'), component('INSUMO', 'INS0008', 380, 'G'), component('INSUMO', 'INS0009', 1, 'G'), component('INSUMO', 'INS0002', 180, 'G'), component('INSUMO', 'INS0001', 100, 'G'), component('INSUMO', 'INS0010', 12, 'UN')],
      preparo: 'Misture os ingredientes secos, incorpore os líquidos e finalize com a cobertura.', observacoes: 'Receita utilizada para demonstração da interface.'
    },
    FTD0002: {
      nome: 'COOKIE DE CHOCOLATE — DEMONSTRAÇÃO', categoria: 'COOKIES RECHEADOS', status: 'ATIVA', versao: 2,
      base: { qtd: '20', unidade: 'UN', pdv: '18,00' }, variacoes: [],
      componentes: [component('INSUMO', 'INS0003', 240, 'G'), component('INSUMO', 'INS0005', 140, 'G'), component('INSUMO', 'INS0008', 300, 'G'), component('INSUMO', 'INS0001', 160, 'G')],
      preparo: 'Modele as porções, asse até dourar as bordas e deixe resfriar antes de embalar.', observacoes: 'Dados fictícios de demonstração.'
    }
  };

  const custos = Object.fromEntries(insumos.map((item) => [item.id, item.custo]));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const number = (value) => Number(String(value ?? '').replace(',', '.')) || 0;
  const money = (value) => Number(value).toFixed(2).replace('.', ',');
  const upper = (value) => String(value ?? '').toLocaleUpperCase('pt-BR');
  const fichaList = Object.entries(receitas).map(([id, receita]) => ({ id, nome: receita.nome, categoria: receita.categoria, status: receita.status, atualizado: '2026-10-30 10:00', versao: receita.versao }));

  function configurations(receita) {
    return [{ key: 'BASE', nome: 'PRINCIPAL', qtd: receita.base.qtd, unidade: receita.base.unidade }, ...(receita.variacoes || []).map((item) => ({ key: item.key, nome: item.nome, qtd: item.qtd, unidade: item.unidade }))];
  }

  function preview(data) {
    const receita = data?.id && receitas[data.id] ? receitas[data.id] : data || receitas.FTD0001;
    const configs = configurations(receita);
    return configs.map((config) => {
      let total = 0;
      const detalhes = (receita.componentes || []).map((item) => {
        const raw = item.quantidades?.[config.key] ?? item.quantidades?.BASE ?? '';
        const quantidade = number(raw);
        const insumo = insumos.find((candidate) => candidate.id === item.id) || insumos[0];
        const subtotal = quantidade * (custos[insumo.id] || 0);
        total += subtotal;
        return { nome: insumo.descricao, quantidade: String(raw), unidade: insumo.unidade, subtotal: money(subtotal) };
      }).filter((item) => number(item.quantidade) > 0);
      const rendimento = number(config.qtd) || 1;
      const unit = total / rendimento;
      return { key: config.key, nome: config.nome, rendimento: Number(config.qtd), unidade: config.unidade, custoTotal: money(total), custoUnitario: money(unit), custoUnitarioExibido: money(unit), detalhes };
    });
  }

  function fichaLibrary() {
    return {
      fichas: clone(fichaList), insumos: clone(insumos), categorias: [...categoriasFicha],
      rendimentosFT: Object.fromEntries(Object.entries(receitas).map(([id, receita]) => [id, [{ key: 'BASE', nome: 'PRINCIPAL', unidade: receita.base.unidade }, ...(receita.variacoes || []).map((item) => ({ key: item.key, nome: item.nome, unidade: item.unidade }))]])),
      componentesFT: Object.fromEntries(Object.entries(receitas).map(([id, receita]) => [id, receita.componentes.map((item) => item.id)]))
    };
  }

  function initialPurchases() {
    return { fornecedores: clone(fornecedores), insumos: clone(insumos), vinculos: [], creditos: [] };
  }

  const writeMethods = new Set([
    'salvarInsumo', 'salvarFornecedor', 'excluirFornecedorSemCnpj', 'comprasGravar', 'comprasReceber', 'comprasRascunhoSalvar', 'comprasRascunhoDescartar', 'comprasCancelarPendente',
    'estoqueAbrirInventario', 'estoqueSalvarContagens', 'estoqueSalvarDetalhesContagem', 'estoqueGravarContagens', 'estoqueFinalizarInventario', 'estoqueCancelarInventario', 'estoqueCorrigirSaldoManual', 'estoqueRegistrarMovimentacaoManual', 'estoqueRascunhoSaidaSalvar', 'estoqueRascunhoSaidaDescartar', 'estoqueReabrirContagem',
    'ftSalvar', 'ftAlterarSituacao', 'ftExcluirRascunho', 'ftSalvarCategoria', 'ftRenomearCategoria', 'ftSalvarCustoManual', 'ftPrecosSalvar'
  ]);

  function read(name, args) {
    if (writeMethods.has(name)) return Promise.reject(new Error(readOnlyMessage));
    switch (name) {
      case 'listarCategoriasInsumos': return Promise.resolve([...categorias]);
      case 'listarInsumos': return Promise.resolve(clone(insumos));
      case 'listarInsumosPorCategoria': return Promise.resolve(clone(insumos.filter((item) => item.categoria === args[0])));
      case 'obterInsumoPorId': return Promise.resolve(clone(insumos.find((item) => item.id === args[0]) || insumos[0]));
      case 'verificarPossivelDuplicidade': return Promise.resolve({ encontrado: false });
      case 'listarFornecedores': return Promise.resolve(clone(fornecedores));
      case 'obterFornecedorPorId': return Promise.resolve(clone(fornecedores.find((item) => item.id === args[0]) || fornecedores[0]));
      case 'pesquisarFornecedores': return Promise.resolve(clone(fornecedores));
      case 'comprasDadosIniciais': return Promise.resolve(initialPurchases());
      case 'comprasConsulta': return Promise.resolve([{ id: 'COMP-DEMO-001', lancamento: '30/10/2026', numero: 'NF-DEMO-001', fornecedor: fornecedores[0].nome, status: 'RECEBIDA' }]);
      case 'comprasRascunhosListar': return Promise.resolve([]);
      case 'comprasObter': return Promise.resolve({ id: 'COMP-DEMO-001', numero: 'NF-DEMO-001', fornecedor: fornecedores[0].nome, status: 'RECEBIDA', itens: [{ id: 'ITEM-DEMO-001', descricao: 'DOCE DE LEITE', qtd: '10', recebida: '10', cancelada: '0', insumoId: 'INS0002', embalagem: '1000', unidade: 'G' }], pagamentos: [{ forma: 'PIX', valor: '120,00', vencimento: '30/10/2026', pago: true }] });
      case 'comprasVerificarCnpj': return Promise.resolve({ status: 'NAO_ENCONTRADO' });
      case 'consultarCnpjFornecedor': return Promise.resolve({ status: 'NAO_ENCONTRADO' });
      case 'estoqueSituacao': return Promise.resolve({ saldos: [{ id: 'INS0002', nome: 'DOCE DE LEITE', quantidade: '2,40 KG', custo: 'R$ 0,05', valor: 'R$ 120,00', controlaEstoque: 'SIM' }, { id: 'INS0008', nome: 'FARINHA DE TRIGO', quantidade: '8,00 KG', custo: 'R$ 0,00', valor: 'R$ 24,80', controlaEstoque: 'SIM' }], normalizacaoPendente: false, aberto: null });
      case 'estoqueListarInventarios': return Promise.resolve([{ id: 'INV-DEMO-001', tipo: 'PERIÓDICO', status: 'FINALIZADO', inicio: '28/10/2026', fim: '28/10/2026' }]);
      case 'estoqueListarMovimentacoes': return Promise.resolve([{ id: 'MOV-DEMO-001', data: '30/10/2026', movimento: 'ENTRADA DEMONSTRAÇÃO', tipo: 'COMPRA', valor: 'R$ 120,00', referencia: 'NF-DEMO-001' }]);
      case 'ftBiblioteca': return Promise.resolve(fichaLibrary());
      case 'ftListar': return Promise.resolve(clone(fichaList));
      case 'ftListarCategorias': return Promise.resolve([...new Set(fichaList.map((item) => item.categoria))]);
      case 'ftObter': { const id = args[0] && receitas[args[0]] ? args[0] : 'FTD0001'; const receita = clone(receitas[id]); return Promise.resolve({ id, status: receita.status, versao: receita.versao, observacoes: receita.observacoes, receita }); }
      case 'ftPrecosConsultar': { const receita = receitas[args[0]] || receitas.FTD0001; return Promise.resolve({ BASE: receita.base.pdv, ...Object.fromEntries((receita.variacoes || []).map((item) => [item.key, item.pdv])) }); }
      case 'ftPrevia': return Promise.resolve(preview(args[0]));
      case 'ftResumo': return Promise.resolve({ configuracoes: preview(receitas[args[0]] || receitas.FTD0001) });
      case 'ftHistorico': return Promise.resolve([{ versao: 1, data: '2026-10-20', motivo: 'Versão demonstrativa' }, { versao: 2, data: '2026-10-28', motivo: 'Ajuste demonstrativo' }]);
      case 'ftCompararVersoes': return Promise.resolve({ a: Number(args[1] || 1), b: Number(args[2] || 2), diferencas: [] });
      case 'ftConsultaReferenciaManual': return Promise.resolve({ insumo: 'INSUMO DEMONSTRAÇÃO', unidade: 'G', operacional: '0,05', metodo: 'CUSTO DEMONSTRATIVO', manual: '0,05', atualizado: '2026-10-30', podeEditar: false });
      case 'ftSimular': return Promise.resolve({ data: '30/10/2026', linhas: [], custoTotal: '0,00', materiais: [] });
      default: return Promise.resolve({});
    }
  }

  function createRunner(successHandler = null, failureHandler = null) {
    return new Proxy({}, {
      get(_target, property) {
        if (property === 'call') return (name, ...args) => read(name, args);
        if (property === 'withSuccessHandler') return (handler) => createRunner(handler, failureHandler);
        if (property === 'withFailureHandler') return (handler) => createRunner(successHandler, handler);
        if (typeof property !== 'string') return undefined;
        return (...args) => read(property, args).then((payload) => { successHandler?.(payload); return payload; }).catch((error) => { failureHandler?.(error); throw error; });
      }
    });
  }

  const localApi = createRunner();
  window.CSM_DEMO_MODE = true;
  window.localApi = localApi;
  window.nativeApi = localApi;

  const writeText = /\b(NOVA|ADICIONAR|CADASTRAR|SALVAR|EXCLUIR|REMOVER|ALTERAR|ATIVAR|INATIVAR|DUPLICAR|GRAVAR|FINALIZAR|IMPORTAR|GERAR PARCELAS|CORRIGIR|RECEBER|DESCARTAR|APLICAR CUSTO|ATUALIZAR CUSTO|COPIAR VARIAÇÃO|OUTRA FT)\b/i;
  const writeHandler = /(addComponent|openQuickInsumo|newFT|createCategory|renameCategory|save|delete|changeStatus|duplicate|submit|salvar|abrirCadastroFornecedor|abrirOperacaoManual|abrirSaidaManualNova|abrirInventario|finalizar|gravar|corrigir|receber|descartar)/i;

  function disableShowcaseControls() {
    document.querySelectorAll('button').forEach((button) => {
      const label = `${button.textContent || ''} ${button.id || ''}`;
      const handler = button.getAttribute('onclick') || '';
      if (writeText.test(label) || writeHandler.test(handler)) {
        button.disabled = true;
        button.classList.add('csm-demo-disabled');
        button.title = 'Disponível somente no sistema local.';
      }
    });
    document.querySelectorAll('#editor input,#editor select,#editor textarea,#formInsumos input,#formInsumos select,#formInsumos textarea,#formFornecedor input,#formFornecedor select,#formFornecedor textarea,#conteudo input,#conteudo select,#conteudo textarea').forEach((control) => {
      control.disabled = true;
      control.classList.add('csm-demo-disabled');
    });
    document.querySelectorAll('[data-component-drag]').forEach((handle) => { handle.draggable = false; handle.classList.add('csm-demo-disabled'); });
  }

  function startShowcase() {
    document.body.classList.add('csm-showcase');
    document.title = 'Simulação do Sistema | Casa São Miguel';
    if (window.self !== window.top || new URLSearchParams(window.location.search).get('embedded') === '1') document.body.classList.add('native-embedded-page');
    if (!document.querySelector('.csm-demo-banner')) {
      const banner = document.createElement('div'); banner.className = 'csm-demo-banner'; banner.textContent = 'SIMULAÇÃO DO SISTEMA · SOMENTE LEITURA'; document.body.prepend(banner);
    }
    disableShowcaseControls();
    new MutationObserver(disableShowcaseControls).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startShowcase, { once: true }); else startShowcase();
})();
