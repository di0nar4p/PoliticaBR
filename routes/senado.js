/**
 * PoliticaBR - Modulo do Senado Federal
 *
 * Rota que consome a API de Dados Abertos do Senado Federal
 * (https://legis.senado.leg.br/dadosabertos). Oferece endpoints para
 * listar senadores em exercicio, consultar detalhes individuais,
 * votacoes e autorias. Busca por nome utiliza dados locais para
 * permitir busca parcial com normalizacao de acentos.
 *
 * @author di0nar4p
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// URL base da API de Dados Abertos do Senado
const BASE_URL = 'https://legis.senado.leg.br/dadosabertos';

// Diretorio dos dados locais de fallback
const DATA_DIR = path.join(__dirname, '..', 'data');

// Cliente HTTP configurado para a API do Senado
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Accept': 'application/json' }
});

// Cache de dados locais carregado no startup (evita readFileSync a cada request)
const localCache = {};

/**
 * Carrega um arquivo JSON do diretorio de dados locais.
 * Usa cache em memoria apos a primeira leitura.
 */
function loadLocal(filename) {
  if (localCache[filename] !== undefined) return localCache[filename];
  try {
    const filepath = path.join(DATA_DIR, filename);
    const raw = fs.readFileSync(filepath, 'utf-8');
    localCache[filename] = JSON.parse(raw);
  } catch {
    localCache[filename] = null;
  }
  return localCache[filename];
}

/**
 * Extrai a lista de senadores da estrutura aninhada da API do Senado.
 * A API retorna os dados em: ListaParlamentarEmExercicio.Parlamentares.Parlamentar
 */
function extractSenadores(data) {
  let senadores = [];
  if (data?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar) {
    senadores = data.ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
    if (!Array.isArray(senadores)) senadores = [senadores];
  }
  return senadores;
}

/**
 * Remove acentos e converte para minusculo para busca parcial.
 */
function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filtra senadores por nome (parcial), partido (exato) e UF (exato).
 * A busca por nome compara tanto NomeParlamentar quanto NomeCompletoParlamentar.
 */
function filterSenadores(senadores, { nome, siglaPartido, siglaUf }) {
  if (nome) {
    const termoNorm = normalize(nome);
    senadores = senadores.filter(s => {
      const np = normalize(s.IdentificacaoParlamentar?.NomeParlamentar);
      const nc = normalize(s.IdentificacaoParlamentar?.NomeCompletoParlamentar);
      return np.includes(termoNorm) || nc.includes(termoNorm);
    });
  }
  if (siglaPartido) {
    senadores = senadores.filter(s =>
      (s.IdentificacaoParlamentar?.SiglaPartidoParlamentar || '').toUpperCase() === siglaPartido.toUpperCase()
    );
  }
  if (siglaUf) {
    senadores = senadores.filter(s =>
      (s.IdentificacaoParlamentar?.UfParlamentar || '').toUpperCase() === siglaUf.toUpperCase()
    );
  }
  return senadores;
}

/**
 * @openapi
 * /senado/senadores:
 *   get:
 *     summary: Lista senadores em exercicio
 *     tags: [Senado]
 *     parameters:
 *       - {name: nome, in: query, schema: {type: string}, description: Busca parcial por nome}
 *       - {name: siglaPartido, in: query, schema: {type: string}, description: "Filtro por partido (ex: PT, PL)"}
 *       - {name: siglaUf, in: query, schema: {type: string}, description: "Filtro por UF (ex: SP, RJ)"}
 *     responses:
 *       200:
 *         description: Lista de senadores
 */
