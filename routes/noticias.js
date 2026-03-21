/**
 * PoliticaBR - Modulo Agregador de Noticias
 *
 * Rota que agrega noticias de 17 fontes via RSS/Atom, incluindo
 * portais governamentais (Camara, Senado, TSE, gov.br, MPF, Agencia Brasil)
 * e portais de noticias (G1, Folha, Estadao, Poder360, CartaCapital,
 * BBC Brasil, Gazeta do Povo, R7). Cada fonte e buscada online primeiro
 * e, em caso de falha, utiliza cache XML local. Suporta filtro por
 * categoria (governo/portal), fonte individual e busca textual parcial
 * com normalizacao de acentos.
 *
 * @author di0nar4p
 */

const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Diretorio dos arquivos XML de cache local
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Mapa de todas as fontes RSS configuradas.
 * Cada entrada contem: URL do feed, arquivo de cache local, nome exibido e categoria.
 * Categorias: 'governo' (fontes oficiais) e 'portal' (veiculos de imprensa).
 */
const RSS_FEEDS = {
  // ======================== GOVERNO / INSTITUCIONAL ========================
  camara: {
    url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias',
    file: 'noticias_camara.xml',
    nome: 'Camara dos Deputados',
    categoria: 'governo'
  },
  camara_politica: {
    url: 'https://www.camara.leg.br/noticias/rss/dinamico/POLITICA',
    file: 'noticias_camara_politica.xml',
    nome: 'Camara - Politica',
    categoria: 'governo'
  },
  senado: {
    url: 'https://www12.senado.leg.br/noticias/@@rss',
    file: 'noticias_senado.xml',
    nome: 'Senado Federal',
    categoria: 'governo'
  },
  agenciabrasil: {
    url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
    file: 'noticias_agenciabrasil.xml',
    nome: 'Agencia Brasil',
    categoria: 'governo'
  },
  govbr: {
    url: 'https://www.gov.br/pt-br/noticias/RSS',
    file: 'noticias_govbr.xml',
    nome: 'Portal gov.br',
    categoria: 'governo'
  },
  tse: {
    url: 'https://www.tse.jus.br/rss',
    file: 'noticias_tse.xml',
    nome: 'TSE',
    categoria: 'governo'
  },
  mpf: {
    url: 'https://www.mpf.mp.br/RSS',
    file: 'noticias_mpf.xml',
    nome: 'Ministerio Publico Federal',
    categoria: 'governo'
  },

  // ======================== PORTAIS DE NOTICIAS ========================
  g1_politica: {
    url: 'https://g1.globo.com/rss/g1/politica/',
    file: 'noticias_g1_politica.xml',
    nome: 'G1 Politica',
    categoria: 'portal'
  },
  folha_poder: {
    url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',
    file: 'noticias_folha_poder.xml',
    nome: 'Folha - Poder',
    categoria: 'portal'
  },
  estadao_politica: {
    url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/',
    file: 'noticias_estadao_politica.xml',
    nome: 'Estadao - Politica',
    categoria: 'portal'
  },
  poder360: {
    url: 'https://www.poder360.com.br/feed/',
    file: 'noticias_poder360.xml',
    nome: 'Poder360',
    categoria: 'portal'
  },
  cartacapital: {
    url: 'https://www.cartacapital.com.br/politica/feed/',
    file: 'noticias_cartacapital.xml',
    nome: 'CartaCapital - Politica',
    categoria: 'portal'
  },
  bbc_brasil: {
    url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',
    file: 'noticias_bbc_brasil.xml',
    nome: 'BBC Brasil',
    categoria: 'portal'
  },
  gazeta_politica: {
    url: 'https://www.gazetadopovo.com.br/feed/rss/republica.xml',
    file: 'noticias_gazeta_politica.xml',
    nome: 'Gazeta do Povo - Republica',
    categoria: 'portal'
  },
  gazeta_congresso: {
    url: 'https://www.gazetadopovo.com.br/feed/rss/tudo-sobre/congresso-nacional.xml',
    file: 'noticias_gazeta_congresso.xml',
    nome: 'Gazeta do Povo - Congresso',
    categoria: 'portal'
  },
  gazeta_stf: {
    url: 'https://www.gazetadopovo.com.br/feed/rss/tudo-sobre/stf.xml',
    file: 'noticias_gazeta_stf.xml',
    nome: 'Gazeta do Povo - STF',
    categoria: 'portal'
  },
  r7: {
    url: 'https://noticias.r7.com/feed.xml',
    file: 'noticias_r7.xml',
    nome: 'R7 Noticias',
    categoria: 'portal'
  }
};

