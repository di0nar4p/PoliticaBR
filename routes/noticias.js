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
const { Buffer } = require('buffer');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Diretorio dos arquivos XML de cache local
const DATA_DIR = path.join(__dirname, '..', 'data');

// Cache em memoria para feeds RSS (evita re-fetch a cada request)
const feedCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

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
    url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',
    file: 'noticias_agenciabrasil.xml',
    nome: 'Agencia Brasil - Politica',
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
    categoria: 'portal',
    filtrarPolitica: true
  },
  cartacapital: {
    url: 'https://www.cartacapital.com.br/politica/feed/',
    file: 'noticias_cartacapital.xml',
    nome: 'CartaCapital - Politica',
    categoria: 'portal',
    filtrarPolitica: true
  },
  bbc_brasil: {
    url: 'https://feeds.bbci.co.uk/portuguese/brasil/rss.xml',
    file: 'noticias_bbc_brasil.xml',
    nome: 'BBC Brasil',
    categoria: 'portal',
    filtrarPolitica: true
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
};

// Termos para filtrar noticias de feeds generalistas por relevancia politica brasileira.
// Atualizado em 2026-03. Nomes de politicos devem ser revisados apos cada eleicao.
const TERMOS_POLITICA = [
  // Instituicoes brasileiras (inequivocamente politicas)
  'congresso nacional', 'senado federal', 'camara dos deputados',
  'planalto', 'palacio da alvorada', 'supremo tribunal federal',
  'stf', 'tse', 'tcu', 'cgu', 'pgr', 'policia federal',
  'ministerio publico', 'mpf', 'justica federal',
  'tribunal de contas', 'tribunal superior', 'advocacia-geral',

  // Cargos politicos
  'senador', 'senadora', 'deputad', 'vereador', 'vereadora',
  'governador', 'governadora', 'prefeito', 'prefeita',
  'ministr', 'presidente lula', 'presidente da republica', 'vice-presidente',

  // Termos politicos gerais (seguros por serem usados em feeds ja brasileiros)
  'politic', 'congresso', 'senado', 'legislativ',

  // Processos legislativos e juridicos
  'pec ', 'medida provisoria', 'plenario', 'relator',
  'votacao', 'eleicao', 'eleitora', 'impeachment', 'cpi',
  'oposicao', 'coalizao', 'base aliada', 'base governista',
  'delacao', 'indiciamento', 'cassacao', 'inelegib',
  'justica militar', 'stj', 'ditadura',

  // Politica economica
  'reforma tributar', 'reforma administr', 'orcamento federal',
  'privatiza', 'estatal', 'regulament',
  'corrupcao', 'lavagem de dinheiro',

  // Politica externa
  'itamaraty', 'politica externa', 'diplomaci',

  // Politicos em exercicio (atualizar periodicamente)
  'lula', 'alckmin', 'pacheco', 'haddad', 'moraes', 'barroso',
  'bolsonaro', 'tarcisio', 'hugo motta', 'randolfe', 'flavio dino',
  'zanin', 'fachin', 'gilmar mendes', 'galipolo', 'tebet',
  'nunes marques', 'ciro gomes', 'boulos'
];

// Termos que indicam conteudo exclusivamente internacional (sem nexo brasileiro).
// Se um item contem um destes, so e mantido se tambem mencionar o Brasil.
const TERMOS_EXCLUSAO = [
  'trump', 'biden', 'casa branca', 'white house',
  'kremlin', 'putin', 'zelensky', 'kiev',
  'parlamento europeu', 'nato', 'otan',
  'xi jinping', 'partido comunista chines'
];

// Termos que confirmam nexo brasileiro quando ha termo de exclusao
const TERMOS_NEXO_BR = [
  'brasil', 'brasileir', 'lula', 'planalto', 'itamaraty',
  'congresso nacional', 'senado federal', 'camara dos deputados',
  'stf', 'haddad', 'alckmin', 'bolsonaro', 'governo federal'
];

/**
 * Extrai e normaliza itens de um canal RSS/Atom/RDF.
 * Lida com diferentes formatos de link (string, objeto, array)
 * e remove tags HTML das descricoes. Limita a 20 itens por feed.
 */
