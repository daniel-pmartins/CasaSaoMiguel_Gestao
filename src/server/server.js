const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('./db');
const { ValidationError, createCadastrosService, normalizeCnpj } = require('./cadastros');
const { StockValidationError, createNormalizedStockService } = require('./normalized-stock');
const { PurchaseValidationError, createNormalizedPurchaseService } = require('./normalized-purchases');
const { FichaValidationError, createNormalizedFichaService } = require('./normalized-ficha');
const { lookupCep, lookupCnpj } = require('./external-lookups');

const DEFAULT_PORT = 8787;
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..', 'web');

const MODULE_PAGES = {
  menu: 'index.html',
  insumos: 'modules/insumos.html',
  fornecedores: 'modules/fornecedores.html',
  estoque: 'modules/estoque.html',
  compras: 'modules/compras.html',
  ficha_tecnica: 'modules/ficha-tecnica.html'
};

const MODULE_PATHS = Object.fromEntries(Object.entries(MODULE_PAGES).map(([page, file]) => [`/${file}`, page]));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS'
  });
  response.end(body);
}

function sendStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const file = path.resolve(FRONTEND_ROOT, relative);
  if (file !== FRONTEND_ROOT && !file.startsWith(`${FRONTEND_ROOT}${path.sep}`)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const content = fs.readFileSync(file);
  response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' });
  response.end(content);
  return true;
}

