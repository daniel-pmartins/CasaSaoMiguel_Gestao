const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }
};

function byId(id) { return document.getElementById(id); }

function showNotice(message, type = 'ok') {
  const notice = byId('notice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = `notice show ${type}`;
}

function clearNotice() {
  const notice = byId('notice');
  if (notice) notice.className = 'notice';
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

async function initInsumos() {
  const form = byId('insumo-form');
  const table = byId('insumos-body');
  const search = byId('search');
  const category = byId('categoria');
  let pendingDuplicate = null;

  const categories = await api.request('/api/cadastros/categorias');
  category.innerHTML = '<option value="">Selecione</option>' + categories.map((item) => `<option>${esc(item)}</option>`).join('');

  async function refresh() {
    const query = new URLSearchParams({ q: search.value.trim() });
    if (category.value) query.set('categoria', category.value);
    const rows = await api.request(`/api/insumos?${query}`);
    table.innerHTML = rows.length ? rows.map((item) => `
      <tr>
        <td>${esc(item.id)}</td>
        <td>${esc(item.descricao)}</td>
        <td>${esc(item.categoria)}</td>
        <td>${esc(item.unidade)}</td>
        <td>${Number(item.fc).toFixed(2)}</td>
        <td><button type="button" data-edit="${esc(item.id)}">Editar</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum insumo cadastrado.</td></tr>';
    table.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => loadForEdit(button.dataset.edit)));
  }

  async function loadForEdit(id) {
    const item = await api.request(`/api/insumos/${encodeURIComponent(id)}`);
    for (const [key, value] of Object.entries({ id: item.id, descricao: item.descricao, unidade: item.unidade, categoria: item.categoria, fc: item.fc, observacao: item.observacao })) {
      const field = form.elements.namedItem(key);
      if (field) field.value = value;
    }
    form.elements.namedItem('controlaEstoque').checked = item.controlaEstoque === 'SIM';
    byId('cancel-edit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNotice();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const payload = formData(form);
      payload.controlaEstoque = form.elements.namedItem('controlaEstoque').checked;
      if (pendingDuplicate) payload.forcarNovo = true;
      const result = await api.request(`/api/insumos${payload.forcarNovo ? '?forcarNovo=1' : ''}`, { method: 'POST', body: JSON.stringify(payload) });
      if (result.status === 'POSSIVEL_DUPLICIDADE') {
        pendingDuplicate = result.insumo;
        showNotice(`Possível duplicidade com ${result.insumo.id} — ${result.insumo.descricao}. Clique em salvar novamente para confirmar.`, 'warn');
        return;
      }
      pendingDuplicate = null;
      form.reset();
      byId('cancel-edit').hidden = true;
      showNotice(result.mensagem, 'ok');
      await refresh();
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  byId('cancel-edit').addEventListener('click', () => { form.reset(); pendingDuplicate = null; byId('cancel-edit').hidden = true; clearNotice(); });
  search.addEventListener('input', refresh);
  category.addEventListener('change', refresh);
  await refresh();
}

async function initFornecedores() {
  const form = byId('fornecedor-form');
  const table = byId('fornecedores-body');
  const search = byId('search');
  let pendingDuplicate = false;

  async function refresh() {
    const query = encodeURIComponent(search.value.trim());
    const rows = await api.request(`/api/fornecedores?q=${query}`);
    table.innerHTML = rows.length ? rows.map((item) => `
      <tr>
        <td>${esc(item.id)}</td>
        <td>${esc(item.razaoSocial)}</td>
        <td>${esc(item.cnpj)}</td>
        <td>${esc(item.cidade)}${item.uf ? `/${esc(item.uf)}` : ''}</td>
        <td>${esc(item.situacaoCompras)}</td>
        <td><button type="button" data-edit="${esc(item.id)}">Editar</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum fornecedor cadastrado.</td></tr>';
    table.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => loadForEdit(button.dataset.edit)));
  }

  async function loadForEdit(id) {
    const item = await api.request(`/api/fornecedores/${encodeURIComponent(id)}`);
    const mapping = {
      id: item.id, cnpj: item.cnpj, razaoSocial: item.razaoSocial, nomeFantasia: item.nomeFantasia,
      cidade: item.cidade, uf: item.uf, telefone: item.telefone, email: item.email, situacaoCompras: item.situacaoCompras
    };
    Object.entries(mapping).forEach(([key, value]) => { if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value; });
    byId('cancel-edit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNotice();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const payload = formData(form);
      if (pendingDuplicate) payload.forcarDuplicidade = true;
      const result = await api.request(`/api/fornecedores${payload.forcarDuplicidade ? '?forcarDuplicidade=1' : ''}`, { method: 'POST', body: JSON.stringify(payload) });
      if (result.status === 'POSSIVEL_DUPLICIDADE') {
        pendingDuplicate = true;
        showNotice(`Possível duplicidade com ${result.fornecedor.id} — ${result.fornecedor.razaoSocial}. Clique em salvar novamente para confirmar.`, 'warn');
        return;
      }
      pendingDuplicate = false;
      form.reset();
      byId('cancel-edit').hidden = true;
      showNotice(result.mensagem, 'ok');
      await refresh();
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  byId('cancel-edit').addEventListener('click', () => { form.reset(); pendingDuplicate = false; byId('cancel-edit').hidden = true; clearNotice(); });
  search.addEventListener('input', refresh);
  await refresh();
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  const boot = page === 'insumos' ? initInsumos : page === 'fornecedores' ? initFornecedores : null;
  if (boot) boot().catch((error) => showNotice(error.message, 'error'));
});
