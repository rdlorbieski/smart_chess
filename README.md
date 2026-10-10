# ChessMind — análise de xadrez com Stockfish

Aplicação web de xadrez focada em explicar **quão difícil e quão crítico foi cada lance** para um jogador humano, e não apenas mostrar a avaliação do motor.

Para cada lance, o app calcula três métricas independentes:

| Métrica | Pergunta que responde |
|---|---|
| **Move Quality** | Quão bom foi o lance? |
| **Difficulty** | Quão difícil era encontrar o melhor lance? |
| **Criticality** | Quão importante era acertar essa decisão? |

Além disso: delta de avaliação, profundidade de cálculo estimada, detecção de *only move*, top 5 linhas, modo Coach, relógio opcional, importação/exportação de PGN/FEN e biblioteca de partidas em SQLite.

> Difficulty e Criticality são **estimativas heurísticas** derivadas da saída do motor, não probabilidades estatísticas.

## Requisitos

- [Node.js](https://nodejs.org) **24 ou superior** (o servidor usa o módulo `node:sqlite`, embutido no Node)
- [pnpm](https://pnpm.io) 10+

## Instalação

```bash
pnpm install
```

## Como rodar

### Modo básico (só o navegador)

```bash
pnpm dev
```

Abra o endereço mostrado no terminal (por padrão `http://localhost:8443`; mude com a variável `PORT`).

Neste modo o Stockfish roda em um Web Worker (asm.js), sem bloquear a interface. Funciona sem nenhum backend, mas é mais lento. Salvar partidas na biblioteca **não** fica disponível.

### Modo completo (servidor + banco de dados)

Em **dois terminais**:

```bash
# Terminal 1 — API: Stockfish no servidor + SQLite
pnpm server

# Terminal 2 — interface
pnpm dev
```

Ou, com um único comando (sobe os dois e o Ctrl+C encerra ambos):

```bash
pnpm dev:all
```

O Vite encaminha `/api` para o servidor automaticamente. No painel **Engine**, o seletor **Backend** passa a permitir **Server**.

Se o servidor cair durante o uso, o app volta sozinho para o motor do navegador.

## Usando o Stockfish nativo (recomendado)

Sem configuração extra, o servidor usa o Stockfish WASM do pacote npm rodando no Node. Para usar um binário nativo, muito mais rápido:

**Forma mais simples:** baixe o Stockfish em <https://stockfishchess.org/download/> e extraia na raiz do projeto. O servidor detecta o binário sozinho conforme o sistema:

| Sistema | Pasta | Exemplo |
|---|---|---|
| Windows | `stockfish/` | `stockfish-windows-x86-64-universal.exe` |
| Linux / macOS | `stockfish-linux/` | `stockfish-linux-x86-64-universal` (recebe permissão de execução automaticamente) |

**Ou** defina `STOCKFISH_PATH` apontando para o binário, em qualquer lugar:

**PowerShell**
```powershell
$env:STOCKFISH_PATH = "C:\caminho\para\stockfish.exe"
pnpm server
```

**Bash**
```bash
STOCKFISH_PATH=/caminho/para/stockfish pnpm server
```

A ordem de escolha é: `STOCKFISH_PATH` → binário em `stockfish/` (Windows) ou `stockfish-linux/` (Linux) → WASM do npm. Ao iniciar, o servidor imprime `engine=native` (binário nativo) ou `engine=node-wasm` (fallback).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `8443` | Porta da interface (Vite) |
| `SERVER_PORT` | `3001` | Porta da API |
| `STOCKFISH_PATH` | — | Caminho do binário nativo do Stockfish |
| `CHESS_DB` | `data/games.db` | Caminho do arquivo SQLite |
| `LICHESS_TOKEN` | — | Token pessoal do Lichess (alternativa a colá-lo no Explorer) |
| `SERVER_HOST` | `127.0.0.1` | Endereço em que a API escuta (o Docker usa `0.0.0.0`) |
| `ENGINE_POOL` | núcleos − 2 (máx. 6) | Quantos processos do Stockfish o servidor mantém abertos para analisar em paralelo |
| `AUTH_USER` | `admin` | Usuário do login |
| `AUTH_PASSWORD` | — | Senha do login. Vazio = sem login (uso local) |
| `RECOVERY_EMAIL` | — | E-mail que recebe o código de acesso do "Esqueci a senha" |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `465` | Servidor de envio do e-mail |
| `SMTP_USER` / `SMTP_PASS` | — | Conta que envia e a senha de app dela (Gmail: myaccount.google.com/apppasswords) |

Se mudar `SERVER_PORT`, use o mesmo valor ao subir o `pnpm dev`.

## Deploy (Docker)

Mesmo esquema do `fitame-validator-user`: o `docker-compose.yml` sobe dois containers a partir do mesmo `Dockerfile`:

- `lorbieski-chess-web` (`--target web`): nginx com o build do Vite, encaminhando `/api` para a API. Fica na rede externa `edge` da VPS, onde o Caddy (`infra-edge`) aponta `chess.lorbieski.com.br` para ele (`reverse_proxy lorbieski-chess-web:80`).
- `smart-chess-api` (`--target api`): Node 24 + Stockfish nativo (baixado do release oficial no build) + SQLite. Não publica porta; o banco e o token do Lichess ficam no volume `smart-chess-data` (`/app/data`), que sobrevive aos rebuilds.

```bash
# Testar localmente antes (abre em http://localhost:8082/)
docker compose --profile local up -d --build

# Na VPS: git pull + build + up do perfil prod
./deploy.sh
```

### Login

Com `AUTH_PASSWORD` definido, o site pede usuário e senha (`AUTH_USER` / `AUTH_PASSWORD`) e toda a API, exceto `/api/health` e `/api/auth/*`, responde 401 sem sessão. A sessão é um cookie assinado que dura 30 dias (a chave fica em `data/session-secret`, no volume); trocar a senha derruba as sessões abertas. Depois de 10 tentativas erradas, o IP espera 15 minutos.

**Esqueci a senha:** com `RECOVERY_EMAIL` e `SMTP_USER`/`SMTP_PASS` preenchidos, a tela de login mostra um link que envia um código de 6 dígitos (vale 10 minutos, uso único) para o e-mail; o código entra direto no app. A senha em si continua sendo a do `.env`.

Sem `AUTH_PASSWORD` (como no `pnpm dev`), não há login.

Configuração opcional: `.env` ao lado do `docker-compose.yml` (modelo em `.env.example`) com `ENGINE_POOL` (processos do Stockfish) e `LICHESS_TOKEN`. O `.env` não vai para o git, então crie-o também na VPS (`cp .env.example .env`).

## Funcionalidades

- **Análise:** barra de avaliação, histórico colorido por qualidade, sublinhado laranja em lances críticos, painel com Difficulty/Criticality/Calculation, explicação do "porquê é difícil", gráfico e lista das 5 principais linhas (clique para visualizar no tabuleiro).
- **Lance da vez (sem spoiler):** um card no topo do painel mostra, para quem ainda não jogou na posição exibida (ex.: o Magnus), a criticidade, a dificuldade, se é *only move*, quantas opções boas existem e a profundidade estimada — sem revelar o melhor lance. Abaixo do histórico, a linha do tempo **Critical moments** traz uma barra por posição da partida; clique para ir até ela.
- **Armadilhas ocultas:** além das 5 melhores linhas, o app varre **todos os lances legais** e compara um "olhar rápido" (profundidade 4) com o cálculo mais fundo (≈ profundidade 11). Lances que parecem bons à primeira vista mas perdem com cálculo são **armadilhas**, e elevam a criticidade e a dificuldade. Exemplo: em Carlsen–Keymer, antes de `16.a3`, só as 5 melhores linhas pareciam equivalentes (criticidade ~0%), mas 8 dos 22 lances naturais — incluindo `a3`, que perde ~1,3 peão — eram armadilhas (criticidade 66%, *Important*). O card mostra **⚠ N hidden traps**; clique para ver quais (bloqueado no modo Coach). Com o botão **Traps** ligado (independente de **Arrows**), as armadilhas também aparecem no tabuleiro como setas vermelhas — quanto mais escura, mais o lance perde (vermelho-claro ≥ 10 pontos, vermelho ≥ 14, vermelho-escuro ≥ 20). A varredura leva ~1 s com Stockfish nativo; no motor do navegador é bem mais lenta e pode não chegar fundo o bastante, então prefira o modo servidor.
- **Setas do motor:** as melhores candidatas para quem joga aparecem como setas sobre o tabuleiro, em tons que vão do verde forte e grosso (melhor lance) até tons mais claros e finos (menos bons). Só entram lances a até 20 pontos de probabilidade de vitória do melhor. O botão **Arrows** liga/desliga; no modo Coach ficam ocultas até revelar o melhor lance.
- **Peças capturadas:** ao lado do nome de cada jogador aparecem as peças que ele capturou e a vantagem de material (`+3`).
- **Explorer** (aba ao lado de Analysis): mostra a abertura da posição, as continuações do livro de aberturas (clique para jogar o lance) e, com o servidor ligado, o que aconteceu nas **suas partidas salvas** a partir dali: lances jogados com o placar de brancas/empates/pretas e as partidas que chegaram à posição (clique para abrir). Partidas salvas antes desse recurso são indexadas automaticamente quando o servidor inicia.
- **Abertura:** o nome e o código ECO aparecem acima do histórico (ex.: `C54 · Italian Game: …`). Funciona por posição, então reconhece transposições. Também vai para os cabeçalhos `ECO`/`Opening` do PGN exportado. Base: [lichess chess-openings](https://github.com/lichess-org/chess-openings) (CC0); para atualizar, rode `node scripts/build-openings.mjs`.
- **Only move:** o limite (em pontos de probabilidade de vitória) é ajustável no painel.
- **Engine:** limite de tempo (0,5–15 s) e de profundidade (8–30) por posição, botão **Stop analysis** / **Resume**.
- **Modo Coach:** esconde o melhor lance; após jogar, mostra quanto você perdeu e oferece **Try again** ou **Show best move**.
- **Relógio:** presets 1+0, 3+2, 5+0, 10+0 e 15+10 com incremento. Inicie com **Start**. Ao acabar o tempo, o resultado vai para o PGN (o app não trava a jogada).
- **Variantes:** jogar um lance diferente no meio da partida cria uma **variante** — a partida original nunca é apagada. O histórico mostra as variantes recuadas logo abaixo do lance que substituem (aninhadas entre parênteses). Dentro de uma variante aparecem **↩ Main line** (volta ao ponto onde ela saiu da linha principal), **⬆ Promote** (vira a linha principal) e **🗑 Delete**.
- **PGN/FEN:** carregue por **Load PGN** — variantes, comentários `{…}` e anotações (`!`, `?`, `$n`) são preservados; exporte com **Export PGN** (arquivo) ou **Copy**, também com todas as variantes.
- **Partidas de mestres (Explorer → Masters · Lichess):** lances jogados por mestres (base Lichess Masters, ~2 milhões de partidas 2200+), com número de partidas, Elo médio e placar; as principais partidas abrem direto na posição. Precisa de um **token gratuito** do Lichess: crie em [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token) (nenhuma permissão marcada) e cole no próprio Explorer — ele fica só no servidor, em `data/lichess-token.txt` (ou use a variável `LICHESS_TOKEN`). Apenas a posição (FEN) é enviada ao Lichess.
- **Base de mestres local (offline):** em **Library → Import PGN…** importe arquivos PGN gratuitos, como o [TWIC](https://theweekinchess.com) (partidas de elite toda semana) ou a Lichess Elite Database. As partidas ficam no SQLite, separadas das suas, sem duplicatas, e alimentam a seção **Imported database** do Explorer.
- **Análise infinita:** botão **∞ Infinite** no painel Engine — o motor continua pensando na posição do tabuleiro, aprofundando (dobra o tempo a cada etapa) e atualizando barra, setas e métricas; a profundidade atual aparece no painel.
- **Relatório da partida (aba 📈 Relatório):** gráfico da avaliação (clique para ir ao lance), **precisão** de cada jogador (fórmula pública do Lichess — uma estimativa, não o número do chess.com), contagem de brilhantes/bons/imprecisões/erros/erros graves e os **momentos decisivos**. Com o servidor, a partida inteira é analisada **em paralelo** (vários processos do Stockfish ao mesmo tempo) em duas passadas — primeiro as avaliações (o relatório fica pronto em segundos), depois as armadilhas. O lance que você está olhando sempre recebe a análise completa. No motor do navegador tudo roda um lance por vez, então é bem mais lento.
- **Promoção:** ao chegar à última fileira, escolha dama, torre, bispo ou cavalo.
- **Jogar contra o Stockfish:** botão **🤖 Play** — escolha a cor e a força (800–3000 Elo). O motor de jogo é separado do de análise; ele só joga quando o tabuleiro mostra o fim da partida, então você pode voltar lances para estudar. Dica: modo **Training** para receber o Coach a cada lance.
- **Sons** de lance, captura, xeque, roque e mate (botão 🔊 / 🔇).
- **Biblioteca (precisa do servidor):**
  - **Save** guarda jogadores, torneio, site, data, resultado, notas, nota de 0–5 estrelas, a abertura (ECO + nome) e o PGN (ou a FEN, se ainda não houver lances).
  - **Library** permite buscar por jogador, torneio, abertura (nome ou código ECO) ou notas, abrir e apagar partidas.

## API do servidor

O servidor escuta apenas em `127.0.0.1` (no Docker, `SERVER_HOST=0.0.0.0`, mas a porta não é publicada — só o nginx a alcança).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Estado do servidor e tipo do motor |
| POST | `/api/analyze` | `{ fen, multiPV, depth, movetimeMs }` → linhas UCI brutas |
| GET | `/api/explorer?fen=` | Lances e partidas salvas que passaram pela posição |
| GET | `/api/games?q=` | Lista/busca partidas salvas |
| POST | `/api/games` | Salva uma partida |
| GET | `/api/games/:id` | Detalhe (inclui PGN/FEN) |
| DELETE | `/api/games/:id` | Remove uma partida |
| POST | `/api/analyze-batch` | `{ items: [...] }` → várias posições analisadas em paralelo (até 64) |
| GET | `/api/masters?fen=` | Lances de mestres (proxy do Lichess, usa o token do servidor) |
| GET | `/api/masters/pgn/:id` | PGN de uma partida de mestres |
| GET / POST / DELETE | `/api/lichess-token` | Status, gravação e remoção do token do Lichess |
| POST | `/api/import` | Importa um arquivo PGN (várias partidas) para a base local |
| GET / DELETE | `/api/database` | Contagem por origem / apaga as partidas importadas |

## Estrutura

```
server/            API Node: motor + SQLite
  auth.mjs         login, sessão e código de recuperação por e-mail
  index.mjs        rotas HTTP
  engine.mjs       processo do Stockfish (nativo ou WASM no Node)
  db.mjs           esquema e consultas SQLite
src/engine/
  ChessEngine.ts   camada do motor (Worker ou servidor, fila, cache, cancelamento)
  metrics.ts       fórmulas de Quality / Difficulty / Criticality / Calculation (ajustáveis)
src/store/         estado do jogo, loop de análise e relógio
src/components/    tabuleiro, barra de avaliação, painel, biblioteca…
src/lib/pgn.ts     geração/exportação de PGN
data/              banco SQLite (criado automaticamente, ignorado pelo git)
```

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento da interface |
| `pnpm server` | API (Stockfish no servidor + SQLite) |
| `pnpm build` | Build de produção |
| `pnpm preview` | Serve o build de produção |
| `pnpm format` | Formata o código (oxfmt) |

## Problemas comuns

- **`http proxy error ... ECONNREFUSED 127.0.0.1:3001` no terminal do Vite:** o servidor da API não está rodando. Suba o `pnpm server` (ou use `pnpm dev:all`). O erro é inofensivo — o app continua no modo navegador.
- **Botão "Server" desabilitado:** o `pnpm server` não está rodando, ou a `SERVER_PORT` do servidor e do Vite não coincidem.
- **"Save" diz que o servidor está offline:** mesmo motivo acima.
- **`Cannot find module 'node:sqlite'`:** atualize o Node para a versão 24 ou superior.
- **Análise lenta:** use o modo servidor com `STOCKFISH_PATH`, ou reduza o tempo/profundidade no painel Engine.

## Ajustando as métricas

Todas as fórmulas ficam isoladas em [`src/engine/metrics.ts`](src/engine/metrics.ts) (pesos e limiares no topo), separadas da interface e do motor, para calibrar depois com dados reais de partidas humanas (rating, tempo gasto, taxa de acerto).

