const request = require('supertest');
const app = require('../server');

describe('Health check', () => {
  test('GET /health retorna status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('Sanitizacao de query params', () => {
  test('Remove caracteres < e > dos parametros', async () => {
    const res = await request(app).get('/api/busca?termo=<script>alert</script>');
    // O termo sanitizado fica "scriptalert/script" (sem < >)
    // Pode retornar erro (termo invalido) ou dados — o importante e nao ter XSS
    expect(res.body.erro || res.body.dados).toBeDefined();
    // Verifica que nenhum campo na resposta contem <script>
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('<script>');
  });

  test('Rejeita parametro muito longo (>200 chars)', async () => {
    const long = 'a'.repeat(201);
    const res = await request(app).get(`/api/busca?termo=${long}`);
    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/excede/);
  });
});

describe('Busca unificada', () => {
  test('GET /api/busca sem termo retorna 400', async () => {
    const res = await request(app).get('/api/busca');
    expect(res.status).toBe(400);
    expect(res.body.erro).toBeDefined();
  });

  test('GET /api/busca com termo curto retorna 400', async () => {
    const res = await request(app).get('/api/busca?termo=a');
    expect(res.status).toBe(400);
  });

  test('GET /api/busca com termo valido retorna resultados', async () => {
    const res = await request(app).get('/api/busca?termo=silva');
    expect(res.status).toBe(200);
    expect(res.body.dados).toBeDefined();
    expect(Array.isArray(res.body.dados)).toBe(true);
    expect(res.body.total).toBeDefined();
  });
});

describe('Camara dos Deputados', () => {
  test('GET /api/camara/deputados retorna lista paginada', async () => {
    const res = await request(app).get('/api/camara/deputados');
    expect(res.status).toBe(200);
    expect(res.body.dados).toBeDefined();
    expect(Array.isArray(res.body.dados)).toBe(true);
  }, 15000);

  test('GET /api/camara/partidos retorna lista', async () => {
    const res = await request(app).get('/api/camara/partidos');
    expect(res.status).toBe(200);
    expect(res.body.dados).toBeDefined();
  }, 15000);
});

describe('Senado Federal', () => {
  test('GET /api/senado/senadores retorna lista', async () => {
    const res = await request(app).get('/api/senado/senadores');
    expect(res.status).toBe(200);
    expect(res.body.dados).toBeDefined();
    expect(Array.isArray(res.body.dados)).toBe(true);
  }, 15000);
});

describe('Noticias', () => {
  test('GET /api/noticias/fontes retorna lista de fontes', async () => {
    const res = await request(app).get('/api/noticias/fontes');
    expect(res.status).toBe(200);
    expect(res.body.dados).toBeDefined();
    expect(Array.isArray(res.body.dados)).toBe(true);
    expect(res.body.dados.length).toBeGreaterThan(0);
    expect(res.body.dados[0]).toHaveProperty('id');
    expect(res.body.dados[0]).toHaveProperty('nome');
    expect(res.body.dados[0]).toHaveProperty('categoria');
  });
});

describe('Situacao Judicial', () => {
  test('GET /api/judicial retorna mapa de deputados e senadores', async () => {
    const res = await request(app).get('/api/judicial');
    expect(res.status).toBe(200);
    expect(res.body.deputados).toBeDefined();
    expect(res.body.senadores).toBeDefined();
    expect(typeof res.body.deputados).toBe('object');
    expect(typeof res.body.senadores).toBe('object');
  });

  test('GET /api/judicial/deputado/:id retorna 404 para ID inexistente', async () => {
    const res = await request(app).get('/api/judicial/deputado/999999');
    expect(res.status).toBe(404);
  });
});

describe('Swagger docs', () => {
  test('GET /api-docs responde com HTML', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
