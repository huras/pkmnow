/**
 * Wiki-style in-game help (controls, UI, audio). Toggle from minimap header.
 * @typedef {{ id: string, title: string, html: string }} PlayHelpArticle
 */

/** @type {PlayHelpArticle[]} */
const ARTICLES = [
  {
    id: 'start',
    title: 'Começar',
    html: `
      <h2 class="play-help-wiki__h2">Começar</h2>
      <p class="play-help-wiki__p">Defina a <strong>seed</strong>, clique em <strong>Gerar</strong> e, quando o mapa estiver pronto, <strong>clique na região</strong> para entrar no modo jogo. O canvas recebe foco para teclas (WASD etc.); se algo não responder, clique de novo no mapa.</p>
      <p class="play-help-wiki__p">No modo mapa, a faixa superior mostra dicas de hover sobre o terreno. No modo jogo ela vira HUD de bioma, HP e telemetria (desligada no UI minimalista).</p>
    `
  },
  {
    id: 'move',
    title: 'Movimento',
    html: `
      <h2 class="play-help-wiki__h2">Movimento</h2>
      <p class="play-help-wiki__note">Teclado e controle podem ser usados ao mesmo tempo. O artigo <strong>Gamepad</strong> lista todos os botões do controle no modo jogo.</p>
      <ul class="play-help-wiki__ul">
        <li><strong>WASD</strong> ou <strong>setas</strong> — andar em 8 direções (diagonal normalizada).</li>
        <li><strong>Duplo toque</strong> na mesma direção cardinal (dentro de ~320 ms), estilo <em>Kirby</em> — ativa <strong>corrida</strong> até você parar de se mover (só teclado).</li>
        <li><strong>Espaço</strong> — <strong>pulo</strong> no teclado. Você tem <strong>pulo duplo</strong> (2 no ar) por padrão; Pokémon <strong>Voador</strong> ganha até <strong>6 pulos</strong> consecutivos.</li>
        <li><strong>F</strong> — alterna <strong>voo criativo</strong> (Pokémon com tipo Voador). Com voo ativo: <kbd>Space</kbd> sobe e <kbd>Shift</kbd> desce em altitude; o HUD indica se o voo está ligado.</li>
        <li><strong>Esc</strong> — sai do modo jogo (volta ao mapa global). Se este menu de ajuda estiver aberto, <kbd>Esc</kbd> fecha só a ajuda.</li>
      </ul>
    `
  },
  {
    id: 'gamepad',
    title: 'Gamepad',
    html: `
      <h2 class="play-help-wiki__h2">Controle (modo jogo)</h2>
      <p class="play-help-wiki__p">O jogo usa a <strong>Gamepad API</strong> do navegador (nomes <em>Xbox</em> nos índices). Na coluna PS, o botão físico costuma ser o indicado — pode variar um pouco entre navegador e driver.</p>

      <h3 class="play-help-wiki__h3">Movimento e corpo</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>PS (típico)</th><th>API / Xbox</th><th>Efeito</th></tr></thead>
        <tbody>
          <tr><td>Analógico esquerdo</td><td>Eixos 0–1</td><td>Andar (mescla com WASD/setas).</td></tr>
          <tr><td>Segurar <strong>✕</strong> (Cross)</td><td>Botão <strong>A</strong> (0)</td><td><strong>Corrida</strong> enquanto você se move (equivalente ao sprint por duplo toque no teclado).</td></tr>
          <tr><td><strong>△</strong> (Triangle)</td><td>Botão <strong>Y</strong> (3)</td><td><strong>Pulo</strong> (toque). Não pula se a roda simples de bind estiver aberta.</td></tr>
          <tr><td><strong>L3</strong> (clique no analógico esquerdo)</td><td>Botão 10</td><td>Liga / desliga <strong>voo criativo</strong> (só espécies com tipo Voador). Com voo: segure <strong>✕</strong> para subir e <strong>LB</strong> para descer (espelha Espaço / Shift).</td></tr>
          <tr><td><strong>LB</strong></td><td>Botão 4</td><td>Espelha <kbd>Shift</kbd> — cavar / descer no voo criativo.</td></tr>
        </tbody>
      </table>

      <h3 class="play-help-wiki__h3">Combate (o que já está no controle)</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>PS</th><th>API</th><th>Slot / efeito</th></tr></thead>
        <tbody>
          <tr><td>Segurar <strong>□</strong> (Square)</td><td>Botão <strong>X</strong> (2)</td><td>Mesmo que <strong>LMB</strong> — golpe do slot 1 (segure para carregar / stream, solte para soltar).</td></tr>
          <tr><td>Toque <strong>○</strong> (Circle)</td><td>Botão <strong>B</strong> (1)</td><td>Mesmo que <kbd>E</kbd> — <strong>força / grab</strong> (pegar pedra, cristal, etc.). Com a <strong>roda simples</strong> de bind aberta (teclas 1–5), <strong>○</strong> <strong>confirma</strong> a escolha.</td></tr>
          <tr><td>Toque <strong>□</strong> com roda simples aberta</td><td>—</td><td><strong>Fecha</strong> a roda sem gravar (cancelar).</td></tr>
        </tbody>
      </table>
      <p class="play-help-wiki__p"><strong>RMB, MMB e gatilhos</strong> para atacar no campo ainda são principalmente <strong>mouse</strong> no PC; o foco do controle hoje é movimento + slot 1 + interação.</p>

      <h3 class="play-help-wiki__h3">Trocar golpes nos slots (controle)</h3>
      <p class="play-help-wiki__p">Abre a <strong>roda dupla</strong> (tipo à esquerda, golpe à direita): o mundo fica em câmera lenta exceto a UI. <strong>Analógico esquerdo</strong> escolhe o <em>tipo</em>; <strong>direito</strong> escolhe o <em>golpe</em> daquele tipo. <strong>○</strong> confirma; <strong>□</strong> ou <strong>△</strong> cancelam. <strong>Start</strong> ou <strong>Back</strong> também fecham essa roda sem sair do jogo.</p>
      <table class="play-help-wiki__table">
        <thead><tr><th>Entrada</th><th>Slot no teclado</th><th>Atalho no painel</th></tr></thead>
        <tbody>
          <tr><td><strong>D-pad ↑</strong></td><td>Slot 1 (= LMB / □ no combate)</td><td>□</td></tr>
          <tr><td><strong>D-pad →</strong></td><td>Slot 2 (= RMB)</td><td>R2</td></tr>
          <tr><td><strong>D-pad ←</strong></td><td>Slot 3 (= MMB)</td><td>L2</td></tr>
          <tr><td><strong>D-pad ↓</strong></td><td>Slot 4 (= roda do mouse ↑)</td><td>L1 + □</td></tr>
          <tr><td><strong>R3</strong> (clique analógico direito)</td><td>Slot 5 (= roda ↓)</td><td>L1 + △</td></tr>
        </tbody>
      </table>
      <p class="play-help-wiki__p">No teclado, <kbd>1</kbd>–<kbd>5</kbd> ainda abrem a <strong>roda simples</strong> (uma só) para rebind com o mouse — é outro fluxo, pensado para PC.</p>

      <h3 class="play-help-wiki__h3">Sistema e menu</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Entrada</th><th>Efeito</th></tr></thead>
        <tbody>
          <tr><td><strong>Start</strong> ou <strong>Back</strong> (Select)</td><td>Sai do modo jogo (volta ao mapa). Se a <strong>roda dupla</strong> estiver aberta, só fecha a roda.</td></tr>
        </tbody>
      </table>
    `
  },
  {
    id: 'combat',
    title: 'Combate e golpes',
    html: `
      <h2 class="play-help-wiki__h2">Combate e golpes</h2>
      <ul class="play-help-wiki__ul">
        <li><strong>LMB</strong> (clique esquerdo) ou, no controle, <strong>segurar Square (□)</strong> — golpe de campo do <strong>slot 1</strong> (Tackle, Cut, etc.).</li>
        <li><strong>Segure LMB</strong> (ou □) para <strong>carregar</strong> quando o move suporta (estilo Zelda): solte para liberar. Moves em <em>stream</em> continuam enquanto o botão ficar pressionado.</li>
        <li><strong><kbd>1</kbd> … <kbd>5</kbd></strong> — ao pressionar, abre a <strong>roda simples</strong> de binding daquele slot (1 = LMB, 2 = RMB, 3 = MMB, 4 = roda ↑, 5 = roda ↓). Escolha tipo → golpe com o <strong>mouse</strong> e confirme clicando no golpe ou use o fluxo do teclado/mouse descrito na roda.</li>
        <li><strong>Controle</strong> — use o <strong>D-pad / R3</strong> para abrir a <strong>roda dupla</strong> de bind (ver artigo <strong>Gamepad</strong>).</li>
        <li><strong>Cut</strong> — combo de até 3 cortes encadeados no alvo.</li>
        <li><strong>E</strong> ou <strong>○</strong> (Circle) no controle — <strong>força / grab</strong>: pega e solta pedras, cristais e objetos. Com carga nas mãos, <strong>soltar LMB</strong> (ou soltar □) arremessa na direção do cursor.</li>
        <li><strong>RMB</strong> — slot 2; em geral golpe à distância. Segure para charge ou stream conforme o move.</li>
        <li><strong>MMB</strong> — slot 3, em geral Ultimate.</li>
        <li><strong>Roda do mouse ↑ / ↓</strong> — slots 4 e 5 (moves extras do moveset).</li>
        <li><strong>Ctrl esquerdo</strong> — modificador: enquanto segurado, LMB/RMB/MMB <strong>não disparam</strong> (útil para parar stream sem soltar o botão).</li>
      </ul>
      <p class="play-help-wiki__p"><em>Obs.:</em> o HUD de carga mostra o comportamento do slot ativo. Detalhes de controle: artigo <strong>Gamepad</strong>.</p>
    `
  },
  {
    id: 'keyboard',
    title: 'Atalhos (cheatsheet)',
    html: `
      <h2 class="play-help-wiki__h2">Atalhos — referência rápida</h2>
      <p class="play-help-wiki__p">Atalhos do modo jogo. Não disparam enquanto o foco está num campo de texto (seed, busca, etc.). <strong>Controle:</strong> veja o artigo <strong>Gamepad</strong> (tabelas completas).</p>

      <h3 class="play-help-wiki__h3">Movimento</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Tecla</th><th>Efeito</th></tr></thead>
        <tbody>
          <tr><td><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> ou setas</td><td>Andar em 8 direções (diagonal normalizada).</td></tr>
          <tr><td>Duplo toque numa cardinal</td><td>Corrida (sprint). Janela ~320 ms.</td></tr>
          <tr><td><kbd>Space</kbd></td><td>Pulo (teclado). Duplo no chão; até 6 pulos em Pokémon Voador.</td></tr>
          <tr><td><kbd>Shift</kbd> (L/R)</td><td>Desce altitude em voo criativo.</td></tr>
          <tr><td><kbd>F</kbd></td><td>Liga / desliga voo criativo (só espécies Voadoras).</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Sai do modo jogo, ou fecha modal (ajuda, etc.). Com a roda dupla de bind do controle aberta, <strong>Start/Back</strong> no gamepad fecha só a roda.</td></tr>
        </tbody>
      </table>

      <h3 class="play-help-wiki__h3">Combate e moves</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Entrada</th><th>Slot</th><th>Efeito</th></tr></thead>
        <tbody>
          <tr><td>LMB ou Square (□) no controle</td><td>Slot 1</td><td>Tap dispara; segurar carrega ou mantém stream; soltar libera.</td></tr>
          <tr><td>RMB (clique direito)</td><td>Slot 2</td><td>Golpe secundário (geralmente ranged). Segurar = charge ou stream.</td></tr>
          <tr><td>MMB (botão do meio)</td><td>Slot 3</td><td>Ultimate.</td></tr>
          <tr><td>Wheel ↑ / Wheel ↓</td><td>Slots 4 / 5</td><td>Dispara os moves ligados ao scroll.</td></tr>
          <tr><td><kbd>1</kbd> … <kbd>5</kbd></td><td>Rebind</td><td>Abre a <strong>roda simples</strong> daquele slot; escolha com o mouse na roda e confirme no golpe (fase “move”).</td></tr>
          <tr><td><kbd>E</kbd> ou Circle (○)</td><td>Força / grab</td><td>Pega ou solta objetos; com carga, soltar LMB arremessa.</td></tr>
          <tr><td><kbd>Ctrl</kbd> (esquerdo)</td><td>Modificador</td><td>Enquanto segurado, suprime cast do LMB/RMB/MMB.</td></tr>
        </tbody>
      </table>

      <h3 class="play-help-wiki__h3">Social (teclado numérico)</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Tecla</th><th>Ação</th></tr></thead>
        <tbody>
          <tr><td><kbd>Num1</kbd></td><td>Greet 👋</td></tr>
          <tr><td><kbd>Num2</kbd></td><td>Smile 🙂</td></tr>
          <tr><td><kbd>Num3</kbd></td><td>Offer Food 🍎</td></tr>
          <tr><td><kbd>Num4</kbd></td><td>Curious Look 🤔</td></tr>
          <tr><td><kbd>Num5</kbd></td><td>Playful Jump 😄</td></tr>
          <tr><td><kbd>Num6</kbd></td><td>Bow 🙇</td></tr>
          <tr><td><kbd>Num7</kbd></td><td>Challenge 😤 (vira soco social se colado no alvo)</td></tr>
          <tr><td><kbd>Num8</kbd></td><td>Warn ⚠️</td></tr>
          <tr><td><kbd>Num9</kbd></td><td>Threaten 💢</td></tr>
        </tbody>
      </table>
      <p class="play-help-wiki__p">Detalhes de memória social, ripple e intenções: veja o artigo <strong>Social (numpad)</strong> ou <code>docs/SOCIAL-NUMPAD.md</code>.</p>

      <h3 class="play-help-wiki__h3">Debug — overlays globais</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Tecla</th><th>Toggle</th></tr></thead>
        <tbody>
          <tr><td><kbd>C</kbd></td><td>Overlay de <strong>colisores</strong> do modo jogo (player, pedras, cristais, scatter pass). Sincroniza com o checkbox <code>#chkPlayColliders</code>.</td></tr>
          <tr><td><kbd>V</kbd></td><td>Overlay de <strong>reações do mundo</strong> (heat / wet / shock / danger). Sincroniza com <code>#chkWorldReactionsOverlay</code>.</td></tr>
        </tbody>
      </table>
      <p class="play-help-wiki__p">Funcionam tanto no mapa quanto no modo jogo — contanto que o foco não esteja num input.</p>

      <h3 class="play-help-wiki__h3">Formulários e modais</h3>
      <table class="play-help-wiki__table">
        <thead><tr><th>Contexto</th><th>Tecla</th><th>Efeito</th></tr></thead>
        <tbody>
          <tr><td>Campo de seed</td><td><kbd>Enter</kbd></td><td>Dispara a geração (mesmo que o botão <em>Gerar</em>).</td></tr>
          <tr><td>Busca do painel de Pokémon</td><td><kbd>Esc</kbd></td><td>Fecha a lista de resultados.</td></tr>
          <tr><td>Clique na linha de um Pokémon</td><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + clique</td><td>Em modo jogo, invoca um selvagem dessa espécie perto de você (debug).</td></tr>
          <tr><td>Esta ajuda / menu de contexto</td><td><kbd>Esc</kbd></td><td>Fecha o modal / menu.</td></tr>
        </tbody>
      </table>

      <p class="play-help-wiki__p">Referência completa com arquivos-fonte e linhas: <code>docs/KEYBOARD-SHORTCUTS.md</code>.</p>
    `
  },
  {
    id: 'panel',
    title: 'Painel do Pokémon',
    html: `
      <h2 class="play-help-wiki__h2">Painel do Pokémon</h2>
      <ul class="play-help-wiki__ul">
        <li><strong>Botão <code>+</code></strong> no canto do painel (quando está minimalista) — <strong>expande o painel completo</strong> com a busca: dá para <strong>trocar de Pokémon</strong> e experimentar outras espécies, por exemplo os <em>voadores</em> (que habilitam <kbd>F</kbd> para voo).</li>
        <li><strong>Busca</strong> — filtra espécies; clique numa para jogar como aquele Pokémon.</li>
        <li><strong>Ctrl+clique</strong> (<strong>Cmd+clique</strong> no Mac) — invoca um selvagem perto do jogador (debug).</li>
        <li><strong>Min / Full</strong> — painel minimal esconde busca, barra de clique direito e textos longos; retrato, tipos e moves compactos permanecem.</li>
        <li><strong>· / +</strong> (canto do painel) — alterna <strong>UI minimalista no jogo</strong>: <code>·</code> esconde a shell (toolbar, HUD cheio) deixando retrato + minimapa; <code>+</code> volta para a UI completa com busca.</li>
        <li><strong>Ground / Sea</strong> — altura em tiles: solo vs nível do mar (praia 0, oceano negativo).</li>
        <li><strong>Social numpad</strong> — grade com emotes/ações no teclado numérico (ver artigo Social).</li>
      </ul>
    `
  },
  {
    id: 'rclick',
    title: 'Clique direito',
    html: `
      <h2 class="play-help-wiki__h2">Clique direito</h2>
      <p class="play-help-wiki__p">No painel, escolha <strong>Game</strong> ou <strong>Debug</strong>:</p>
      <ul class="play-help-wiki__ul">
        <li><strong>Game</strong> — RMB dispara o move do segundo slot no mundo.</li>
        <li><strong>Debug</strong> — RMB abre o menu de contexto (teleporte, inspeção de tile, etc.).</li>
      </ul>
    `
  },
  {
    id: 'minimap',
    title: 'Minimapa',
    html: `
      <h2 class="play-help-wiki__h2">Minimapa</h2>
      <ul class="play-help-wiki__ul">
        <li><strong>Rodapé do minimapa</strong> — <strong>−</strong> / <strong>+</strong> afastam ou aproximam o zoom (mapa inteiro → médio → aproximado → máximo → …). O botão de <strong>expandir</strong> volta ao mapa global. Um selo no painel mostra o nível de zoom atual.</li>
        <li><strong>Livro</strong> — abre esta ajuda (índice com teclado, combate e <strong>Gamepad</strong>).</li>
        <li><strong>Nota musical</strong> — volume BGM, gritos, mute e opção de não mostrar o toast ao trocar de faixa.</li>
        <li><strong>Expandir</strong> (setas nos cantos) — volta ao <strong>mapa global</strong> (mesmo efeito que “Voltar ao mapa” na toolbar).</li>
      </ul>
    `
  },
  {
    id: 'audio',
    title: 'Áudio',
    html: `
      <h2 class="play-help-wiki__h2">Áudio</h2>
      <p class="play-help-wiki__p">Abra o popover pelo ícone de <strong>música</strong> no minimapa. Ali você ajusta <strong>BGM</strong>, <strong>gritos</strong> de Pokémon, <strong>mute</strong> global e pode suprimir o aviso flutuante quando a trilha muda de bioma.</p>
      <p class="play-help-wiki__p">No modo jogo “cheio”, o canto do mapa também pode mostrar o painel <strong>Now playing</strong>; no modo minimalista isso vira toast (se não estiver suprimido).</p>
    `
  },
  {
    id: 'social',
    title: 'Social (numpad)',
    html: `
      <h2 class="play-help-wiki__h2">Social (numpad)</h2>
      <p class="play-help-wiki__p">As teclas <strong>Numpad1–Numpad9</strong> (teclado numérico, não a linha de números em cima das letras) disparam <strong>ações sociais</strong>. O overlay <em>Social numpad</em> no canto da tela mostra o slot que foi apertado, e o selvagem mais próximo dentro de <strong>~9 tiles</strong> reage. Outros selvagens dentro de <strong>~14 tiles</strong> recebem um eco menor da ação.</p>

      <h3 class="play-help-wiki__h3">Tabela de slots</h3>
      <table class="play-help-wiki__table">
        <thead>
          <tr><th>Tecla</th><th>Ação</th><th>Intenção</th><th>Efeito primário no selvagem</th></tr>
        </thead>
        <tbody>
          <tr><td><kbd>Num1</kbd> 👋</td><td>Greet</td><td>friendly</td><td>+affinity forte, −threat. Bom pra abrir contato.</td></tr>
          <tr><td><kbd>Num2</kbd> 🙂</td><td>Smile</td><td>friendly</td><td>Mesmo perfil do Greet; útil como "confirmação".</td></tr>
          <tr><td><kbd>Num3</kbd> 🍎</td><td>Offer Food</td><td>calming</td><td>Reduz bastante <em>threat</em>. Ideal pra desarmar agressivos / acalmar fuga.</td></tr>
          <tr><td><kbd>Num4</kbd> 🤔</td><td>Curious Look</td><td>curious</td><td>Grande +curiosity, quase sem mexer em threat. Convida o selvagem a se aproximar.</td></tr>
          <tr><td><kbd>Num5</kbd> 😄</td><td>Playful Jump</td><td>playful</td><td>+curiosity alto, +affinity médio. Mood "vamos brincar".</td></tr>
          <tr><td><kbd>Num6</kbd> 🙇</td><td>Bow</td><td>calming</td><td>Parecido com Offer Food; extra bom quando você é maior que o selvagem.</td></tr>
          <tr><td><kbd>Num7</kbd> 😤</td><td>Challenge</td><td>assertive</td><td>+threat forte. Se o selvagem está a ≤2.25 tiles, vira <strong>soco social</strong>: 8 de dano + knockback.</td></tr>
          <tr><td><kbd>Num8</kbd> ⚠️</td><td>Warn</td><td>assertive</td><td>+threat sem dano. Bom pra afastar sem apanhar reputação feia.</td></tr>
          <tr><td><kbd>Num9</kbd> 💢</td><td>Threaten</td><td>scary</td><td>Maior +threat do jogo, −affinity. Pode "aggroar" bando da mesma espécie.</td></tr>
        </tbody>
      </table>

      <h3 class="play-help-wiki__h3">Como a reação é decidida</h3>
      <ul class="play-help-wiki__ul">
        <li>O selvagem mantém memória de <strong>affinity</strong>, <strong>threat</strong> e <strong>curiosity</strong>, que decaem sozinhas em alguns segundos.</li>
        <li>Arquétipo importa: <em>tímido</em> / <em>skittish</em> se assustam mais; <em>agressivo</em> não amedronta fácil.</li>
        <li>Tamanho importa: jogador maior <strong>intimida mais</strong> com <em>assertive/scary</em> e <strong>acalma mais</strong> com <em>calming</em>.</li>
        <li>Vir correndo em cima amplifica ameaça (<em>approachSignal</em>). Ficar parado depois ajuda a desescalar.</li>
        <li>Com score alto: o selvagem vira <strong>wander</strong> (desescala). Muito negativo: <strong>flee</strong>, ou <strong>approach</strong> se for agressivo e você usou <em>assertive/scary</em>.</li>
        <li>Cooldown por entidade: ~0.45s. Spam não empilha.</li>
      </ul>

      <p class="play-help-wiki__p">Referência completa com multiplicadores numéricos, raios exatos, broadcast de eventos e receitas práticas: veja <code>docs/SOCIAL-NUMPAD.md</code> no repositório.</p>
    `
  },
  {
    id: 'biomes',
    title: 'Onde começar (biomas)',
    html: `
      <h2 class="play-help-wiki__h2">Onde começar (biomas)</h2>
      <p class="play-help-wiki__p">Se for sua primeira vez no experimento, dá para clicar em qualquer região do mapa — mas alguns biomas têm mais conteúdo interativo pronto:</p>
      <ul class="play-help-wiki__ul">
        <li><strong>Verde claro</strong> (campo / grama) — ótimo pra começar: espaço aberto, muitos selvagens de tipos comuns, bom pra testar corrida, pulo duplo e combate básico.</li>
        <li><strong>Verde escuro</strong> (floresta) — denso, com cortes de mato (<em>Cut</em>), rotas de Pokémon planta/bicho; bom pra combo de 3 cortes.</li>
        <li><strong>Marrom</strong> (rocha / montanha) — bastante <strong>grab</strong> (<kbd>E</kbd> ou <strong>○</strong> no controle): pedras pra carregar e arremessar, cristais pra quebrar com Tackle carregado; Pokémon de <em>Pedra</em> e <em>Lutador</em>.</li>
      </ul>
      <p class="play-help-wiki__p">Outros biomas (água, neve, deserto, etc.) funcionam, mas ainda estão menos povoados em mecânicas. Use o <strong>botão <code>+</code></strong> no painel do Pokémon para trocar de espécie e casar com o bioma que você escolheu.</p>
    `
  },
  {
    id: 'world-time',
    title: 'Tempo do dia (teste)',
    html: `
      <h2 class="play-help-wiki__h2">Tempo do dia (teste)</h2>
      <p class="play-help-wiki__p">O widget <strong>World time</strong> no canto do mapa (modo jogo) ajusta a hora do mundo, presets (dawn/day/afternoon/night), avanço em tempo real e velocidade (game h por segundo real). Serve para pré-visualizar iluminação / fases do dia.</p>
    `
  }
];

