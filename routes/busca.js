/**
 * PoliticaBR - Modulo de Busca Unificada
 *
 * Rota que realiza busca por nome parcial em deputados e senadores
 * simultaneamente, utilizando dados locais (JSON). A busca normaliza
 * acentos e ignora maiusculas/minusculas, permitindo encontrar
 * parlamentares digitando qualquer parte do nome.
 * Ex: "bolsonaro" encontra "Flavio Bolsonaro", "silva" encontra todos com Silva.
 *
 * @author di0nar4p
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Diretorio dos dados locais
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Carrega um arquivo JSON do diretorio de dados locais.
 */
function loadLocal(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Remove acentos e converte para minusculo.
 * Utiliza Unicode NFD para decompor caracteres acentuados
 * e remove os diacriticos com regex.
 */
function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Busca deputados por nome parcial nos dados locais.
 * Retorna array de resultados no formato unificado.
 */
function buscarDeputados(termo) {
  const local = loadLocal('deputados.json');
  if (!local || !local.dados) return [];

  const termoNorm = normalize(termo);
  return local.dados
    .filter(d => normalize(d.nome).includes(termoNorm))
    .map(d => ({
      tipo: 'Deputado(a)',
      id: d.id,
      nome: d.nome,
      partido: d.siglaPartido,
      uf: d.siglaUf,
      foto: d.urlFoto,
      email: d.email,
      fonte: 'camara'     // Indica a origem para o frontend saber qual modal abrir
    }));
}

/**
 * Busca senadores por nome parcial nos dados locais.
 * Compara tanto o nome parlamentar quanto o nome completo.
 * Retorna array de resultados no formato unificado.
 */
function buscarSenadores(termo) {
  const local = loadLocal('senadores.json');
  if (!local) return [];

  // Extrai lista de senadores da estrutura aninhada da API do Senado
  let senadores = [];
  if (local?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar) {
    senadores = local.ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
    if (!Array.isArray(senadores)) senadores = [senadores];
  }

  const termoNorm = normalize(termo);
  return senadores
    .filter(s => {
      const id = s.IdentificacaoParlamentar || {};
      return normalize(id.NomeParlamentar).includes(termoNorm) ||
             normalize(id.NomeCompletoParlamentar).includes(termoNorm);
    })
    .map(s => {
      const id = s.IdentificacaoParlamentar || {};
      return {
        tipo: 'Senador(a)',
        id: id.CodigoParlamentar,
        nome: id.NomeParlamentar,
        nomeCompleto: id.NomeCompletoParlamentar,
        partido: id.SiglaPartidoParlamentar,
        uf: id.UfParlamentar,
        foto: id.UrlFotoParlamentar,
        email: id.EmailParlamentar,
        fonte: 'senado'    // Indica a origem para o frontend saber qual modal abrir
      };
    });
}

/**
 * GET /
 * Busca unificada por nome parcial em deputados e senadores.
 * Requer pelo menos 2 caracteres. Retorna resultados ordenados
 * alfabeticamente com contagem separada por tipo.
 */
router.get('/', (req, res) => {
  const { termo } = req.query;

  if (!termo || termo.trim().length < 2) {
    return res.status(400).json({ erro: 'Informe pelo menos 2 caracteres para buscar' });
  }

  const deputados = buscarDeputados(termo.trim());
  const senadores = buscarSenadores(termo.trim());

  // Junta e ordena alfabeticamente
  const resultados = [...deputados, ...senadores].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR')
  );

  res.json({
    dados: resultados,
    total: resultados.length,
    deputados: deputados.length,
    senadores: senadores.length
  });
});

module.exports = router;