router.get('/senadores', async (req, res) => {
  const { nome, siglaPartido, siglaUf, situacaoJudicial } = req.query;

  // Funcao auxiliar para aplicar filtro judicial sobre a lista
  function aplicarFiltroJudicial(senadores) {
    if (!situacaoJudicial) return senadores;
    const judicial = loadLocal('situacao_judicial.json');
    const mapa = judicial?.senadores || {};
    return senadores.filter(s => {
      const codigo = s.IdentificacaoParlamentar?.CodigoParlamentar;
      return mapa[String(codigo)]?.status === situacaoJudicial;
    });
  }

  // Busca por nome usa dados locais (busca parcial com normalize)
  if (nome || situacaoJudicial) {
    const local = loadLocal('senadores.json');
    if (!local) {
      return res.status(500).json({ erro: 'Dados locais nao disponiveis' });
    }
    let senadores = extractSenadores(local);
    senadores = filterSenadores(senadores, { nome, siglaPartido, siglaUf });
    senadores = aplicarFiltroJudicial(senadores);
    return res.json({ dados: senadores, total: senadores.length });
  }

  // Sem filtros especiais, consulta a API normalmente
  try {
    const response = await api.get('/senador/lista/atual');
    let senadores = extractSenadores(response.data);
    senadores = filterSenadores(senadores, { siglaPartido, siglaUf });
    return res.json({ dados: senadores, total: senadores.length });
  } catch (error) {
    console.log('[senado/senadores] API falhou, usando dados locais:', error.message);
    const local = loadLocal('senadores.json');
    if (!local) {
      return res.status(500).json({ erro: 'Erro ao buscar senadores e sem dados locais' });
    }
    let senadores = extractSenadores(local);
    senadores = filterSenadores(senadores, { siglaPartido, siglaUf });
    return res.json({ dados: senadores, total: senadores.length });
  }
});

/**
 * @openapi
 * /senado/senadores/{codigo}:
 *   get:
 *     summary: Detalhes de um senador
 *     tags: [Senado]
 *     parameters:
 *       - {name: codigo, in: path, required: true, schema: {type: string}, description: Codigo parlamentar}
 *     responses:
 *       200:
 *         description: Dados detalhados do senador
 *       404:
 *         description: Senador nao encontrado
 */
router.get('/senadores/:codigo', async (req, res) => {
  try {
    const response = await api.get(`/senador/${encodeURIComponent(req.params.codigo)}`);
    return res.json(response.data);
  } catch (error) {
    console.log('[senado/senador] API falhou, usando dados locais:', error.message);
    const local = loadLocal('senadores.json');
    if (!local) {
      return res.status(500).json({ erro: 'Erro ao buscar senador e sem dados locais' });
    }

    const senadores = extractSenadores(local);
    const sen = senadores.find(s =>
      String(s.IdentificacaoParlamentar?.CodigoParlamentar) === String(req.params.codigo)
    );

    if (!sen) return res.status(404).json({ erro: 'Senador nao encontrado' });

    // Monta resposta no formato esperado pelo frontend
    return res.json({
      DetalheParlamentar: {
        Parlamentar: {
          IdentificacaoParlamentar: sen.IdentificacaoParlamentar,
          DadosBasicosParlamentar: {},
          Mandatos: sen.Mandatos || {}
        }
      }
    });
  }
});

/**
 * @openapi
 * /senado/senadores/{codigo}/votacoes:
 *   get:
 *     summary: Votacoes de um senador
 *     tags: [Senado]
 *     parameters:
 *       - {name: codigo, in: path, required: true, schema: {type: string}}
 *       - {name: ano, in: query, schema: {type: integer}}
 *     responses:
 *       200:
 *         description: Historico de votacoes
 */
router.get('/senadores/:codigo/votacoes', async (req, res) => {
  try {
    const { ano } = req.query;
    let url = `/senador/${encodeURIComponent(req.params.codigo)}/votacoes`;
    if (ano) url += `?ano=${encodeURIComponent(ano)}`;
    const response = await api.get(url);
    return res.json(response.data);
  } catch (error) {
    console.log('[senado/votacoes] API falhou:', error.message);
    return res.json({ dados: [] });
  }
});

/**
 * @openapi
 * /senado/senadores/{codigo}/autorias:
 *   get:
 *     summary: Projetos de autoria de um senador
 *     tags: [Senado]
 *     parameters:
 *       - {name: codigo, in: path, required: true, schema: {type: string}}
 *     responses:
 *       200:
 *         description: Lista de autorias
 */
router.get('/senadores/:codigo/autorias', async (req, res) => {
  try {
    const response = await api.get(`/senador/${encodeURIComponent(req.params.codigo)}/autorias`);
    return res.json(response.data);
  } catch (error) {
    console.log('[senado/autorias] API falhou:', error.message);
    return res.json({ dados: [] });
  }
});

module.exports = router;