/**
 * @param {{ forceCloseMinimapAudioPopover?: () => void }} [deps]
 */
export function installPlayHelpWikiModal(deps = {}) {
  const forceCloseMinimapAudioPopover =
    typeof deps.forceCloseMinimapAudioPopover === 'function' ? deps.forceCloseMinimapAudioPopover : () => {};

  const root = document.getElementById('play-help-wiki-modal');
  const toggleBtn = document.getElementById('minimap-help-toggle');
  const navEl = document.getElementById('play-help-wiki-nav');
  const articleEl = document.getElementById('play-help-wiki-article');
  const closeBtn = document.getElementById('play-help-wiki-close');
  const backdrop = root?.querySelector('.play-help-wiki__backdrop');

  if (!root || !toggleBtn || !navEl || !articleEl || !closeBtn) {
    return { isOpen: () => false, open: () => {}, close: () => {} };
  }

  let open = false;
  /** @type {string} */
  let activeId = ARTICLES[0].id;

  function setNavActive() {
    for (const btn of navEl.querySelectorAll('.play-help-wiki__toc-link')) {
      if (!(btn instanceof HTMLButtonElement)) continue;
      const id = btn.dataset.article || '';
      btn.classList.toggle('is-active', id === activeId);
    }
  }

  function renderArticle() {
    const art = ARTICLES.find((a) => a.id === activeId) ?? ARTICLES[0];
    articleEl.innerHTML = art.html;
  }

  function buildNav() {
    navEl.textContent = '';
    for (const a of ARTICLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'play-help-wiki__toc-link';
      b.dataset.article = a.id;
      b.textContent = a.title;
      navEl.appendChild(b);
    }
    setNavActive();
  }

  function setOpen(next) {
    open = next;
    root.classList.toggle('hidden', !open);
    root.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    document.body.classList.toggle('play-help-wiki-open', open);
    if (open) {
      forceCloseMinimapAudioPopover();
      renderArticle();
      setNavActive();
      window.requestAnimationFrame(() => {
        closeBtn.focus();
      });
    } else {
      toggleBtn.focus();
    }
  }

  function close() {
    setOpen(false);
  }

  function openModal() {
    setOpen(true);
  }

  function toggle() {
    setOpen(!open);
  }

  buildNav();
  renderArticle();

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  closeBtn.addEventListener('click', () => close());
  backdrop?.addEventListener('click', () => close());

  navEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest('.play-help-wiki__toc-link');
    if (!(btn instanceof HTMLButtonElement)) return;
    const id = btn.dataset.article;
    if (!id) return;
    activeId = id;
    renderArticle();
    setNavActive();
    articleEl.scrollTop = 0;
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (!open || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    },
    true
  );

  return {
    isOpen: () => open,
    open: openModal,
    close
  };
}
