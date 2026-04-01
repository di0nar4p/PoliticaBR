/**
 * PoliticaBR - Frontend JavaScript
 *
 * Logica do frontend da aplicacao PoliticaBR. Gerencia navegacao por abas,
 * busca em tempo real com debounce (300ms), cancelamento de requisicoes
 * anteriores via AbortController, renderizacao de cards de parlamentares,
 * modal de detalhes com despesas, agregador de noticias com filtros por
 * categoria/fonte, e integracao com dados eleitorais do TSE.
 *
 * @author di0nar4p
 */

// ==================== Estado Global ====================
const state = {
  depPagina: 1,
  depTotal: 0,
  partidos: [],
  buscaController: null,
  depController: null,
  senController: null,
  newsController: null,
  judicial: { deputados: {}, senadores: {} },
};

const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

// ==================== Inicializacao ====================
document.addEventListener('DOMContentLoaded', async () => {
  await carregarDadosJudiciais();
  setupNavigation();
  populateUFs();
  carregarPartidos();
  carregarFontes();
});

async function carregarDadosJudiciais() {
  try {
    const res = await fetch('/api/judicial');
    const data = await res.json();
    state.judicial = data;
  } catch (e) {
    console.error('Erro ao carregar dados judiciais:', e);
  }
}

function badgeJudicial(tipo, id) {
  const map = tipo === 'deputado'
    ? state.judicial.deputados
    : state.judicial.senadores;
  const info = map?.[String(id)];
  if (!info) return '';

  const isCondenado = info.status === 'condenado';
  const badgeClass = isCondenado ? 'badge-condenado' : 'badge-investigado';
  const label = isCondenado ? 'Condenado' : 'Investigado';

  return `<span class="badge-judicial ${badgeClass}" onclick="event.stopPropagation()">${label}<span class="badge-tooltip">${info.resumo}<br><em>${info.fonte}</em></span></span>`;
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const secId = 'sec-' + btn.dataset.section;
      document.getElementById(secId).classList.add('active');

      // Carregar dados ao acessar a aba pela primeira vez
      if (btn.dataset.section === 'deputados' && !state.deputadosLoaded) {
        buscarDeputados();
        state.deputadosLoaded = true;
      }
      if (btn.dataset.section === 'senadores' && !state.senadoresLoaded) {
        buscarSenadores();
        state.senadoresLoaded = true;
      }
      if (btn.dataset.section === 'noticias' && !state.noticiasLoaded) {
        buscarNoticias();
        state.noticiasLoaded = true;
      }
    });
  });

  // Busca em tempo real com debounce
  let buscaTimer = null;
  document.getElementById('busca-termo').addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => buscaGeral(), 300);
  });
  let depTimer = null;
  document.getElementById('dep-nome').addEventListener('input', () => {
    clearTimeout(depTimer);
    depTimer = setTimeout(() => buscarDeputados(), 300);
  });

  let senTimer = null;
  document.getElementById('sen-nome').addEventListener('input', () => {
    clearTimeout(senTimer);
    senTimer = setTimeout(() => buscarSenadores(), 300);
  });

  let newsTimer = null;
  document.getElementById('news-busca').addEventListener('input', () => {
    clearTimeout(newsTimer);
    newsTimer = setTimeout(() => buscarNoticias(), 400);
  });
}

function populateUFs() {
  ['dep-uf', 'sen-uf'].forEach(id => {
    const sel = document.getElementById(id);
    UFS.forEach(uf => {
      const opt = document.createElement('option');
      opt.value = uf;
      opt.textContent = uf;
      sel.appendChild(opt);
    });
  });
}

async function carregarPartidos() {
  try {
    const res = await fetch('/api/camara/partidos');
    const data = await res.json();
    const partidos = data.dados || [];
    state.partidos = partidos;

    ['dep-partido', 'sen-partido'].forEach(id => {
      const sel = document.getElementById(id);
      partidos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.sigla;
        opt.textContent = p.sigla;
        sel.appendChild(opt);
      });
    });
  } catch (e) {
    console.error('Erro ao carregar partidos:', e);
  }
}

