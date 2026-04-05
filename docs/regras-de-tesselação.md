Regras de tesselação de sprites nas UVs da grid:

```
Logica de tilesets de terreno
Sets concavo + convexo:
	Set concavo + convexo A (conc-conv-a):
		[
			[OUT_NW, EDGE_N, OUT_NE],
			[EDGE_W, CENTER, EDGE_E, IN_SE, IN_SW],
			[OUT_SW, EDGE_S, OUT_SE, IN_NE, IN_NW],
		]
	ou (conc-conv-b):
		[
			[OUT_NW, EDGE_N, OUT_NE, IN_SE, IN_SW],
			[EDGE_W, CENTER, EDGE_E, IN_NE, IN_NW],
			[OUT_SW, EDGE_S, OUT_SE],
		]
	ou (conc-conv-c):
		[
			[OUT_NW, EDGE_N, OUT_NE, IN_SE, IN_SW],
			[EDGE_W, CENTER, EDGE_E, IN_NE, IN_NW],
			[OUT_SW, EDGE_S, OUT_SE]
		]
		(Não usar papéis IN_EDGE_E / IN_EDGE_W — não existem neste esquema; só IN_NE, IN_NW, IN_SE, IN_SW.)
	ou (conc-conv-d):
		[
			[OUT_NW, EDGE_N, OUT_NE],
			[EDGE_W, CENTER, EDGE_E],
			[OUT_SW, EDGE_S, OUT_SE]
		]

Sets esticaveis:
	As extermidades são os mesmos tiles, mas o meio se repete seamless sem limite.
	(extentable-vertical-three-piece-a)
		[
			[TOP_EXTREMITY],
			[SEAMLESS_CENTER],
			[BOTTOM_EXTREMITY]
		]
	(extentable-horizontal-three-piece-a)
		[
			[LEFT_EXTREMITY, SEAMLESS_CENTER, RIGHT_EXTREMITY]
		]
	
Sets single:
	Encaixa seamless com ele mesmo mas apenas numa direção (qualquer lado dela)
	(seamless-horizontal-single-piece-a)
		[
			[SEAMLESS_TILE]
		]
	
	(seamless-vertical-single-piece-a)
		[
			[SEAMLESS_TILE]
		]
		
For "non-terrain/non-grass" tiles that represent objects, only base tiles of the shape are non walkable! i exemplified on trees but apply it to all obstacles.
		
IDs de objetos que ocupam mais de um tile são dados na ordem "left to right, top to bottom".
Tamanho dos tiles por exemplo "(2x1)" é dado em linhas x colunas.
---

Base terreno (Underground layers Height changes): 
	Os tilesets aqui são encaixaveis um em cima do outro para formar paredões na troca de altura
	Tipos:
		1 tile Height level change
			Terra Marrom - Center ID = 104 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Terra Amarela - Center ID = 354 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Terra Vermelha - Center ID = 604 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Pedra - Center ID = 854 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Pedra Azul - Center ID = 1104 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Gelo - Center ID = 1304 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
			Pedra Roxa - Center ID = 1554 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-c)
		
			
Layer Base:
	A layer que está em contato com a superficie, que vai receber a forragem na layer logo acima.
	tiles aqui não são seamlesss com os niveis abaixo dele, são "piramidais".
	Ex: num tiling 3x3, só o terreno do CENTER e o do EDGE_N são walkable (quando se está no nivel superior). (no nivel inferior nenhum OUT_x ou EDGE_x é walkable)
	Tipos:
		Dirty
			dirt - Center ID = 856 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			light-grass - Center ID = 861 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			super-healthy-light-grass - Center ID = 867 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			sandy - Center ID = 871 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			snowy - Center ID = 876 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			grassy - Center ID = 881 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			super-healthy-light-grass -  Center ID = 1052 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		Yellow Dirty
			yellow-dirt - Center ID = 1027 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			sandy - Center ID = 1042 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		Rocky
			rock - Center ID = 1032 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			snowy - Center ID = 1047 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		Red Dirty
			red-dirt - Center ID = 1037 , (conc-conv-a), [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)	
		
	
Forragem do Terreno: 
	Skin usada acima, cobre apenas tiles com CENTER tiles de base terreno. 
	Não bloqueia passgem do jogador
	(Não precisaria cobrir todos, só onde o player pode passar (onde não tem arvore nem plantas)
	Tipos: separados por borda e interior
		with green  borders
			light-dirt - Center ID = 2110 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			dark-dirt -  Center ID = 2115 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			light-grass -  Center ID = 2120 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			rocky -  Center ID = 2130 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			sandy -  Center ID = 2135 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			super-healthy-light-grass -  Center ID = 2158 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		with orange dirt/grass borders
			orange-grass -  Center ID = 2125 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		with yellow dirt/grass borders
			yellow grass -  Center ID = 2140 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-b)
		with frozen borders
			light-dirt -  Center ID = 2281 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			dark dirt -  Center ID = 2286 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			light grass -  Center ID = 2291 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			sandy -  Center ID = 2153 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			frozen-rocky -  Center ID = 2322 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			fronze-dirt -  Center ID = 2148 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-b)
		with dark green borders			
			super-healthy-dark-grass -  Center ID = 2306 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
			dark-dirt -  Center ID = 2632 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		with purple borders
			rocky - Center ID = 1535 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		with gray borders
			rocky - Center ID = 1285 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		with dark gray borders
			rocky - Center ID = 835 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		with red dirt borders
			rocky - Center ID = 585 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		with yellow dirt borders
			rocky - Center ID = 335 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		with dirt borders
			rocky - Center ID = 85 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
			
Estradas / Roads:
	Camada de asfalto/terra batida que segue caminhos conectando cidades.
	Sempre usa o set conc-conv-b para bordas suaves com o bioma ao redor.
	Tipos:
		road - Center ID = 2851 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-b)
			
Lago no terreno:
	Non sea water heigh change tiling
	Tipos:
		Borda com grama
			lago-de-agua-doce-grass - Center ID = 2492 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		Borda com dirt/terra
			lago-de-agua-doce-dirt - Center ID = 77 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
			lava-lake-dirt - Center ID = 2311 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		Borda com pedra/rock
			lago-de-agua-doce-rock - Center ID = 827 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		Borda com pedra/rock congelada (agua liquida)
			lago-de-agua-doce-rock - Center ID = 1277 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		Borda com pedra/rock purples
			lago-de-agua-doce-rock - Center ID = 1527 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (conc-conv-a)
		

Costa do terreno:
	sea water height change tiling, beaches
	Tipos:
		sandy - Center ID = 2467  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		snowy-sandy - Center ID = 2497 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)

		
Low Grass:
	Allow player to walk above
		small-grass - ID 60 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		small-grass-ice - ID 61 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		pink-leaves-on-ground-5-count - ID 25 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		pink-leaves-on-ground-3-count - ID 26 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		pink-leaves-on-ground-7-count - ID 27 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		orange-leaves-on-ground-5-count - ID 82 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		orange-leaves-on-ground-3-count - ID 83 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		orange-leaves-on-ground-7-count - ID 84 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			

		
Grasses
	alow player in but will get a special system to render half bottom of tile above the player.
	Tipos:
		jungly tall grass - IDs 30,87  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		low water depth very tall grass - IDs 31,88  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		grass - ID 117 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		snow-grass - ID 118 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		tall-grass - ID 3 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		tall-snow-grass - ID 4 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)

		dense-bushes - Center ID = 67 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		dense-bushes-covered-with-snow - Center ID = 72 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
		
		sand-grass - ID = 1884 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		
		
Trees:
	tops: walkable + above-player
	base: not walkable
	Tipos:
		green-broadleaf-1: IDs 171,172,228,229 (tops) + 285,286 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		red-broadleaf-1: IDs 173,174,230,231 (tops) + 287,288 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		orange-broadleaf-1: IDs 175,176,232,233 (tops) + 289,290 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		yellow-broadleaf-1: IDs 177,178,234,235 (tops) + 291,292 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-broadleaf-1-half-covered-with-snow: IDs 179,180,236,237 (tops) + 293,294 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-broadleaf-1-full-covered-with-snow: IDs 181,182,238,239 (tops) + 295,296 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		green-broadleaf-2: IDs 183,184,240,241 (tops) + 297,298 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		red-broadleaf-2: IDs 185,186,242,243 (tops) + 299,300 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		orange-broadleaf-2: IDs 187,188,244,245 (tops) + 301,302 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		yellow-broadleaf-2: IDs 189,190,246,247 (tops) + 303,304 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-broadleaf-2-half-covered-with-snow: IDs 191,192,248,249 (tops) + 305,306 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-broadleaf-2-full-covered-with-snow: IDs 193,194,250,251 (tops) + 307,308 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		green-pine-1: IDs 195,196,252,253 (tops) + 309,310 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-pine-1-half-covered-with-snow: IDs 197,198,254,255 (tops) + 311,312 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		green-pine-1-full-covered-with-snow: IDs 199,200,256,257 (tops) + 313,314 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		baby-pine-tree-green: IDs 258 (top) + 315 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		baby-pine-tree-red: IDs 259 (top) + 316 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		baby-pine-tree-orange: IDs 260 (top) + 317 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		baby-pine-tree-yellow: IDs 261 (top) + 318 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		baby-pine-tree-full-snow: IDs 262 (top) + 319 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		
		dry-grass: IDs 8 (top) + 65 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		
		baby-broadleaf-a: IDs 7 (top) + 64 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		
		vine: IDs 5 (top) + 62 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (2x1)
		
		palm-tree-with-coconuts: IDs 206,207,263,264 (tops) + 320,321 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		palm-tree: IDs 208,209,265,266 (tops) + 322,323 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		mangrove-tree: IDs 212,213,269,270 (tops) + 326,327 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		japanese-green-tree: IDs 214,215,216,271,272,273 (tops) + 328,329,330 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x3)
		
		large-green-barodleaf-1: IDs 342,343,344,399,400,401,456,457,458 (tops) + 513,514,515 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		
		large-green-broadleaf-1: IDs 342,343,344,399,400,401,456,457,458 (tops) + 513,514,515 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-red-broadleaf-1: IDs 345,346,347,402,403,404,459,460,461 (tops) + 516,517,518 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-orange-broadleaf-1: IDs 348,349,350,405,406,407,462,463,464 (tops) + 519,520,521 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-yellow-broadleaf-1: IDs 351,352,353,408,409,410,465,466,467 (tops) + 522,523,524 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-green-broadleaf-1-half-covered-with-snow: IDs 354,355,356,411,412,413,468,469,470 (tops) + 525,526,527 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-green-broadleaf-1-full-covered-with-snow: IDs 357,358,359,414,415,416,471,472,473 (tops) + 528,529,530 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		
		pine-green-1: IDs 360,361,362,417,418,419,474,475,476 (tops) + 531,532,533 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		pine-green-1-half-snow: IDs 363,364,365,420,421,422,477,478,479 (tops) + 534,535,536 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		pine-green-1-full-snow: IDs 366,367,368,423,424,425,480,481,482 (tops) + 537,538,539 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		
		fat-palm: IDs 570,571,572,627,628,629,684,685,686 (tops) + 741,742,743 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-palm: IDs 573,574,575,630,631,632,687,688,689 (tops) + 744,745,746 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-palm-with-coconuts: IDs 576,577,578,633,634,635,690,691,692 (tops) + 747,748,749 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		large-palm-with-bananas: IDs 579,580,581,636,637,638,693,694,695 (tops) + 750,751,752 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		
		savannah-tree: IDs 594,595,596,651,652,653,708,709,710 (tops) + 765,766,767 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (4x3)
		
		big-cactus-1: IDs 1881,1882,1938,1939 (tops) + 1995,1996 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (3x2)
		
		small-cactus: ID 1940 (top) + 1997 (base) [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1×1 footprint, 2 tiles tall stacked like baby pine)
		
Terrain Deails / obstables / interactables:
	Coisas encontradas no terreno que bloqueiam o jogador e enfeitam o cenário.
	Blocks player from walking, can be picked up in the future.
	Tipos:
		Shells
			pointy-sea-shell - ID = 1883 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			fold-sea-shell - ID = 1885 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		Mushrooms
			mushroom-1 - ID 119 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		On low depth Water terrain
			cattail - ID 28  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
				lily
			red-lily - ID 19 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			purple-lily - ID 20 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			yellow-lily - ID 21 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			blue-lily - ID 22 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			orange-lily - ID 23 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			pink-lily - ID 24 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		daisies
			red-daisy - ID 76 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			white-daisy - ID 77 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			blue-daisy - ID 78 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			orange-daisy - ID 79 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			pink-daisy - ID 80 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			yellow-daisy - ID 81 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		coreopsis
			red-coreopsis - ID 133 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			pink-coreopsis - ID 134 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			white-coreopsis - ID 135 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			yellow-coreopsis - ID 136 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			purple-coreopsis - ID 137 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			blue-coreopsis - ID 138 [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		low water vegetation
			lotus - ID 86  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
			lotus-with-flowers - ID 85  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (1x1)
		Crystals / "Minérios"
			small-blue-crystal - ID 125 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			blue-crystal - IDs 74, 124 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-blue-crystal - IDs 174, 175, 224, 225 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-yellow-crystal - ID 375 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			yellow-crystal - IDs 324, 374 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-yellow-crystal - IDs 424, 425, 474, 475 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-red-crystal - ID 625 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			red-crystal - IDs 574, 624 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-red-crystal - IDs 674, 675, 724, 725 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-green-crystal - ID 875 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			green-crystal - IDs 824, 874 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-green-crystal - IDs 924, 925, 974, 975 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-purple-crystal - ID 1075 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			purple-crystal - IDs 1024, 1074 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-purple-crystal - IDs 1124, 1125, 1174, 1175 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-pink-crystal - ID 1325 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			pink-crystal - IDs 1274, 1324 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-pink-crystal - IDs 1374, 1375, 1424, 1425 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-light-blue-crystal - ID 1575 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			light-blue-crystal - IDs 1524, 1574 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-light-blue-crystal - IDs 1624, 1625, 1674, 1675 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)
			
			small-dirt-rocks-a - ID = 32 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			small-dirt-rocks-b - ID = 33 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			dirt-rock - ID = 31 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (1x1)
			medium-dirt-rock - ID = 31 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x1)
			large-dirt-rock-a - ID = 31 [flurmimons_tileset___caves_by_flurmimon_dafqtdm.tsx] (2x2)

Roads:
	gray-brick-mosaic-pavement - Center ID = 2647  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
	cemented-pavement - Center ID = 2652  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
	detailed-small-bricks-pavement - Center ID = 2629  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-d)
	

Bridges:
	wooden-bridge - Center ID = 676  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-a)
	vertical-planks-but-horizontal-direction-wooden-bridge - Center ID = 673  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-d)
	horizontal-planks-but-vertical-direction-wooden-bridge - Center ID = 670  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (conc-conv-d)

Road Stairs:
	left-to-right-raising-terrain-stairs - SEAMLESS_CENTER ID = 483  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (extentable-vertical-three-piece-a)
	right-to-left-raising-terrain-stairs - SEAMLESS_CENTER ID = 484  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (extentable-vertical-three-piece-a)
	stair-ns (South-to-North raising) - SEAMLESS_TILE ID = 370  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (seamless-horizontal-single-piece-a)
	stair-sn (North-to-South raising) - SEAMLESS_TILE ID = 107  [flurmimons_tileset___nature_by_flurmimon_d9leui9.tsx] (seamless-horizontal-single-piece-a)


```
