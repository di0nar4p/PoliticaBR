# PoliticaBR

Aplicacao web para consulta de dados abertos do governo brasileiro. Agrega informacoes de deputados, senadores, dados eleitorais do TSE e noticias politicas de 17 fontes, tudo em uma interface unica com busca em tempo real.

**Autor:** di0nar4p

## Como funciona

O sistema possui dois componentes:

- **Backend (Node.js/Express):** Atua como proxy para as APIs publicas do governo, evitando problemas de CORS no navegador. Quando uma API falha (rate limit, timeout, indisponibilidade), o servidor faz fallback automatico para dados JSON/XML armazenados localmente na pasta `data/`.

- **Frontend (HTML/CSS/JS):** Interface responsiva com 5 abas de consulta. A busca funciona em tempo real enquanto o usuario digita (debounce de 300ms), com normalizacao de acentos para busca parcial por qualquer parte do nome.

## Instalacao

```bash
# Instalar dependencias
npm install

# Iniciar o servidor
npm start

# Ou em modo desenvolvimento (reinicia automaticamente ao editar arquivos)
npm run dev
```

Acesse em **http://localhost:3000**

## Funcionalidades

### Busca Geral
Pesquisa unificada por qualquer parte do nome em deputados e senadores simultaneamente. Ignora acentos e maiusculas. Ex: digitar "bolsonaro" encontra "Flavio Bolsonaro" (Senador), digitar "silva" encontra todos os parlamentares com Silva no nome.

### Deputados
Lista os 513 deputados federais em exercicio com filtros por nome, partido e estado. Ao clicar em um deputado, abre um modal com informacoes pessoais (nome civil, escolaridade, naturalidade), dados de gabinete e despesas parlamentares (cota CEAP).

### Senadores
Lista os senadores em exercicio com os mesmos filtros. O modal de detalhes mostra informacoes pessoais, historico de mandatos e link para a pagina oficial no Senado.

### TSE - Eleicoes
Consulta datasets do Tribunal Superior Eleitoral para download. Disponibiliza dados de candidatos e prestacao de contas eleitorais dos anos 2014, 2016, 2018, 2020, 2022 e 2024.

### Noticias
Agregador de noticias politicas de 17 fontes RSS, com filtro por categoria (governo/portais), fonte individual e busca por palavra-chave.

## APIs Integradas

### Dados Abertos (sem autenticacao)

| API | Descricao |
|-----|-----------|
| [Camara dos Deputados](https://dadosabertos.camara.leg.br/api/v2) | Deputados, despesas, votacoes, proposicoes, partidos |
| [Senado Federal](https://legis.senado.leg.br/dadosabertos) | Senadores, votacoes, autorias, mandatos |
| [TSE Dados Abertos](https://dadosabertos.tse.jus.br) | Candidatos, prestacao de contas (datasets CKAN) |

### Fontes de Noticias (RSS)

**Governo / Institucional:**
- Camara dos Deputados (geral + politica)
- Senado Federal
- Agencia Brasil (EBC)
- Portal gov.br
- TSE
- Ministerio Publico Federal

**Portais de Noticias:**
- G1 Politica
- Folha de S.Paulo - Poder
- Estadao - Politica
- Poder360
- CartaCapital - Politica
- BBC Brasil
- Gazeta do Povo (Republica, Congresso, STF)
- R7 Noticias

## Sistema de Fallback

Todas as rotas implementam um mecanismo de fallback:

1. **Tenta a API remota** com timeout de 8-10 segundos
2. **Se falhar**, carrega os dados do arquivo local correspondente na pasta `data/`
3. **Aplica os mesmos filtros** (nome, partido, UF) nos dados locais
4. **Loga no console** qual fonte esta sendo usada (API ou local)

Os dados locais sao baixados na instalacao e ficam em `data/`. Isso garante que o sistema funciona 100% offline.

## Estrutura do Projeto

```
projeto00/
├── server.js                  # Servidor Express principal
├── package.json               # Dependencias e scripts
├── README.md                  # Este arquivo
├── routes/
│   ├── camara.js              # API Camara dos Deputados
│   ├── senado.js              # API Senado Federal
│   ├── tse.js                 # API TSE (dados eleitorais)
│   ├── noticias.js            # Agregador de 17 fontes RSS
│   └── busca.js               # Busca unificada por nome parcial
├── public/
│   ├── index.html             # Pagina principal
│   ├── css/
│   │   └── style.css          # Estilos globais
│   └── js/
│       └── app.js             # Logica do frontend
└── data/
    ├── deputados.json         # 513 deputados (fallback)
    ├── senadores.json         # Senadores em exercicio (fallback)
    ├── partidos.json          # Lista de partidos (fallback)
    ├── votacoes.json          # Votacoes recentes (fallback)
    ├── tse_candidatos_*.json  # Datasets TSE por ano (fallback)
    ├── tse_prestacao_*.json   # Prestacao de contas por ano (fallback)
    └── noticias_*.xml         # Cache RSS de cada fonte (fallback)
```

## Endpoints da API

### Camara dos Deputados
- `GET /api/camara/deputados?nome=&siglaPartido=&siglaUf=&pagina=&itens=`
- `GET /api/camara/deputados/:id`
- `GET /api/camara/deputados/:id/despesas?ano=`
- `GET /api/camara/proposicoes?siglaTipo=&ano=`
- `GET /api/camara/votacoes?pagina=&itens=`
- `GET /api/camara/partidos`

### Senado Federal
- `GET /api/senado/senadores?nome=&siglaPartido=&siglaUf=`
- `GET /api/senado/senadores/:codigo`
- `GET /api/senado/senadores/:codigo/votacoes?ano=`
- `GET /api/senado/senadores/:codigo/autorias`

### TSE
- `GET /api/tse/datasets`
- `GET /api/tse/dataset/:id`
- `GET /api/tse/candidatos/:ano`
- `GET /api/tse/prestacao-contas/:ano`

### Noticias
- `GET /api/noticias?busca=&fonte=&categoria=`
- `GET /api/noticias/fontes`

### Busca Unificada
- `GET /api/busca?termo=` (minimo 2 caracteres)

## Tecnologias

- **Node.js** + **Express** - Backend/servidor
- **Axios** - Requisicoes HTTP para APIs externas
- **xml2js** - Parse de feeds RSS/XML
- **HTML5** + **CSS3** + **JavaScript** (vanilla) - Frontend
