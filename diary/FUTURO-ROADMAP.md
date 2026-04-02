# Futuro Roadmap: Evolução do Gerador

## Objetivos de Curto a Médio Prazo

Após a implementação bem-sucedida das Fases 0 a 5, o foco do projeto muda da **estruturação matemática** para a **experiência e fidelidade**. 

Aqui estão as diretrizes para os próximos desenvolvimentos:

---

### [IDEIA 1] Fase 6: Sistema de Tilesets Estilizados
A meta é abandonar a renderização abstrata (blocos de cores) e adotar uma estética que remeta visualmente ao GBA.
- **Implementação**: Uso de **Bitmasking** (Autotiling) no Canvas para carregar sprites específicos de bordas e cantos entre biomas.
- **Visual**: Substituir triângulos por sprites de árvores pontuais e grama ondulada.

### [IDEIA 2] Fase 7: Experiência do Usuário e Navegabilidade
A ferramenta deve permitir "vivenciar" o mundo gerado para testar o *design* de níveis procedurais.
- **O Modo Explorador**: Um personagem (sprite de treinador) com controle via teclado, colisão configurada e animações de caminhada simples.
- **Feedback Visual**: Exibir pop-ups no mapa de encontros Pokémon ou nomes de cidades ao entrar em áreas específicas.

### [IDEIA 3] Fase 8: Inteligência Regional (PCG Avançado)
Aperfeiçoar a lógica de geração para eliminar artefatos visuais e garantir a jogabilidade.
- **Conectividade Inteligente**: Lógica de "Flood Fill" para garantir que o jogador nunca nasça preso em ilhas ou cercado por montanhas intransponíveis.
- **Estruturas Adaptativas**: Geração de pontes visuais onde rotas e rios se cruzam, e ícones de cavernas (túneis) para rotas que atravessam montanhas.

---

## Conclusão
Estas etapas transformam o gerador numa ferramenta completa de prototipagem rápida para jogos e vídeos de simulação. Com os dados agora exportáveis (Fase 5), o caminho está livre para aplicar qualquer uma dessas ideias sem quebrar a estabilidade do *core* do gerador.
