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

## 3. Diretrizes para Futuras Implementações

Para manter o desempenho, siga estas regras ao editar o `render.js`:

1. **Nunca use `getMicroTile` em loops**: Sempre use o `getCachedTile` (dentro do `bakeChunk`) ou o `getCached` (dentro do `render` dinâmico).
2. **Mantenha o Cache Atualizado**: Se adicionar uma regra que precise de vizinhos mais distantes (raio de 3+ tiles), certifique-se de aumentar a margem de pré-carregamento do cache no início da função.
3. **Evite Cálculos Pesados no Pass 5**: O Passo 5 (Tops dinâmicos/Vento) roda **todos os frames**. Mantenha a lógica de seleção de tiles simples e delegue tudo que for estático para os passos de "Bake".

> [!TIP]
> O uso de chaves numéricas `(mx << 16) | (my & 0xFFFF)` no Cache Map é significativamente mais rápido em Javascript do que chaves de string como `"${mx},${my}"`.