// ==================== Helpers ====================
function loading(containerId) {
  document.getElementById(containerId).innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Carregando dados...</p>
    </div>`;
}

function emptyState(containerId, msg) {
  document.getElementById(containerId).innerHTML = `
    <div class="empty-state"><p>${msg}</p></div>`;
}

function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR');
  } catch {
    return dateStr;
  }
}

// ==================== DEPUTADOS ====================
async function buscarDeputados(pagina = 1) {
  state.depPagina = pagina;
  loading('dep-results');

  if (state.depController) state.depController.abort();
  state.depController = new AbortController();

  const nome = document.getElementById('dep-nome').value;
  const partido = document.getElementById('dep-partido').value;
  const uf = document.getElementById('dep-uf').value;

  const params = new URLSearchParams({ pagina, itens: 15 });
  if (nome) params.set('nome', nome);
  if (partido) params.set('siglaPartido', partido);
  if (uf) params.set('siglaUf', uf);

  try {
    const res = await fetch(`/api/camara/deputados?${params}`, {
      signal: state.depController.signal
    });
    const data = await res.json();
    const deputados = data.dados || [];

    if (deputados.length === 0) {
      emptyState('dep-results', 'Nenhum deputado encontrado.');
      document.getElementById('dep-pagination').innerHTML = '';
      document.getElementById('dep-stats').innerHTML = '';
      return;
    }

    // Stats
    const partidos = {};
    deputados.forEach(d => {
      partidos[d.siglaPartido] = (partidos[d.siglaPartido] || 0) + 1;
    });

    document.getElementById('dep-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${deputados.length}</div>
        <div class="stat-label">Deputados nesta pagina</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${Object.keys(partidos).length}</div>
        <div class="stat-label">Partidos</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${pagina}</div>
        <div class="stat-label">Pagina atual</div>
      </div>
    `;

    // Cards
    document.getElementById('dep-results').innerHTML = deputados.map(d => `
      <div class="card" onclick="verDeputado(${d.id})">
        <div class="card-header">
          <img class="card-avatar" src="${d.urlFoto}" alt="${d.nome}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2240%22>${d.nome[0]}</text></svg>'">
          <div>
            <div class="card-name">${d.nome} ${badgeJudicial('deputado', d.id)}</div>
            <div class="card-subtitle">${d.email || ''}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="card-tags">
            <span class="tag tag-partido">${d.siglaPartido}</span>
            <span class="tag tag-uf">${d.siglaUf}</span>
          </div>
        </div>
      </div>
    `).join('');

    // Paginacao
    const links = data.links || [];
    const hasNext = links.some(l => l.rel === 'next');
    const hasPrev = pagina > 1;

    document.getElementById('dep-pagination').innerHTML = `
      ${hasPrev ? `<button class="btn btn-primary" onclick="buscarDeputados(${pagina - 1})">Anterior</button>` : ''}
      <button class="btn btn-accent" disabled>Pagina ${pagina}</button>
      ${hasNext ? `<button class="btn btn-primary" onclick="buscarDeputados(${pagina + 1})">Proxima</button>` : ''}
    `;
  } catch (e) {
    if (e.name === 'AbortError') return;
    emptyState('dep-results', 'Erro ao buscar deputados. Tente novamente.');
    console.error(e);
  }
}

