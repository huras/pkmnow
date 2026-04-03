# 🎨 Arquitetura de Renderização: O Segredo dos 60 FPS

Este documento detalha o funcionamento interno do motor de renderização do **Procedural Pokémon Region Generator**, explicando como a sincronização de camadas e o sistema de cache transformaram a experiência de 20 para 60 quadros por segundo.

---

## 🏗️ A Filosofia das Duas Realidades

Para alcançar alta performance em um mundo procedural denso, dividimos a renderização em duas camadas verticais fundamentais:

### 1. Camada Estática (The Foundation) 🪨
*   **O que é:** Terreno (Grama, Areia, Penhascos) e Bases de Objetos (Troncos de árvores, Rochas).
*   **Como funciona:** Renderizada em um `Canvas` off-screen (`playStaticLayerCache`) apenas quando o jogador cruza a fronteira de um chunk de tiles.
*   **Performance:** O navegador trata essa camada como uma única imagem gigante. Mover uma imagem é ordens de magnitude mais rápido do que calcular a tesselação de centenas de tiles individualmente.

### 2. Camada Dinâmica (The Living World) ✨
*   **O que é:** Copas de árvores (Tops), Água animada, Jogador e Pokémon.
*   **Como funciona:** Renderizada a cada frame em tempo real.
*   **Performance:** Como a base já está pronta no cache, a CPU/GPU fica livre para focar apenas nos efeitos de vento e animações fluidas.

---

## 🛰️ Sincronização e Pixel-Perfection

Um dos maiores desafios foi o **"Jitter de Sub-pixel"**. Corrigimos isso alinhando o mundo inteiro a uma única régua matemática:

> [!IMPORTANT]
> **A Regra de Ouro:** Utilizamos `Math.round` de forma unificada em ambas as camadas. Se o mundo translada 160.7 pixels, arredondamos para 161. Isso evita que as copas das árvores "shimmer" (tremam) ou se separem dos troncos durante o movimento.

```javascript
// A mesma fórmula para todos os elementos (Bases e Tops)
const currentTransX = Math.round(cw / 2 - (vx + 0.5) * tileW);
const cacheTransX = Math.round(cw / 2 - (vx0 + 0.5) * tileW);
const shiftX = currentTransX - cacheTransX - marginX;

ctx.drawImage(cache.canvas, shiftX, shiftY);
ctx.translate(currentTransX, currentTransY);
```

---

## ⚡ Otimização de Busca por Raiz (Scatter-Sync)

Implementamos uma **Exclusão Mútua Estrita** para garantir que apenas árvores válidas sejam desenhadas:

1.  **Validação de Raiz:** O motor pergunta "Este tile é o TRONCO de uma árvore válida?".
2.  **Memória de Spawner:** Se a resposta for sim, ele desenha o objeto completo (Base + Top).
3.  **Poda Automática:** Se a resposta for não (ex: a árvore está muito perto de outra), ele descarta os cálculos de renderização imediatamente.

---

## 🏎️ Otimização de Buffer (FPS Stability)

Para evitar pequenas "travadas" (spikes) ao andar, o sistema utiliza **Buffered Caching**:
*   O cache não é reconstruído a cada 1 tile andado, mas sim a cada **8 tiles**.
*   Uma margem de segurança ao redor do viewport permite que você caminhe livremente por essa área sem que o motor precise recalcular o terreno caro.

---

## 🌊 Fluxo de Renderização (Render Pipeline)

1.  **Pre-Pass:** Rebuild do Cache Estático (se necessário - a cada 8 tiles).
2.  **Pass 0:** Desenho da Camada Estática (Terreno + Bases).
3.  **Pass 1:** Animação da Água (Procedural Wavefront).
4.  **Pass 2:** Personagem (Shadows + Actor).
5.  **Pass 3:** Camada de Tops (Copas com Wind Sway).
6.  **Post-Pass:** UI e HUD de coordenadas.
