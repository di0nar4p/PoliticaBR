/**
 * PoliticaBR - Servidor Principal
 *
 * Servidor Express que atua como backend da aplicacao PoliticaBR,
 * agregando dados de diversas APIs publicas do governo brasileiro.
 * Serve os arquivos estaticos do frontend e roteia as requisicoes
 * para os modulos especializados de cada fonte de dados.
 *
 * @author di0nar4p
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Importacao das rotas de cada modulo de dados
const camaraRoutes = require('./routes/camara');     // API Camara dos Deputados
const senadoRoutes = require('./routes/senado');      // API Senado Federal
const tseRoutes = require('./routes/tse');            // API TSE (dados eleitorais)
const noticiasRoutes = require('./routes/noticias');  // Agregador de noticias via RSS
const buscaRoutes = require('./routes/busca');        // Busca unificada por nome parcial

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globais
app.use(cors());                                            // Permite requisicoes cross-origin
app.use(express.json());                                    // Parse de JSON no body das requests
app.use(express.static(path.join(__dirname, 'public')));    // Serve arquivos estaticos (HTML, CSS, JS)

// Registro das rotas da API
app.use('/api/camara', camaraRoutes);       // /api/camara/deputados, /api/camara/partidos, etc.
app.use('/api/senado', senadoRoutes);       // /api/senado/senadores, /api/senado/senadores/:codigo, etc.
app.use('/api/tse', tseRoutes);             // /api/tse/candidatos/:ano, /api/tse/prestacao-contas/:ano, etc.
app.use('/api/noticias', noticiasRoutes);   // /api/noticias, /api/noticias/fontes
app.use('/api/busca', buscaRoutes);         // /api/busca?termo=nome

// Rota raiz - serve a pagina principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializacao do servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
