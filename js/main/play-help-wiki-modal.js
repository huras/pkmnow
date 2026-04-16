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
      <ul class="play-help-wiki__ul">
        <li><strong>WASD</strong> ou <strong>setas</strong> — andar em 8 direções (diagonal normalizada).</li>
        <li><strong>Duplo toque</strong> na mesma direção cardinal (dentro de ~320 ms) — ativa <strong>corrida</strong> até parar de se mover.</li>
        <li><strong>Espaço</strong> — <strong>pulo</strong>.</li>
        <li><strong>F</strong> — alterna <strong>voo criativo</strong> (Pokémon com tipo Voador). Com voo: Espaço / Shift ajustam altitude; o HUD indica se o voo está ligado.</li>
        <li><strong>Esc</strong> — sai do modo jogo (volta ao mapa global), exceto quando a ajuda está aberta — aí fecha só a ajuda.</li>
      </ul>
    `
  },
  {
    id: 'combat',
    title: 'Combate e golpes',
    html: `
      <h2 class="play-help-wiki__h2">Combate e golpes</h2>
      <ul class="play-help-wiki__ul">
        <li><strong>LMB</strong> — golpe de campo (Tackle, Cut, etc.). Segure <strong>1</strong> para abrir a roda e trocar o move de campo.</li>
        <li>Segure <strong>1</strong> + solte <strong>LMB</strong> — carrega golpes com modo charge (ex.: Tackle).</li>
        <li><strong>Cut</strong> — combo de 3 cortes no alvo.</li>
        <li><strong>E</strong> — interação de força (pegar/soltar pedras); com pedra, <strong>soltar LMB</strong> arremessa.</li>
        <li><strong>RMB</strong> — slot secundário de move (modo jogo no painel “Right-click: Game”).</li>
        <li><strong>Ctrl esquerdo + clique</strong> — terceiro / quarto slots.</li>
        <li><strong>MMB</strong> (botão do meio) — Ultimate.</li>
        <li><strong>Digit2–Digit5</strong> — slots de move em combate; segure a tecla para ligar o move ao slot na roda de binding.</li>
        <li><strong>Teclas 2–0 e -</strong> — atalhos de golpes conforme slots configurados.</li>
      </ul>
    `
  },
  {
    id: 'panel',
    title: 'Painel do Pokémon',
    html: `
      <h2 class="play-help-wiki__h2">Painel do Pokémon</h2>
      <ul class="play-help-wiki__ul">
        <li><strong>Busca</strong> — filtra espécies; clique para jogar como aquele Pokémon.</li>
        <li><strong>Ctrl+clique</strong> (<strong>Cmd+clique</strong> no Mac) — invoca um selvagem perto do jogador (debug).</li>
        <li><strong>Min / Full</strong> — painel minimal esconde busca, barra de clique direito e textos longos; retrato, tipos e moves compactos permanecem.</li>
        <li><strong>· / +</strong> (canto do painel) — <strong>UI minimalista no jogo</strong>: esconde shell (toolbar, HUD cheio) e deixa retrato + minimapa; dicas de contexto ficam sobre o mapa.</li>
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
        <li><strong>Lupa</strong> — alterna zoom: mapa inteiro → médio → aproximado → mapa inteiro. Um selo ao lado do painel mostra o nível atual.</li>
        <li><strong>Livro</strong> — abre esta ajuda.</li>
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
      <p class="play-help-wiki__p">Com o teclado numérico, cada tecla dispara uma ação social listada na grade do painel (emote + rótulo). O jogo mostra feedback visual breve e propaga a ação para os selvagens conforme a implementação atual.</p>
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