function sendModulePage(response, page, { embedded = false } = {}) {
  const filename = MODULE_PAGES[page];
  if (!filename) return false;
  const source = path.join(FRONTEND_ROOT, filename);
  if (!fs.existsSync(source)) return false;
  let html = fs.readFileSync(source, 'utf8');
  html = html.replace(/<body(\s[^>]*)?>/i, (tag, attributes = '') => {
    const embeddedClass = embedded ? ' native-embedded-page' : '';
    if (/class\s*=\s*"[^"]*"/i.test(attributes)) {
      return tag.replace(/class\s*=\s*"([^"]*)"/i, `class="$1 native-module-${page}${embeddedClass}"`);
    }
    return `<body${attributes} class="native-module-${page}${embeddedClass}">`;
  });
  if (page === 'menu') {
    const logo = '<a class="csm-sidebar-brand" href="/" aria-label="Voltar à página inicial"><img src="/assets/casa-sao-miguel-logo.png?v=3" alt="Casa São Miguel"></a>';
    html = html.replace(/<main>/i, `<main class="csm-menu-sidebar">${logo}`);
  }
  const favicon = '<link rel="icon" type="image/x-icon" href="/assets/favicon-casa-sao-miguel.ico?v=1">';
  const theme = '<link rel="stylesheet" href="/theme.css">';
  const client = '<script src="/api-client.js"></script>';
  const additions = `${favicon}${theme}${client}`;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${additions}</head>`) : `${additions}${html}`;
  const body = Buffer.from(html, 'utf8');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
  response.end(body);
  return true;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new ValidationError('Corpo da requisição excede 1 MB.'));
    });
    request.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new ValidationError('JSON inválido.'));
      }
    });
    request.on('error', reject);
  });
}

function routeId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return '';
  return decodeURIComponent(pathname.slice(prefix.length).replace(/^\//, ''));
}

function createApiServer({ db, normalizedStock = null, normalizedPurchases = null, normalizedFicha = null }) {
  const service = createCadastrosService(db);

  return http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS'
      });
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://localhost');
    const { pathname, searchParams } = url;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true, service: 'casa-sao-miguel-api', time: new Date().toISOString() });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/cadastros/categorias') {
        sendJson(response, 200, service.listarCategoriasInsumos());
        return;
      }

      if (request.method === 'GET' && pathname === '/api/insumos/duplicidade') {
        sendJson(response, 200, service.verificarPossivelDuplicidade(searchParams.get('descricao') || '', searchParams.get('idAtual') || ''));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/insumos') {
        sendJson(response, 200, service.listarInsumos({ categoria: searchParams.get('categoria') || '', q: searchParams.get('q') || '' }));
        return;
      }

      if (pathname.startsWith('/api/insumos/')) {
        const id = routeId(pathname, '/api/insumos/');
        if (request.method === 'GET') {
          const item = service.obterInsumoPorId(id);
          if (!item) return sendJson(response, 404, { error: 'Insumo não encontrado.' });
          return sendJson(response, 200, item);
        }
      }

      if (request.method === 'POST' && pathname === '/api/insumos') {
        const body = await parseBody(request);
        sendJson(response, 200, service.salvarInsumo(body, searchParams.get('forcarNovo') === '1'));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/fornecedores') {
        sendJson(response, 200, service.listarFornecedores({
          incluirExcluidos: searchParams.get('incluirExcluidos') === '1',
          q: searchParams.get('q') || ''
        }));
        return;
      }

      if (pathname.startsWith('/api/fornecedores/')) {
        const id = routeId(pathname, '/api/fornecedores/');
        if (request.method === 'GET') {
          const item = service.obterFornecedorPorId(id);
          if (!item) return sendJson(response, 404, { error: 'Fornecedor não encontrado.' });
          return sendJson(response, 200, item);
        }
        if (request.method === 'DELETE') {
          return sendJson(response, 200, service.excluirFornecedorSemCnpj(id));
        }
      }

      if (request.method === 'POST' && pathname === '/api/fornecedores') {
        const body = await parseBody(request);
        sendJson(response, 200, service.salvarFornecedor(body, searchParams.get('forcarDuplicidade') === '1'));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v2/fornecedores/cep') {
        sendJson(response, 200, await lookupCep(searchParams.get('cep') || ''));
        return;
      }
      if (request.method === 'GET' && pathname === '/api/v2/fornecedores/cnpj') {
        const cnpj = normalizeCnpj(searchParams.get('cnpj') || '');
        const row = db.prepare('SELECT * FROM fornecedores WHERE cnpj = ? LIMIT 1').get(cnpj);
        const existing = row ? {
          id: row.id, cnpj: row.cnpj, dataAbertura: row.data_abertura || '', situacao: row.situacao_cadastral || '',
          dataSituacao: row.data_situacao_cadastral || '', razaoSocial: row.razao_social, nomeFantasia: row.nome_fantasia,
          logradouro: row.logradouro, numero: row.numero, complemento: row.complemento, bairro: row.bairro, cep: row.cep,
          cidade: row.cidade, uf: row.uf, nomeContato: row.nome_contato, telefone: row.telefone, email: row.email,
          situacaoCompras: row.situacao_compras, excluidoLogico: Boolean(row.excluido_logicamente), excluidoEm: row.excluido_em || ''
        } : null;
        sendJson(response, 200, await lookupCnpj(cnpj, existing));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v2/compras/verificar-cnpj') {
        if (!normalizedPurchases) return sendJson(response, 503, { error: 'Módulo normalizado de compras indisponível.' });
        sendJson(response, 200, normalizedPurchases.verifySupplierCnpj(searchParams.get('cnpj') || ''));
        return;
      }

      if (pathname.startsWith('/api/v2/compras')) {
        if (!normalizedPurchases) return sendJson(response, 503, { error: 'Módulo normalizado de compras indisponível.' });
        const parts = pathname.split('/').filter(Boolean);
        if (request.method === 'GET' && parts.length === 3) {
          sendJson(response, 200, normalizedPurchases.initialData());
          return;
        }
        if (request.method === 'POST' && parts.length === 3) {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedPurchases.savePurchase(body));
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'consulta') {
          sendJson(response, 200, normalizedPurchases.query(searchParams.get('aba') || '', searchParams.get('termo') || '', searchParams.get('inicio') || '', searchParams.get('fim') || ''));
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'rascunhos') {
          sendJson(response, 200, normalizedPurchases.listDrafts());
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'rascunhos') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedPurchases.saveDraft(body.id, body.dados || body));
          return;
        }
        if (parts.length === 4 && parts[3] !== 'consulta' && parts[3] !== 'rascunhos' && request.method === 'GET') {
          sendJson(response, 200, normalizedPurchases.get(decodeURIComponent(parts[3])));
          return;
        }
        if (parts.length === 5 && parts[4] === 'receber' && request.method === 'POST') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedPurchases.receive(decodeURIComponent(parts[3]), body.itens));
          return;
        }
        if (parts.length === 5 && parts[4] === 'cancelar' && request.method === 'POST') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedPurchases.cancelPending({ ...body, id: decodeURIComponent(parts[3]) }));
          return;
        }
        if (parts.length === 5 && parts[3] === 'rascunhos' && request.method === 'GET') {
          const draftId = decodeURIComponent(parts[4]);
          sendJson(response, 200, normalizedPurchases.openDraft(draftId));
          return;
        }
        if (parts.length === 6 && parts[3] === 'rascunhos' && parts[5] === 'descartar' && request.method === 'POST') {
          sendJson(response, 200, normalizedPurchases.discardDraft(decodeURIComponent(parts[4])));
          return;
        }
      }

      if (pathname.startsWith('/api/v2/ficha')) {
        if (!normalizedFicha) return sendJson(response, 503, { error: 'Módulo normalizado de ficha técnica indisponível.' });
        const parts = pathname.split('/').filter(Boolean);
        if (request.method === 'GET' && parts.length === 3) {
          sendJson(response, 200, normalizedFicha.list());
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'biblioteca') {
          sendJson(response, 200, normalizedFicha.library());
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'categorias') {
          sendJson(response, 200, normalizedFicha.categories());
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'categorias') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.saveCategory(body.nome));
          return;
        }
        if (request.method === 'POST' && parts.length === 5 && parts[3] === 'categorias' && parts[4] === 'renomear') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.renameCategory(body.anterior, body.novo));
          return;
        }
        if (request.method === 'POST' && parts.length === 3) {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.save(body.dados || body, body.ativar));
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'previa') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.preview(body.dados || body));
          return;
        }
        if (parts.length === 4 && parts[3] !== 'biblioteca' && parts[3] !== 'categorias') {
          const fichaId = decodeURIComponent(parts[3]);
          if (request.method === 'GET') {
            sendJson(response, 200, normalizedFicha.get(fichaId, searchParams.get('versao') || ''));
            return;
          }
        }
        if (parts.length === 5 && parts[4] === 'historico' && request.method === 'GET') {
          sendJson(response, 200, normalizedFicha.history(decodeURIComponent(parts[3])));
          return;
        }
        if (parts.length === 5 && parts[4] === 'comparar' && request.method === 'GET') {
          sendJson(response, 200, normalizedFicha.compareVersions(decodeURIComponent(parts[3]), searchParams.get('v1'), searchParams.get('v2')));
          return;
        }
        if (parts.length === 5 && parts[4] === 'resumo' && request.method === 'GET') {
          sendJson(response, 200, normalizedFicha.summary(decodeURIComponent(parts[3])));
          return;
        }
        if (parts.length === 5 && parts[4] === 'simular' && request.method === 'POST') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.simulate(decodeURIComponent(parts[3]), body.configuracoes));
          return;
        }
        if (parts.length === 5 && parts[4] === 'status' && request.method === 'POST') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.changeStatus(decodeURIComponent(parts[3]), body.status));
          return;
        }
        if (parts.length === 5 && parts[4] === 'excluir' && request.method === 'POST') {
          sendJson(response, 200, normalizedFicha.deleteDraft(decodeURIComponent(parts[3])));
          return;
        }
        if (parts.length === 4 && parts[3] === 'custos' && request.method === 'POST') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedFicha.saveManualCost(body.insumoId, body.valor, body.observacao, body.embalagem, body.valorPago));
          return;
        }
        if (parts.length === 5 && parts[3] === 'referencia' && request.method === 'GET') {
          sendJson(response, 200, normalizedFicha.referenceManual(decodeURIComponent(parts[4])));
          return;
        }
        if (parts.length === 5 && parts[3] === 'impacto' && request.method === 'GET') {
          sendJson(response, 200, normalizedFicha.impactInsumo(decodeURIComponent(parts[4])));
          return;
        }
        if (parts.length === 5 && parts[4] === 'precos') {
          const fichaId = decodeURIComponent(parts[3]);
          if (request.method === 'GET') {
            sendJson(response, 200, normalizedFicha.prices(fichaId));
            return;
          }
          if (request.method === 'POST') {
            const body = await parseBody(request);
            sendJson(response, 200, normalizedFicha.savePrices(fichaId, body.valores || body));
            return;
          }
        }
      }

      if (pathname.startsWith('/api/v2/estoque')) {
        if (!normalizedStock) return sendJson(response, 503, { error: 'Módulo normalizado de estoque indisponível.' });
        const parts = pathname.split('/').filter(Boolean);
        if (request.method === 'GET' && parts.length === 3 && parts[2] === 'estoque') {
          sendJson(response, 200, normalizedStock.status());
          return;
        }
        if (request.method === 'GET' && parts.length === 5 && parts[3] === 'custos') {
          sendJson(response, 200, normalizedStock.referenceCost(decodeURIComponent(parts[4])));
          return;
        }
        if (request.method === 'GET' && parts.length === 5 && parts[3] === 'movimentacoes' && parts[4] === 'dados') {
          sendJson(response, 200, normalizedStock.movementData(searchParams.get('tipo') || ''));
          return;
        }
        if (request.method === 'GET' && parts.length === 5 && parts[3] === 'movimentacoes') {
          sendJson(response, 200, normalizedStock.movementDetails(decodeURIComponent(parts[4])));
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'movimentacoes') {
          sendJson(response, 200, normalizedStock.listMovements());
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'movimentacoes') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedStock.registerManualMovement(body));
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'corrigir-saldo') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedStock.correctBalance(body));
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'rascunhos-saida') {
          sendJson(response, 200, normalizedStock.listExitDrafts());
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'rascunhos-saida') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedStock.saveExitDraft(body.id, body.dados || body));
          return;
        }
        if (parts.length >= 5 && parts[3] === 'rascunhos-saida') {
          const draftId = decodeURIComponent(parts[4]);
          if (request.method === 'GET' && parts.length === 5) {
            sendJson(response, 200, normalizedStock.openExitDraft(draftId));
            return;
          }
          if (request.method === 'POST' && parts.length === 6 && parts[5] === 'descartar') {
            sendJson(response, 200, normalizedStock.discardExitDraft(draftId));
            return;
          }
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'conferir-saida') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedStock.checkManualExit(body.itens));
          return;
        }
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'inventarios') {
          sendJson(response, 200, normalizedStock.listInventories());
          return;
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'inventarios') {
          const body = await parseBody(request);
          sendJson(response, 200, normalizedStock.openInventory(body.tipo));
          return;
        }
        if (parts.length >= 5 && parts[3] === 'inventarios') {
          const inventoryId = decodeURIComponent(parts[4]);
          if (request.method === 'GET' && parts.length === 5) {
            sendJson(response, 200, normalizedStock.inventoryData(inventoryId));
            return;
          }
          if (request.method === 'POST' && parts.length === 6 && parts[5] === 'contagens') {
            const body = await parseBody(request);
            sendJson(response, 200, normalizedStock.saveCounts(inventoryId, body.alteracoes));
            return;
          }
          if (request.method === 'POST' && parts.length === 6 && parts[5] === 'detalhes') {
            const body = await parseBody(request);
            sendJson(response, 200, normalizedStock.saveCountDetails(inventoryId, body.insumoId, body.linhas, body.compensar, body.momento));
            return;
          }
          if (request.method === 'GET' && parts.length === 6 && parts[5] === 'previa') {
            sendJson(response, 200, normalizedStock.previewFinalization(inventoryId));
            return;
          }
          if (request.method === 'POST' && parts.length === 6 && parts[5] === 'finalizar') {
            sendJson(response, 200, normalizedStock.finalizeInventory(inventoryId));
            return;
          }
          if (request.method === 'POST' && parts.length === 6 && parts[5] === 'cancelar') {
            const body = await parseBody(request);
            sendJson(response, 200, normalizedStock.cancelInventory(inventoryId, body.justificativa));
            return;
          }
          if (request.method === 'GET' && parts.length === 6 && parts[5] === 'pdf') {
            sendJson(response, 200, normalizedStock.pdfInventory(inventoryId));
            return;
          }
          if (request.method === 'POST' && parts.length === 7 && parts[5] === 'contagens' && parts[6] === 'gravar') {
            const body = await parseBody(request);
            sendJson(response, 200, normalizedStock.markCounts(inventoryId, body.ids));
            return;
          }
          if (request.method === 'POST' && parts.length === 8 && parts[5] === 'contagens' && parts[7] === 'reabrir') {
            sendJson(response, 200, normalizedStock.reopenCount(inventoryId, decodeURIComponent(parts[6])));
            return;
          }
        }
        if (request.method === 'GET' && parts.length === 3 && parts[2] === 'estoque-movimentacoes') {
          sendJson(response, 200, normalizedStock.listMovements());
          return;
        }
      }

      if (request.method === 'GET' && MODULE_PATHS[pathname]) {
        if (sendModulePage(response, MODULE_PATHS[pathname], { embedded: searchParams.get('embedded') === '1' })) return;
      }

      if (request.method === 'GET' && pathname === '/') {
        if (sendModulePage(response, 'menu')) return;
      }

      if (request.method === 'GET' && sendStatic(response, pathname)) return;

      sendJson(response, 404, { error: 'Rota não encontrada.' });
    } catch (error) {
      console.error('[api]', error.stack || error);
      const status = error instanceof ValidationError || error instanceof StockValidationError || error instanceof PurchaseValidationError || error instanceof FichaValidationError ? 400 : 500;
      sendJson(response, status, { error: error.message || 'Erro interno.' });
    }
  });
}

if (require.main === module) {
  const dbFile = path.resolve(__dirname, '..', '..', 'database', 'data', 'local.sqlite');
  const db = createDatabase(dbFile);
  const normalizedStock = createNormalizedStockService(db);
  const normalizedPurchases = createNormalizedPurchaseService(db);
  const normalizedFicha = createNormalizedFichaService(db);
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createApiServer({ db, normalizedStock, normalizedPurchases, normalizedFicha }).listen(port, '127.0.0.1', () => {
    console.log(`API local disponível em http://127.0.0.1:${port}`);
  });
}

module.exports = { createApiServer, parseBody };