/**
 * Extrai e normaliza itens de um canal RSS/Atom/RDF.
 * Lida com diferentes formatos de link (string, objeto, array)
 * e remove tags HTML das descricoes. Limita a 20 itens por feed.
 */
function parseItems(channel, fonte, categoria) {
  let items = channel.item || channel.entry || [];
  if (!Array.isArray(items)) items = [items];

  return items.slice(0, 20).map(item => {
    // Normaliza o campo link (varia entre formatos RSS/Atom/RDF)
    let link = item.link || '';
    if (typeof link === 'object') link = link.$?.href || link._ || '';
    if (Array.isArray(link)) link = link[0]?.$?.href || link[0] || '';

    return {
      titulo: item.title?._ || item.title || '',
      link,
      descricao: (item.description?._ || item.description || item.summary?._ || item.summary || '').replace(/<[^>]*>/g, '').substring(0, 300),
      data: item.pubDate || item['dc:date'] || item.published || item.updated || '',
      fonte,
      categoria
    };
  });
}

/**
 * Busca um feed RSS por chave. Tenta online primeiro (timeout 8s),
 * e em caso de falha usa o arquivo XML de cache local.
 * Suporta formatos RSS 2.0, RSS 0.91, Atom e RDF.
 */
async function fetchRSS(key) {
  const feed = RSS_FEEDS[key];
  const parser = new xml2js.Parser({ explicitArray: false });

  // Tenta buscar online
  try {
    const response = await axios.get(feed.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'PoliticaBR/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate'
      },
      decompress: true
    });
    const result = await parser.parseStringPromise(response.data);
    const channel = result?.rss?.channel || result?.feed || result?.['rdf:RDF'];
    if (channel) return parseItems(channel, feed.nome, feed.categoria);
  } catch (error) {
    console.log(`[noticias/${key}] RSS online falhou, usando cache local:`, error.message);
  }

  // Fallback: cache XML local
  try {
    const filepath = path.join(DATA_DIR, feed.file);
    const xml = fs.readFileSync(filepath, 'utf-8');
    const result = await parser.parseStringPromise(xml);
    const channel = result?.rss?.channel || result?.feed || result?.['rdf:RDF'];
    if (channel) return parseItems(channel, feed.nome + ' (cache)', feed.categoria);
  } catch {
    // Sem cache local disponivel
  }

  return [];
}

/**
 * GET /fontes
 * Lista todas as fontes de noticias configuradas (id, nome, categoria).
 * Usado pelo frontend para popular o select de filtro de fontes.
 */
router.get('/fontes', (req, res) => {
  const fontes = Object.entries(RSS_FEEDS).map(([key, feed]) => ({
    id: key,
    nome: feed.nome,
    categoria: feed.categoria
  }));
  res.json({ dados: fontes });
});

/**
 * GET /
 * Busca noticias de todas as fontes (ou filtradas por fonte/categoria).
 * Suporta busca textual parcial com normalizacao de acentos.
 * Todos os feeds sao buscados em paralelo para performance.
 * Resultados sao ordenados por data (mais recentes primeiro).
 */
router.get('/', async (req, res) => {
  try {
    const { fonte, busca, categoria } = req.query;

    // Determina quais feeds buscar com base nos filtros
    let keys;
    if (fonte && RSS_FEEDS[fonte]) {
      keys = [fonte];
    } else if (categoria) {
      keys = Object.entries(RSS_FEEDS)
        .filter(([, f]) => f.categoria === categoria)
        .map(([k]) => k);
    } else {
      keys = Object.keys(RSS_FEEDS);
    }

    // Busca todos os feeds selecionados em paralelo
    const results = await Promise.all(keys.map(k => fetchRSS(k)));
    let noticias = results.flat();

    // Filtra por termo de busca (parcial, sem acentos)
    if (busca) {
      const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const termoNorm = norm(busca);
      noticias = noticias.filter(n =>
        norm(n.titulo).includes(termoNorm) ||
        norm(n.descricao).includes(termoNorm) ||
        norm(n.fonte).includes(termoNorm)
      );
    }

    // Ordena por data decrescente
    noticias.sort((a, b) => new Date(b.data) - new Date(a.data));

    res.json({ dados: noticias, total: noticias.length });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar noticias', detalhes: error.message });
  }
});

module.exports = router;
