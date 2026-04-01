/**
 * PoliticaBR - Rota de Situacao Judicial
 *
 * Serve dados sobre a situacao judicial de parlamentares
 * (condenacoes e investigacoes) baseados em fontes publicas.
 * Os dados sao mantidos em arquivo JSON curado manualmente.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const localCache = {};

function loadLocal(filename) {
  if (localCache[filename] !== undefined) return localCache[filename];
  try {
    localCache[filename] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
  } catch {
    localCache[filename] = null;
  }
  return localCache[filename];
}

/**
 * @openapi
 * /judicial:
 *   get:
 *     summary: Mapa completo de situacao judicial dos parlamentares
 *     tags: [Judicial]
 *     responses:
 *       200:
 *         description: Mapa de deputados e senadores com pendencias judiciais
 */
router.get('/', (req, res) => {
  const data = loadLocal('situacao_judicial.json');
  if (!data) {
    return res.status(500).json({ erro: 'Dados judiciais nao disponiveis' });
  }
  res.json({
    deputados: data.deputados || {},
    senadores: data.senadores || {}
  });
});

/**
 * @openapi
 * /judicial/deputado/{id}:
 *   get:
 *     summary: Situacao judicial de um deputado
 *     tags: [Judicial]
 *     parameters:
 *       - {name: id, in: path, required: true, schema: {type: integer}, description: ID do deputado}
 *     responses:
 *       200:
 *         description: Dados judiciais do deputado
 *       404:
 *         description: Sem registro judicial para este deputado
 */
router.get('/deputado/:id', (req, res) => {
  const data = loadLocal('situacao_judicial.json');
  const info = data?.deputados?.[String(req.params.id)];
  if (!info) return res.status(404).json({ erro: 'Sem registro judicial' });
  res.json(info);
});

/**
 * @openapi
 * /judicial/senador/{codigo}:
 *   get:
 *     summary: Situacao judicial de um senador
 *     tags: [Judicial]
 *     parameters:
 *       - {name: codigo, in: path, required: true, schema: {type: string}, description: Codigo parlamentar}
 *     responses:
 *       200:
 *         description: Dados judiciais do senador
 *       404:
 *         description: Sem registro judicial para este senador
 */
router.get('/senador/:codigo', (req, res) => {
  const data = loadLocal('situacao_judicial.json');
  const info = data?.senadores?.[String(req.params.codigo)];
  if (!info) return res.status(404).json({ erro: 'Sem registro judicial' });
  res.json(info);
});

module.exports = router;
