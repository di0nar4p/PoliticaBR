/**
 * PoliticaBR - Modulo do TSE (Tribunal Superior Eleitoral)
 *
 * Rota que consome a API CKAN do portal de Dados Abertos do TSE
 * (https://dadosabertos.tse.jus.br). O TSE disponibiliza datasets
 * em formato bulk (CSV/ZIP), nao uma API REST de consulta individual.
 * Este modulo retorna metadados e links de download dos datasets
 * de candidatos e prestacao de contas eleitorais por ano (2014-2024).
 *
 * @author di0nar4p
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// URL base da API CKAN do TSE
const BASE_URL = 'https://dadosabertos.tse.jus.br/api/3/action';

// Diretorio dos dados locais de fallback
const DATA_DIR = path.join(__dirname, '..', 'data');

// Cliente HTTP configurado para a API do TSE
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
 * Formata um resultado CKAN (package_show) para o formato
 * simplificado usado pelo frontend, extraindo titulo, descricao,
 * recursos para download, tags e data de atualizacao.
 */
function formatDataset(result) {
  if (!result) return null;
  return {
    titulo: result.title,
    descricao: result.notes,
    recursos: (result.resources || []).map(r => ({
      nome: r.name || r.description,
      formato: r.format,
      url: r.url,
      tamanho: r.size
    })),
    tags: (result.tags || []).map(t => t.display_name),
    atualizado: result.metadata_modified
  };
}

/**
 * @openapi
 * /tse/datasets:
 *   get:
 *     summary: Lista datasets do portal do TSE
 *     tags: [TSE]
 *     responses:
 *       200:
 *         description: Lista de datasets disponiveis
 */
router.get('/datasets', async (req, res) => {
  try {
    const response = await api.get('/package_list');
    return res.json(response.data);
  } catch (error) {
    console.log('[tse/datasets] API falhou, usando dados locais:', error.message);
    const local = loadLocal('tse_datasets.json');
    if (!local) return res.status(500).json({ erro: 'Erro ao buscar datasets e sem dados locais' });
    return res.json(local);
  }
});

/**
 * @openapi
 * /tse/dataset/{id}:
 *   get:
 *     summary: Metadados de um dataset do TSE
 *     tags: [TSE]
 *     parameters:
 *       - {name: id, in: path, required: true, schema: {type: string}, description: ID CKAN do dataset}
 *     responses:
 *       200:
 *         description: Metadados do dataset
 */
router.get('/dataset/:id', async (req, res) => {
  try {
    const response = await api.get('/package_show', { params: { id: req.params.id } });
    return res.json(response.data);
  } catch (error) {
    console.log('[tse/dataset] API falhou:', error.message);
    return res.status(500).json({ erro: 'Erro ao buscar dataset', detalhes: error.message });
  }
});

/**
 * @openapi
 * /tse/candidatos/{ano}:
 *   get:
 *     summary: Dataset de candidatos por ano eleitoral
 *     tags: [TSE]
 *     parameters:
 *       - {name: ano, in: path, required: true, schema: {type: integer}, description: "Ano eleitoral (ex: 2022, 2024)"}
 *     responses:
 *       200:
 *         description: Metadados e links de download
 *       404:
 *         description: Dataset nao encontrado para este ano
 */
router.get('/candidatos/:ano', async (req, res) => {
  const ano = req.params.ano;

  try {
    const response = await api.get('/package_show', {
      params: { id: `candidatos-${ano}` }
    });
    const result = response.data?.result;
    if (!result) return res.status(404).json({ erro: 'Dataset nao encontrado' });
    return res.json(formatDataset(result));
  } catch (error) {
    console.log(`[tse/candidatos/${ano}] API falhou, usando dados locais:`, error.message);
    const local = loadLocal(`tse_candidatos_${ano}.json`);
    if (!local || !local.result) {
      return res.status(404).json({ erro: `Dados de candidatos ${ano} nao disponiveis` });
    }
    return res.json(formatDataset(local.result));
  }
});

/**
 * @openapi
 * /tse/prestacao-contas/{ano}:
 *   get:
 *     summary: Dataset de prestacao de contas por ano
 *     tags: [TSE]
 *     parameters:
 *       - {name: ano, in: path, required: true, schema: {type: integer}, description: "Ano eleitoral (ex: 2022, 2024)"}
 *     responses:
 *       200:
 *         description: Metadados e links de download
 *       404:
 *         description: Dataset nao encontrado para este ano
 */
router.get('/prestacao-contas/:ano', async (req, res) => {
  const ano = req.params.ano;

  try {
    const response = await api.get('/package_show', {
      params: { id: `prestacao-de-contas-eleitorais-${ano}` }
    });
    const result = response.data?.result;
    if (!result) return res.status(404).json({ erro: 'Dataset nao encontrado' });
    return res.json(formatDataset(result));
  } catch (error) {
    console.log(`[tse/prestacao/${ano}] API falhou, usando dados locais:`, error.message);
    const local = loadLocal(`tse_prestacao_${ano}.json`);
    if (!local || !local.result) {
      return res.status(404).json({ erro: `Dados de prestacao de contas ${ano} nao disponiveis` });
    }
    return res.json(formatDataset(local.result));
  }
});

module.exports = router;
