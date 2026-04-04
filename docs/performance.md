# Performance & Optimization

Este documento detalha as estratégias de otimização utilizadas para manter o motor de renderização procedimental rodando a **60 FPS**, mesmo com regras complexas de tesselação e biomas.

## 1. O Gargalo de Renderização (O "Problema das 25k chamadas")

Com a introdução de regras de **Height-Safety** (onde a vegetação deve estar a pelo menos 1 tile de distância de qualquer desnível), o custo computacional por chunk disparou.

### Causa:
Para cada tile sendo renderizado, o motor precisava:
1. Calcular seu próprio bioma e altura (`getMicroTile`).
2. Calcular a altura de seus **8 vizinhos** (Raio de 1 tile) para garantir a segurança.
3. Executar o motor de tesselação, que por sua vez pede o estado de vizinhos novamente.

Isso gerava uma progressão geométrica de cálculos de ruído Perlin e Hashing, chegando a aproximadamente **25.000 chamadas de `getMicroTile` por chunk de 16x16**.

## 2. A Solução: Local Metadata Cache (LUT)

Para resolver este problema, implementamos um sistema de **Look-Up Table (LUT)** local dentro das funções de renderização (`bakeChunk` e `render`).

### Como funciona:
Em vez de chamar a matemática do `getMicroTile` sob demanda, fazemos um "pré-aquecimento" do cache:

1. **Pre-calc**: No início da função, iteramos sobre a área visível (mais uma margem de segurança de 2 tiles) e armazenamos os objetos de metadados em um `Map` rápido.
2. **Keying**: Utilizamos chaves numéricas bitwise `(mx << 16) | (my & 0xFFFF)` para que o acesso ao Map seja o mais rápido possível no V8.
3. **Lookup**: Todas as funções internas (predicados de tesselação e filtros de altura) agora consultam o cache em vez de reprocessar o ruído.

### Resultado:
- **Redução extrema**: O número de cálculos de ruído caiu de ~25.000 para exatos **400 por chunk** (área 20x20 contemplando a margem).
- **Estabilização de FPS**: O framerate subiu de **37~39 FPS** de volta para **60 FPS** estáveis.

## 3. Vento Otimizado: Animation Atlas (Pre-rendered Frames)

### O Problema: Rotação Dinâmica Pesada
Tentar animar o balanço do vento usando `ctx.rotate()` em milhares de tiles de grama por frame derrubaria o FPS de 60 para ~30. O Canvas 2D sofre com o overhead de `save()`, `translate()`, `rotate()` e `restore()` quando executado em larga escala dentro de um loop de renderização (Pass 5).

### A Solução: Pré-renderização Seletiva
Em vez de calcular a rotação a cada frame, usamos o **`AnimationRenderer`**:
1.  **Geração Única**: No primeiro pedido de um tile de vegetação, o sistema gera 3 versões (frames) dele: `Esquerda`, `Centro`, `Direita`, já pré-girados em mini-canvases ocultos.
2.  **Desativação de Filtros (Pixel Art)**: Forçamos `ctx.imageSmoothingEnabled = false` durante a geração para garantir que a rotação não borre os pixels.
3.  **Desenho "Burro" (Rápido)**: No `render.js`, apenas escolhemos qual imagem pronta usar baseado no tempo (`Math.sin(time)`). Uma chamada de `ctx.drawImage` de uma imagem estática é ordens de grandeza mais rápida que uma operação de matriz de rotação.

### Resultados:
*   **Performance**: Estável em **60 FPS** mesmo com toda a grama do mapa balançando simultaneamente.
*   **Sincronização**: O balanço usa offsets baseados na posição `(mx, my)`, criando um efeito de "onda" que viaja pelo mapa.

## 4. Diretrizes para Futuras Implementações

Para manter o desempenho, siga estas regras ao editar o `render.js`:

1.  **Nunca use `getMicroTile` em loops**: Sempre use o `getCachedTile` (dentro do `bakeChunk`) ou o `getCached` (dentro do `render` dinâmico).
2.  **Mantenha o Cache Atualizado**: Se adicionar uma regra que precise de vizinhos mais distantes (raio de 3+ tiles), certifique-se de aumentar a margem de pré-carregamento do cache no início da função.
3.  **Evite `ctx.rotate()` e `ctx.save()` no Pass 5**: Operações de estado de contexto são custosas. Para novas animações, utilize o **`AnimationRenderer`** para pré-gerar frames rotacionados.

> [!TIP]
> O uso de chaves numéricas `(mx << 16) | (my & 0xFFFF)` no Cache Map é significativamente mais rápido em Javascript do que chaves de string como `"${mx},${my}"`.
