/**
 * PoliticaBR - Modulo da Camara dos Deputados
 *
 * Rota que consome a API de Dados Abertos da Camara dos Deputados
 * (https://dadosabertos.camara.leg.br/api/v2). Oferece endpoints para
 * listar deputados, consultar detalhes, despesas, proposicoes, votacoes
 * e partidos. Quando ha busca por nome, utiliza dados locais para
 * permitir busca parcial (a API oficial so suporta busca por prefixo).
 * Em caso de falha na API, faz fallback automatico para dados locais.
 *
 * @author di0nar4p
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// URL base da API de Dados Abertos da Camara
const BASE_URL = 'https://dadosabertos.camara.leg.br/api/v2';

// Diretorio onde ficam os JSONs de fallback local
const DATA_DIR = path.join(__dirname, '..', 'data');

// Cliente HTTP configurado para a API da Camara
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Accept': 'application/json' }
});

/**
 * Carrega um arquivo JSON do diretorio de dados locais.
 * Retorna null se o arquivo nao existir ou for invalido.
 */
function loadLocal(filename) {
  try {
    const filepath = path.join(DATA_DIR, filename);
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Remove acentos e converte para minusculo, permitindo
 * busca parcial insensivel a acentuacao.
 * Ex: "Flávio" -> "flavio"
 */
function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filtra uma lista de itens com base em filtros chave-valor.
 * Para o campo 'nome', usa busca parcial (includes).
 * Para demais campos, usa comparacao exata.
 */
function filterByFields(items, filters) {
  return items.filter(item => {
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      const itemVal = normalize(item[key]);
      const filterVal = normalize(value);
      if (key === 'nome') {
        if (!itemVal.includes(filterVal)) return false;
      } else {
        if (itemVal !== filterVal) return false;
      }
    }
    return true;
  });
}

/**
 * Pagina uma lista de itens e retorna no formato compativel
 * com a API da Camara (com links de navegacao).
 */
function paginate(items, pagina = 1, itens = 15) {
  const start = (pagina - 1) * itens;
  const dados = items.slice(start, start + itens);
  const hasNext = start + itens < items.length;
  const links = [];
  if (hasNext) links.push({ rel: 'next' });
  if (pagina > 1) links.push({ rel: 'previous' });
  return { dados, links };
}

/**
 * GET /deputados
 * Lista deputados com filtros opcionais (nome, partido, UF).
 * Quando ha busca por nome, usa dados locais para busca parcial.
 * Sem nome, consulta a API e faz fallback local se falhar.
 */
router.get('/deputados', async (req, res) => {
  const { nome, siglaPartido, siglaUf, pagina = 1, itens = 15 } = req.query;

  // Busca por nome usa dados locais (API so busca por prefixo)
  if (nome) {
    const local = loadLocal('deputados.json');
    if (!local || !local.dados) {
      return res.status(500).json({ erro: 'Dados locais nao disponiveis' });
    }
    const filtered = filterByFields(local.dados, { nome, siglaPartido, siglaUf });
    return res.json(paginate(filtered, Number(pagina), Number(itens)));
  }

  // Sem nome, consulta a API normalmente
  try {
    const params = { pagina, itens, ordem: 'ASC', ordenarPor: 'nome' };
    if (siglaPartido) params.siglaPartido = siglaPartido;
    if (siglaUf) params.siglaUf = siglaUf;

    const response = await api.get('/deputados', { params });
    return res.json(response.data);
  } catch (error) {
    console.log('[camara/deputados] API falhou, usando dados locais:', error.message);
    const local = loadLocal('deputados.json');
    if (!local || !local.dados) {
      return res.status(500).json({ erro: 'Erro ao buscar deputados e sem dados locais' });
    }
    const filtered = filterByFields(local.dados, { siglaPartido, siglaUf });
    return res.json(paginate(filtered, Number(pagina), Number(itens)));
  }
});

/**
 * GET /deputados/:id
 * Retorna detalhes de um deputado especifico.
 * Fallback local monta uma resposta compativel com o formato da API.
 */
router.get('/deputados/:id', async (req, res) => {
  try {
    const response = await api.get(`/deputados/${encodeURIComponent(req.params.id)}`);
    return res.json(response.data);
  } catch (error) {
    console.log('[camara/deputado] API falhou, usando dados locais:', error.message);
    const local = loadLocal('deputados.json');
    if (!local || !local.dados) {
      return res.status(500).json({ erro: 'Erro ao buscar deputado e sem dados locais' });
    }

    const dep = local.dados.find(d => String(d.id) === String(req.params.id));
    if (!dep) return res.status(404).json({ erro: 'Deputado nao encontrado' });

    // Monta resposta no formato esperado pelo frontend
    return res.json({
      dados: {
        id: dep.id,
        nomeCivil: dep.nome,
        ultimoStatus: {
          nome: dep.nome,
          siglaPartido: dep.siglaPartido,
          siglaUf: dep.siglaUf,
          urlFoto: dep.urlFoto,
          email: dep.email,
          situacao: 'Exercicio',
          gabinete: {}
        },
        urlFoto: dep.urlFoto
      }
    });
  }
});

/**
 * GET /deputados/:id/despesas
 * Retorna despesas parlamentares (cota CEAP) de um deputado.
 * Nao possui fallback local (dados individuais nao sao cacheados).
 */
router.get('/deputados/:id/despesas', async (req, res) => {
  try {
    const { ano, pagina = 1, itens = 30 } = req.query;
    const params = { pagina, itens, ordem: 'DESC', ordenarPor: 'ano' };
    if (ano) params.ano = ano;

    const response = await api.get(`/deputados/${encodeURIComponent(req.params.id)}/despesas`, { params });
    return res.json(response.data);
  } catch (error) {
    console.log('[camara/despesas] API falhou:', error.message);
    return res.json({ dados: [], links: [] });
  }
});

/**
 * GET /proposicoes
 * Lista proposicoes legislativas (PL, PEC, etc.) com filtros.
 */
router.get('/proposicoes', async (req, res) => {
  try {
    const { siglaTipo, ano, pagina = 1, itens = 15 } = req.query;
    const params = { pagina, itens, ordem: 'DESC', ordenarPor: 'id' };
    if (siglaTipo) params.siglaTipo = siglaTipo;
    if (ano) params.ano = ano;

    const response = await api.get('/proposicoes', { params });
    return res.json(response.data);
  } catch (error) {
    return res.status(500).json({ erro: 'Erro ao buscar proposicoes', detalhes: error.message });
  }
});

/**
 * GET /votacoes
 * Lista votacoes recentes do plenario.
 * Fallback para dados locais se a API falhar.
 */
router.get('/votacoes', async (req, res) => {
  try {
    const { pagina = 1, itens = 15 } = req.query;
    const response = await api.get('/votacoes', {
      params: { pagina, itens, ordem: 'DESC', ordenarPor: 'dataHoraRegistro' }
    });
    return res.json(response.data);
  } catch (error) {
    console.log('[camara/votacoes] API falhou, usando dados locais:', error.message);
    const local = loadLocal('votacoes.json');
    if (!local || !local.dados) {
      return res.status(500).json({ erro: 'Erro ao buscar votacoes e sem dados locais' });
    }
    return res.json(paginate(local.dados, Number(req.query.pagina || 1), Number(req.query.itens || 15)));
  }
});

/**
 * GET /partidos
 * Lista todos os partidos politicos registrados.
 * Fallback para dados locais se a API falhar.
 */
router.get('/partidos', async (req, res) => {
  try {
    const response = await api.get('/partidos', {
      params: { itens: 100, ordem: 'ASC', ordenarPor: 'sigla' }
    });
    return res.json(response.data);
  } catch (error) {
    console.log('[camara/partidos] API falhou, usando dados locais:', error.message);
    const local = loadLocal('partidos.json');
    if (!local || !local.dados) {
      return res.status(500).json({ erro: 'Erro ao buscar partidos e sem dados locais' });
    }
    return res.json(local);
  }
});

module.exports = router;