function parseItems(channel, fonte, categoria, filtrarPolitica = false) {
  let items = channel.item || channel.entry || [];
  if (!Array.isArray(items)) items = [items];

  // Filtra itens que nao sao noticias (ex: Folder, Document, Collection do MPF)
  items = items.filter(item => {
    const tipo = item['dc:type'];
    if (!tipo) return true;
    return tipo === 'Noticia' || tipo === 'News Item';
  });

  // Filtra por relevancia politica em feeds generalistas
  if (filtrarPolitica) {
    items = items.filter(item => {
      const texto = ((item.title?._ || item.title || '') + ' ' +
        (item.description?._ || item.description || item.summary?._ || item.summary || ''))
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Precisa conter ao menos um termo politico
      if (!TERMOS_POLITICA.some(t => texto.includes(t))) return false;

      // Se contem termo de exclusao internacional, so mantem com nexo brasileiro
      if (TERMOS_EXCLUSAO.some(t => texto.includes(t))) {
        return TERMOS_NEXO_BR.some(t => texto.includes(t));
      }

      return true;
    });
  }

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
 * Busca um feed RSS por chave com cache em memoria (TTL 5 min).
 * Tenta online primeiro (timeout 8s), e em caso de falha usa
 * o arquivo XML de cache local. Suporta RSS 2.0, RSS 0.91, Atom e RDF.
 */
async function fetchRSS(key) {
  // Retorna do cache se ainda valido
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

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
      decompress: true,
      responseType: 'arraybuffer'
    });
    const buf = Buffer.from(response.data);
    // Detecta encoding pelo Content-Type ou pela declaracao XML
    let encoding = 'utf-8';
    const ct = (response.headers['content-type'] || '').toLowerCase();
    const charsetMatch = ct.match(/charset=([^\s;]+)/);
    if (charsetMatch) {
      encoding = charsetMatch[1];
    } else {
      // Faz leitura parcial como latin1 para inspecionar a declaracao XML
      const head = buf.slice(0, 200).toString('latin1');
      const xmlMatch = head.match(/encoding=["']([^"']+)["']/i);
      if (xmlMatch) encoding = xmlMatch[1];
    }
    const xmlStr = iconv.decode(buf, encoding);
    const result = await parser.parseStringPromise(xmlStr);
    const channel = result?.rss?.channel || result?.feed || result?.['rdf:RDF'];
    if (channel) {
      const items = parseItems(channel, feed.nome, feed.categoria, feed.filtrarPolitica);
      feedCache.set(key, { data: items, time: Date.now() });
      return items;
    }
  } catch (error) {
    console.log(`[noticias/${key}] RSS online falhou, usando cache local:`, error.message);
  }

  // Fallback: cache XML local
  try {
    const filepath = path.join(DATA_DIR, feed.file);
    const raw = fs.readFileSync(filepath);
    const head = raw.slice(0, 200).toString('latin1');
    const encMatch = head.match(/encoding=["']([^"']+)["']/i);
    const xml = iconv.decode(raw, encMatch ? encMatch[1] : 'utf-8');
    const result = await parser.parseStringPromise(xml);
    const channel = result?.rss?.channel || result?.feed || result?.['rdf:RDF'];
    if (channel) {
      const items = parseItems(channel, feed.nome + ' (cache)', feed.categoria, feed.filtrarPolitica);
      feedCache.set(key, { data: items, time: Date.now() });
      return items;
    }
  } catch {
    // Sem cache local disponivel
  }

  return [];
}

/**
 * @openapi
 * /noticias/fontes:
 *   get:
 *     summary: Lista fontes de noticias configuradas
 *     tags: [Noticias]
 *     responses:
 *       200:
 *         description: Lista de fontes (id, nome, categoria)
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
 * @openapi
 * /noticias:
 *   get:
 *     summary: Busca noticias politicas de todas as fontes
 *     tags: [Noticias]
 *     parameters:
 *       - {name: fonte, in: query, schema: {type: string}, description: "ID da fonte (ex: g1_politica, folha_poder)"}
 *       - {name: categoria, in: query, schema: {type: string, enum: [governo, portal]}, description: Filtro por categoria}
 *       - {name: busca, in: query, schema: {type: string}, description: Busca textual parcial}
 *     responses:
 *       200:
 *         description: Lista de noticias ordenadas por data
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
    const results = await Promise.allSettled(keys.map(k => fetchRSS(k)));
    let noticias = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

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
