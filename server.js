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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

// Importacao das rotas de cada modulo de dados
const camaraRoutes = require('./routes/camara');     // API Camara dos Deputados
const senadoRoutes = require('./routes/senado');      // API Senado Federal
const tseRoutes = require('./routes/tse');            // API TSE (dados eleitorais)
const noticiasRoutes = require('./routes/noticias');  // Agregador de noticias via RSS
const buscaRoutes = require('./routes/busca');        // Busca unificada por nome parcial
const judicialRoutes = require('./routes/judicial');  // Situacao judicial de parlamentares

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globais
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : undefined; // undefined = permite todas em desenvolvimento
app.use(cors({ origin: allowedOrigins }));
app.use(helmet({ contentSecurityPolicy: false }));          // Headers de seguranca (CSP desabilitado para nao bloquear inline scripts do frontend)
app.use(compression());                                     // Compressao gzip das respostas
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 200,                  // maximo de requests por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisicoes. Tente novamente em alguns minutos.' }
}));
app.use(express.json());

// Sanitizacao de query params (limita tamanho e remove caracteres perigosos)
app.use((req, res, next) => {
  for (const [key, val] of Object.entries(req.query)) {
    if (typeof val === 'string') {
      if (val.length > 200) {
        return res.status(400).json({ erro: `Parametro "${key}" excede o tamanho maximo` });
      }
      req.query[key] = val.replace(/[<>]/g, '');
    }
  }
  next();
});

// Health check para monitoramento (antes do static para nao ser interceptado)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Documentacao da API (Swagger/OpenAPI)
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PoliticaBR API',
      version: '1.0.0',
      description: 'API de dados abertos do governo brasileiro. Agrega informacoes da Camara dos Deputados, Senado Federal, TSE e noticias de 16 fontes via RSS.',
    },
    servers: [{ url: '/api' }],
  },
  apis: ['./routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'PoliticaBR - API Docs',
}));

app.use(express.static(path.join(__dirname, 'public')));

// Registro das rotas da API
app.use('/api/camara', camaraRoutes);       // /api/camara/deputados, /api/camara/partidos, etc.
app.use('/api/senado', senadoRoutes);       // /api/senado/senadores, /api/senado/senadores/:codigo, etc.
app.use('/api/tse', tseRoutes);             // /api/tse/candidatos/:ano, /api/tse/prestacao-contas/:ano, etc.
app.use('/api/noticias', noticiasRoutes);   // /api/noticias, /api/noticias/fontes
app.use('/api/busca', buscaRoutes);         // /api/busca?termo=nome
app.use('/api/judicial', judicialRoutes);   // /api/judicial, /api/judicial/deputado/:id, etc.

// Rota raiz - serve a pagina principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicia o servidor apenas quando executado diretamente (nao em testes)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Documentacao da API em http://localhost:${PORT}/api-docs`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM recebido, encerrando conexoes...');
    server.close(() => process.exit(0));
  });
}

module.exports = app;