async function verDeputado(id) {
  document.getElementById('modal-title').textContent = 'Carregando...';
  document.getElementById('modal-body').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  document.getElementById('modal-overlay').classList.add('active');

  try {
    const [detRes, despRes] = await Promise.all([
      fetch(`/api/camara/deputados/${id}`),
      fetch(`/api/camara/deputados/${id}/despesas?ano=2024&itens=10`)
    ]);

    const detData = await detRes.json();
    const despData = await despRes.json();

    const d = detData.dados;
    const despesas = despData.dados || [];

    document.getElementById('modal-title').textContent = d.nomeCivil || d.ultimoStatus?.nome || 'Deputado';

    let despesasHTML = '';
    if (despesas.length > 0) {
      const totalDesp = despesas.reduce((s, dp) => s + (dp.valorLiquido || 0), 0);
      despesasHTML = `
        <div class="detail-section">
          <h3>Despesas Parlamentares (2024) - Total: ${formatCurrency(totalDesp)}</h3>
          <table class="expense-table">
            <thead>
              <tr><th>Tipo</th><th>Fornecedor</th><th>Valor</th><th>Data</th></tr>
            </thead>
            <tbody>
              ${despesas.map(dp => `
                <tr>
                  <td>${dp.tipoDespesa || '-'}</td>
                  <td>${dp.nomeFornecedor || '-'}</td>
                  <td>${formatCurrency(dp.valorLiquido || 0)}</td>
                  <td>${dp.dataDocumento || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const status = d.ultimoStatus || {};
    document.getElementById('modal-body').innerHTML = `
      <div class="detail-section">
        <h3>Informacoes Pessoais</h3>
        <div style="display:flex;gap:1.5rem;align-items:flex-start;margin-bottom:1rem;">
          <img class="card-avatar" src="${status.urlFoto || ''}" alt="" style="width:100px;height:100px;">
          <div class="detail-grid" style="flex:1;">
            <div class="detail-item">
              <span class="detail-label">Nome Civil</span>
              <span class="detail-value">${d.nomeCivil || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Nome Parlamentar</span>
              <span class="detail-value">${status.nome || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Partido / UF</span>
              <span class="detail-value">${status.siglaPartido || '-'} / ${status.siglaUf || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Situacao</span>
              <span class="detail-value">${status.situacao || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Data de Nascimento</span>
              <span class="detail-value">${formatDate(d.dataNascimento)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Naturalidade</span>
              <span class="detail-value">${d.municipioNascimento || '-'} / ${d.ufNascimento || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Escolaridade</span>
              <span class="detail-value">${d.escolaridade || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">CPF</span>
              <span class="detail-value">${d.cpf || '-'}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Contato e Gabinete</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Email</span>
            <span class="detail-value">${status.email || d.email || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Gabinete</span>
            <span class="detail-value">Sala ${status.gabinete?.sala || '-'}, Predio ${status.gabinete?.predio || '-'}, Andar ${status.gabinete?.andar || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Telefone</span>
            <span class="detail-value">${status.gabinete?.telefone || '-'}</span>
          </div>
        </div>
      </div>

      ${despesasHTML}
    `;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = '<p>Erro ao carregar detalhes.</p>';
    console.error(e);
  }
}

// ==================== SENADORES ====================
async function buscarSenadores() {
  loading('sen-results');

  if (state.senController) state.senController.abort();
  state.senController = new AbortController();

  const nome = document.getElementById('sen-nome').value;
  const partido = document.getElementById('sen-partido').value;
  const uf = document.getElementById('sen-uf').value;

  const params = new URLSearchParams();
  if (nome) params.set('nome', nome);
  if (partido) params.set('siglaPartido', partido);
  if (uf) params.set('siglaUf', uf);

  try {
    const res = await fetch(`/api/senado/senadores?${params}`, {
      signal: state.senController.signal
    });
    const data = await res.json();
    const senadores = data.dados || [];

    if (senadores.length === 0) {
      emptyState('sen-results', 'Nenhum senador encontrado.');
      document.getElementById('sen-stats').innerHTML = '';
      return;
    }

    const partidos = {};
    senadores.forEach(s => {
      const p = s.IdentificacaoParlamentar?.SiglaPartidoParlamentar || '?';
      partidos[p] = (partidos[p] || 0) + 1;
    });

    const topPartidos = Object.entries(partidos).sort((a,b) => b[1] - a[1]).slice(0, 3);

    document.getElementById('sen-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${senadores.length}</div>
        <div class="stat-label">Senadores encontrados</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${Object.keys(partidos).length}</div>
        <div class="stat-label">Partidos</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${topPartidos.map(p => p[0]).join(', ')}</div>
        <div class="stat-label">Maiores bancadas</div>
      </div>
    `;

    document.getElementById('sen-results').innerHTML = senadores.map(s => {
      const id = s.IdentificacaoParlamentar;
      return `
        <div class="card" onclick="verSenador('${id?.CodigoParlamentar}')">
          <div class="card-header">
            <img class="card-avatar" src="${id?.UrlFotoParlamentar || ''}" alt="${id?.NomeParlamentar || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2240%22>${(id?.NomeParlamentar || '?')[0]}</text></svg>'">
            <div>
              <div class="card-name">${id?.NomeParlamentar || '-'} ${badgeJudicial('senador', id?.CodigoParlamentar)}</div>
              <div class="card-subtitle">${id?.NomeCompletoParlamentar || ''}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="card-tags">
              <span class="tag tag-partido">${id?.SiglaPartidoParlamentar || '-'}</span>
              <span class="tag tag-uf">${id?.UfParlamentar || '-'}</span>
              <span class="tag tag-situacao">${id?.FormaTratamento || 'Senador(a)'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    emptyState('sen-results', 'Erro ao buscar senadores. Tente novamente.');
    console.error(e);
  }
}

async function verSenador(codigo) {
  document.getElementById('modal-title').textContent = 'Carregando...';
  document.getElementById('modal-body').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  document.getElementById('modal-overlay').classList.add('active');

  try {
    const res = await fetch(`/api/senado/senadores/${codigo}`);
    const data = await res.json();

    const parlamentar = data?.DetalheParlamentar?.Parlamentar;
    if (!parlamentar) {
      document.getElementById('modal-body').innerHTML = '<p>Dados nao disponiveis.</p>';
      return;
    }

    const id = parlamentar.IdentificacaoParlamentar || {};
    const dadosBasicos = parlamentar.DadosBasicosParlamentar || {};

    document.getElementById('modal-title').textContent = id.NomeCompletoParlamentar || id.NomeParlamentar || 'Senador';

    // Mandatos
    let mandatos = parlamentar.MandatoAtual || parlamentar.Mandatos?.Mandato || [];
    if (!Array.isArray(mandatos)) mandatos = [mandatos];

    const mandatosHTML = mandatos.length > 0 ? `
      <div class="detail-section">
        <h3>Mandatos</h3>
        ${mandatos.map(m => `
          <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
            <strong>${m.DescricaoParticipacao || 'Titular'}</strong> -
            Legislatura ${m.PrimeiraLegislaturaDoMandato?.NumeroLegislatura || m.NumeroLegislatura || '-'}
            ${m.UfParlamentar ? ` (${m.UfParlamentar})` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    document.getElementById('modal-body').innerHTML = `
      <div class="detail-section">
        <h3>Informacoes Pessoais</h3>
        <div style="display:flex;gap:1.5rem;align-items:flex-start;margin-bottom:1rem;">
          <img class="card-avatar" src="${id.UrlFotoParlamentar || ''}" alt="" style="width:100px;height:100px;">
          <div class="detail-grid" style="flex:1;">
            <div class="detail-item">
              <span class="detail-label">Nome Parlamentar</span>
              <span class="detail-value">${id.NomeParlamentar || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Nome Completo</span>
              <span class="detail-value">${id.NomeCompletoParlamentar || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Partido / UF</span>
              <span class="detail-value">${id.SiglaPartidoParlamentar || '-'} / ${id.UfParlamentar || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Sexo</span>
              <span class="detail-value">${dadosBasicos.SexoParlamentar || id.SexoParlamentar || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Data de Nascimento</span>
              <span class="detail-value">${formatDate(dadosBasicos.DataNascimento)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Naturalidade</span>
              <span class="detail-value">${dadosBasicos.NaturalidadeParlamentar || '-'} / ${dadosBasicos.UfNaturalidade || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Email</span>
              <span class="detail-value">${id.EmailParlamentar || '-'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Pagina</span>
              <span class="detail-value">${id.UrlPaginaParlamentar ? `<a href="${id.UrlPaginaParlamentar}" target="_blank">Ver no Senado</a>` : '-'}</span>
            </div>
          </div>
        </div>
      </div>
      ${mandatosHTML}
    `;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = '<p>Erro ao carregar detalhes.</p>';
    console.error(e);
  }
}

// ==================== TSE ====================
async function buscarTSE() {
  loading('tse-results');

  const ano = document.getElementById('tse-ano').value;
  const tipo = document.getElementById('tse-tipo').value;

  const url = tipo === 'candidatos'
    ? `/api/tse/candidatos/${ano}`
    : `/api/tse/prestacao-contas/${ano}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.erro) {
      emptyState('tse-results', data.erro);
      return;
    }

    const recursos = data.recursos || [];

    document.getElementById('tse-results').innerHTML = `
      <div class="dataset-card">
        <h3>${data.titulo || 'Dataset do TSE'}</h3>
        <p style="color:var(--text-light);margin-bottom:1rem;">${data.descricao || ''}</p>
        ${data.atualizado ? `<p style="font-size:0.85rem;color:var(--text-light);margin-bottom:1rem;">Ultima atualizacao: ${formatDate(data.atualizado)}</p>` : ''}
        ${data.tags ? `<div class="card-tags" style="margin-bottom:1rem;">${data.tags.map(t => `<span class="tag tag-partido">${t}</span>`).join('')}</div>` : ''}
        <h4 style="margin-bottom:0.5rem;">Arquivos para Download</h4>
        <ul class="resource-list">
          ${recursos.map(r => `
            <li>
              <a href="${r.url}" target="_blank">${r.nome || 'Arquivo'}</a>
              <span class="resource-format">${r.formato || '?'}</span>
            </li>
          `).join('')}
        </ul>
        ${recursos.length === 0 ? '<p style="color:var(--text-light);">Nenhum recurso disponivel para este ano.</p>' : ''}
      </div>
    `;
  } catch (e) {
    emptyState('tse-results', 'Erro ao buscar dados do TSE. Tente novamente.');
    console.error(e);
  }
}

// ==================== NOTICIAS ====================
async function carregarFontes() {
  try {
    const res = await fetch('/api/noticias/fontes');
    const data = await res.json();
    state.fontes = data.dados || [];
    atualizarFontes();
  } catch (e) {
    console.error('Erro ao carregar fontes:', e);
  }
}

function atualizarFontes() {
  const sel = document.getElementById('news-fonte');
  const categoria = document.getElementById('news-categoria').value;
  sel.innerHTML = '<option value="">Todas as fontes</option>';

  const fontes = (state.fontes || []).filter(f =>
    !categoria || f.categoria === categoria
  );

  fontes.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.nome;
    sel.appendChild(opt);
  });
}

async function buscarNoticias() {
  loading('news-results');
  document.getElementById('news-stats').innerHTML = '';

  if (state.newsController) state.newsController.abort();
  state.newsController = new AbortController();

  const busca = document.getElementById('news-busca').value;
  const fonte = document.getElementById('news-fonte').value;
  const categoria = document.getElementById('news-categoria').value;

  const params = new URLSearchParams();
  if (busca) params.set('busca', busca);
  if (fonte) params.set('fonte', fonte);
  else if (categoria) params.set('categoria', categoria);

  try {
    const res = await fetch(`/api/noticias?${params}`, {
      signal: state.newsController.signal
    });
    const data = await res.json();
    const noticias = data.dados || [];

    if (noticias.length === 0) {
      emptyState('news-results', 'Nenhuma noticia encontrada.');
      return;
    }

    // Contar por fonte
    const porFonte = {};
    noticias.forEach(n => { porFonte[n.fonte] = (porFonte[n.fonte] || 0) + 1; });
    const totalFontes = Object.keys(porFonte).length;

    document.getElementById('news-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${noticias.length}</div>
        <div class="stat-label">Noticias encontradas</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${totalFontes}</div>
        <div class="stat-label">Fontes ativas</div>
      </div>
    `;

    document.getElementById('news-results').innerHTML = noticias.map(n => `
      <div class="news-card">
        <h3><a href="${n.link}" target="_blank">${n.titulo}</a></h3>
        <div class="news-meta">
          <span class="tag tag-${n.categoria === 'governo' ? 'situacao' : 'partido'}" style="font-size:0.7rem;">${n.fonte}</span>
          <span>${formatDate(n.data)}</span>
        </div>
        <p class="news-desc">${n.descricao}</p>
      </div>
    `).join('');
  } catch (e) {
    if (e.name === 'AbortError') return;
    emptyState('news-results', 'Erro ao buscar noticias. Tente novamente.');
    console.error(e);
  }
}

// ==================== BUSCA GERAL ====================
async function buscaGeral() {
  const termo = document.getElementById('busca-termo').value.trim();

  if (termo.length === 0) {
    document.getElementById('busca-results').innerHTML = '';
    document.getElementById('busca-stats').innerHTML = '';
    return;
  }
  if (termo.length < 2) {
    emptyState('busca-results', 'Digite pelo menos 2 caracteres para buscar.');
    document.getElementById('busca-stats').innerHTML = '';
    return;
  }

  // Cancelar requisicao anterior
  if (state.buscaController) state.buscaController.abort();
  state.buscaController = new AbortController();

  loading('busca-results');
  document.getElementById('busca-stats').innerHTML = '';

  try {
    const res = await fetch(`/api/busca?termo=${encodeURIComponent(termo)}`, {
      signal: state.buscaController.signal
    });
    const data = await res.json();

    if (data.erro) {
      emptyState('busca-results', data.erro);
      return;
    }

    const resultados = data.dados || [];

    if (resultados.length === 0) {
      emptyState('busca-results', `Nenhum resultado para "${termo}".`);
      return;
    }

    document.getElementById('busca-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${data.total}</div>
        <div class="stat-label">Total encontrado</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.deputados}</div>
        <div class="stat-label">Deputados</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.senadores}</div>
        <div class="stat-label">Senadores</div>
      </div>
    `;

    document.getElementById('busca-results').innerHTML = resultados.map(r => {
      const onclick = r.fonte === 'camara'
        ? `verDeputado(${r.id})`
        : `verSenador('${r.id}')`;

      return `
        <div class="card" onclick="${onclick}">
          <div class="card-header">
            <img class="card-avatar" src="${r.foto || ''}" alt="${r.nome}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2240%22>${(r.nome || '?')[0]}</text></svg>'">
            <div>
              <div class="card-name">${r.nome} ${badgeJudicial(r.fonte === 'camara' ? 'deputado' : 'senador', r.id)}</div>
              <div class="card-subtitle">${r.nomeCompleto || r.email || ''}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="card-tags">
              <span class="tag tag-situacao">${r.tipo}</span>
              <span class="tag tag-partido">${r.partido || '-'}</span>
              <span class="tag tag-uf">${r.uf || '-'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (e.name === 'AbortError') return; // busca cancelada por nova digitacao
    emptyState('busca-results', 'Erro na busca. Tente novamente.');
    console.error(e);
  }
}

// ==================== MODAL ====================
function fecharModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-overlay').classList.remove('active');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharModal();
});
