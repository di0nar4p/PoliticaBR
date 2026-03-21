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

/**
 * Carrega um arquivo JSON do diretorio de dados locais.
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
 * GET /datasets
 * Lista todos os datasets disponiveis no portal do TSE.
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
 * GET /dataset/:id
 * Retorna metadados de um dataset especifico pelo ID CKAN.
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
 * GET /candidatos/:ano
 * Retorna metadados e links de download do dataset de candidatos
 * para um ano eleitoral especifico (ex: 2022, 2024).
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
 * GET /prestacao-contas/:ano
 * Retorna metadados e links de download do dataset de prestacao
 * de contas eleitorais para um ano especifico.
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
