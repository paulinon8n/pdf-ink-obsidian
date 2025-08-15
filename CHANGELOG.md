# PDF Ink — Changelog

> Integra desenho à mão livre ao leitor de PDF nativo do Obsidian, com persistência via sidecar JSON e exportação flatten.



Aqui está um **CHANGELOG.md** completo desde a **0.6.0** com tudo que tentamos (o que funcionou e o que não funcionou), arquivos afetados e observações específicas de Desktop/iPad.

---

# Changelog

## 0.6.4 — WebGL DOM estável, preview restaurado (2025-08-14)

### Fixed

* **Preview voltando a aparecer enquanto desenha (Desktop+iPad).**
  Corrigido bug de *binding* ao chamar `drawStrokeTail` sem o `this` correto — o método era extraído para uma função “solta”, resultando em `this === undefined` e erro:

  ```
  TypeError: Cannot read properties of undefined (reading 'presentMode')
  ```

  Agora chamamos **como método** (`this.renderer.drawStrokeTail(...)`), preservando o contexto.

### Changed

* Fluxo **WebGL DOM puro**: base dos traços comprometidos é redesenhada **apenas uma vez** no `pointerdown`; depois desenhamos o *tail* incremental em cada movimento.
  (Removido o “fallback” que redesenhava a base a cada frame.)
* Mantido apenas `renderer.present()` (interno: `gl.flush()`) após cada atualização do *tail*.

### Removed

* Qualquer *fallback* de re-render base “por segurança” durante o `pointermove`.
* Qualquer caminho automático que caísse em Canvas2D quando o modo definido é `webgl`.

### Files

* `main/src/ui/PageOverlayView.ts` — invocação correta do método (`this.renderer.drawStrokeTail(...)`), sem fallbacks; fluxo de *tail* incremental simplificado.
* `main/src/render/WebGLRenderer.ts` — implementação de `drawStrokeTail`, `present()` e *flush* pós-`drawArrays`.
* `main/src/render/IRenderer.ts` — interface com `drawStrokeTail?` e `present?`.

### Notes

* Sintoma original (preview só aparece no `pointerup`) era 100% compatível com o erro de binding; após a correção, preview aparece normalmente.

---

## 0.6.3 — Teste de persistência do buffer e tentativa de contorno (2025-08-14)

> **Resultado: não resolveu o preview** (o root cause era o binding acima), mas mantivemos um ajuste útil.

### Added

* Contexto WebGL no modo **DOM** solicitado com `preserveDrawingBuffer: true` para manter o conteúdo do quadro entre frames.

### Changed

* (Temporário) *fallback*: se o buffer não fosse persistente, refazíamos a base de traços a cada `pointermove` antes do *tail*.

### Files

* `WebGLRenderer.ts` — `getContext("webgl", { preserveDrawingBuffer: true, ... })`.
* `PageOverlayView.ts` — lógica para detectar “buffer persistente” e, **se** não persistente, re-render da base durante o movimento.

### Observações

* Desktop (ANGLE/Direct3D11) reportou `preserveDrawingBuffer: true`; no iPad não conseguimos ver o log.
* **Preview ainda não aparecia** porque o frame abortava com `TypeError` (binding perdido) — ver 0.6.4.

---

## 0.6.2 — Forçar apresentação imediata (2025-08-14)

> **Resultado: sem efeito visível por causa do erro de binding que abortava o frame.**

### Added

* `present()` no renderer chamando `gl.flush()`.
* `gl.flush()` após cada `drawArrays` para “empurrar” o lote.

### Files

* `WebGLRenderer.ts` — `present()`, *flush* pós-`drawArrays`.
* `IRenderer.ts` — método opcional `present?()`.
* `PageOverlayView.ts` — chamadas a `renderer.present?.()` após desenhar o *tail*.

### Observações

* Sem o patch de 0.6.4, o erro interrompia o `flushFrame()`, então o `flush()` nunca chegava a rodar em alguns frames.

---

## 0.6.1 — WebGL **sem fallback** + ajustes de latência (2025-08-14)

> **Resultado:** confirmou que WebGL estava realmente em uso; **latência** não melhorou perceptivelmente no iPad.

### Changed

* **Removido fallback** para Canvas2D quando o modo nas *settings* é “WebGL”: se falhar, falha visível (para depuração), sem cair para 2D silenciosamente.
* **DPR no overlay:** no iOS usamos `dpr = 1` para reduzir custo de GPU/CPU; em Desktop limitamos a `min(2, devicePixelRatio)`.

### Added

* Suporte a `pointerrawupdate` (onde disponível) em paralelo ao `pointermove` para reduzir *jitter* (opcional, não é fallback).
* `will-change: contents` nos canvases para dar pista ao compositor.
* Z-index do overlay aumentado para `2147483647` para garantir topo absoluto.

### Files

* `InkController.ts` — caminho “forçado SEM fallback” ao escolher *settings* `webgl`.
* `PageOverlayView.ts` — cálculo de DPR (iOS=1, Desktop<=2), *event wiring* `pointerrawupdate`.
* `styles.css` — `will-change` no canvas e overlay, ajustes de z-index.

### Observações

* **Latência no iPad**: reduzir DPR para 1 **não trouxe melhora sensível** no seu teste. GPU do M1 é usada, mas a geração de geometria por segmento ainda é feita no JS — gargalo principal em dispositivos móveis.

---

## 0.6.0 — Ponto de partida desta rodada (2025-08-14)

### Estado inicial

* Em **auto**, o desenho funcionava (Canvas2D no iPad por padrão; WebGL composite2D no Desktop).
* Em **WebGL** (forçado), a ferramenta “parecia não ativar” no iPad e Desktop; no Desktop os traços apareciam só ao finalizar (ou nem isso em alguns casos). Sidecar era criado (ou seja, pontos eram coletados).
* Sintomas extra:

  * Dava para fazer **pan com o stylus** quando deveria estar desenhando (mapeado à configuração de `pointer-events` e `touch-action`).
  * **Preview** não aparecia durante o desenho (root cause descoberto depois: *binding* perdido de `drawStrokeTail`).

### Infra/Arquitetura preexistente

* `PageOverlayView` com dois caminhos: **Canvas2D** e **WebGL DOM**.
* `WebGLRenderer` com trilhas trianguladas por segmento; *blend* com `SRC_ALPHA/ONE_MINUS_SRC_ALPHA` (borracha emula `destination-out`).
* Virtualização de páginas (+ overlay por página), *palm rejection*, *two-finger double tap → undo*.

---

## Diário de tentativas (o que **não** funcionou e o que funcionou)

### Não funcionou

* **Somente `gl.flush()`/`present()`** após cada `drawArrays`: sem efeito *enquanto* o erro de binding abortava o frame.
* **`preserveDrawingBuffer: true`** por si só: idem.
* **Re-render da base** a cada `pointermove` (fallback temporário): também inócuo, porque o erro interrompia antes de apresentar.
* **Ajuste de DPR (iOS=1)**: não trouxe melhora percebida de latência no iPad Air 5 (M1) nos seus testes.

### Funcionou

* **Corrigir binding de `drawStrokeTail`** (chamar como método no renderer).
  Resultado: preview imediato voltou (Desktop+iPad).
* **Forçar WebGL sem fallback** no modo `webgl` das *settings*.
  Resultado: confirmação inequívoca de que WebGL está ativo; diagnóstico mais confiável.
* **Z-index alto + pointer/touch-action corretos** no overlay.
  Resultado: sem “sumiço” do overlay e sem pan do viewer quando desenhando.

---

## Conhecidos/Próximos passos

* **Latência no iPad (M1)**: com o preview restaurado, dá para medir/ajustar de forma cirúrgica:

  * (Opcional) tentar **coalescer menos segmentos** por frame (heurística de *throttling* de geometria em `pointermove`);
  * (Opcional) **simplificação incremental** da strip (mesclar segmentos colineares antes de mandar para o VBO);
  * (Opcional) testar `gl.finish()` (cautela: pode **aumentar** latência total) apenas para confirmar comportamento no WebKit;
  * (Opcional) **WebGL2** quando disponível (VBO dinâmico com `bufferSubData` e *orphaning*).

---

## Créditos de arquivos alterados nesta sequência

* `main/src/ui/PageOverlayView.ts`
* `main/src/render/WebGLRenderer.ts`
* `main/src/render/IRenderer.ts`
* `styles.css`
* (infra já existente: `InkController.ts`, `ToolbarView.ts`, etc., mas sem mudanças funcionais após 0.6.1)

---

Se quiser, eu já preparo o bump para **0.6.5** com uma flag de telemetria leve (mostrar no chip `persistent: true/false` também no iPad) e um *toggle* de “Throttle de segmentos” para testarmos a latência sem mudar mais nada no pipeline.


--- 
## 0.5.4 — 2025-08-12
### Fix crítico: crash ao abrir/renderizar PDF
- **Root cause:** `setTool()` era chamado para overlays **antes do `mount()`**, e `updatePointerEvents()` acessava `this.canvas.style`/`this.layerEl.style`, que ainda não existiam.
- **Correção:** `updatePointerEvents()` agora é **tolerante a pré-mount** (no-op se `canvas/layerEl` não existem). Após o `mount()`, o estado pendente é aplicado.
- Hardening adicional: vários métodos (`syncLayout`, `redrawAll`, `flushFrame`, handlers de toque) agora checam nulidade.

### Testes
- Abrir PDF pequeno e grande: sem erros no console.
- Alternar ferramenta (pen/eraser/pan) mesmo com páginas off-screen: OK.
- Zoom/pan intenso durante carregamento: sem crash; tinta permanece visível.

--- 

## 0.5.3 — 2025-08-12
### Correções de build (TypeScript)
- **ToolbarView**: refatorado o emitter para `Record<string, Listener[]>`, indexado por string. Corrige **TS2345** e **TS2488** no `push` e no `for..of`.
- Funcionalidade inalterada (botões, sliders, atalhos).

### Testes
- `npm run build` finaliza sem erros.

--- 

## 0.5.2 — 2025-08-12
### Correções de build (TypeScript)
- **ToolbarView**: emitter refatorado para usar `Partial<Record<...>>` com `Listener[]` interno, eliminando o erro **TS2322** em `??=`.
- **PageOverlayView** (0.5.1): já havia removido o union com `"pan"` no tipo de ferramenta; segue ok.

### Testes
- `npm run build` compila sem erros.
- Funcionalidades preservadas (ferramentas, undo/redo, salvar JSON, export flatten, palm rejection, zoom).

--- 

## 0.5.1 — 2025-08-12
### Correções de build (TypeScript)
- **PageOverlayView**: removida comparação de `ToolId` com `"pan"` (que não pertence ao union). Agora o overlay usa `currentToolId: "pen" | "eraser"` + `drawingEnabled: boolean` para o modo pan. Isso elimina o aviso TS2367.
- **ToolbarView**: refatorado o mini-emitter de eventos para tipagem segura das listas de listeners, corrigindo TS2339/TS7006.

### Testes
- `npm run build` compila sem erros.
- Comportamento preservado: caneta/borracha, pan com dedo, palm rejection, undo/redo, salvar JSON, export flatten.

--- 

## 0.5.0 — 2025-08-12
### Arquitetura: Renderer + Tools + Controller
- Separação em módulos:
  - **Renderer** (`Canvas2DRenderer`) responsável por desenhar traços e páginas (Canvas 2D).
  - **Tools** (`PenTool`, `EraserTool`, `ToolRegistry`) para criar `Stroke`s a partir das configs ativas.
  - **Controller** (`InkController`) orquestra ferramenta ativa, toolbar, overlays, sidecar e export.
- `PageOverlayView` ficou fina: captura pointer, delega para Tool/Renderer e persiste via `DocumentSession`.
- Comportamento preservado: caneta/borracha, undo/redo por página, autosave sidecar, export flatten, palm-rejection e sincronismo com zoom.

### Testes rápidos
- Desktop/iPad: desenhar, apagar, undo/redo, salvar JSON, exportar flatten — OK.
- Zoom rápido/lento: tinta permanece.
- Toque: pan/pinch com ferramenta ativa; caneta desenha; palma ignorada.

---

## 0.4.6 — 2025-08-12
### Correções
- **TS errors** no build: implementados `requestUndo()` e `requestRedo()` em `PageOverlay`.
- **Undo/Redo por página** no `InkingManager`, com pilha de **redo** e limpeza automática do redo ao iniciar um novo traço.

### Testes
- Desktop: Undo (Ctrl/Cmd+Z) e Redo (Shift+Ctrl/Cmd+Z) por página; botões da toolbar funcionam.
- iPad: desenhar, desfazer e refazer na página corrente OK.

### Observações
- Undo/Redo atua no escopo da **página ativa** (a com maior área visível).

---

## 0.4.5 — 2025-08-12
### Toque vs. Caneta (tablet)
- **Pan/Pinch com dedo funcionando** mesmo com a ferramenta de desenho ligada.
- **Palm rejection real**: enquanto a caneta está encostada, toques são ignorados; ao levantar a caneta, dedo volta a pan/pinch.
- **Dedos nunca desenham** (apenas caneta/mouse).

### Implementação
- `touch-action: pan-x pan-y pinch-zoom` no overlay/canvas.
- Redirecionamento de toques para o viewer durante o gesto (desliga `pointer-events` do canvas temporariamente).
- Handlers globais `touchstart/move` (captura) para bloquear palma **só** quando a caneta está em contato.

### Testes
- iPad + Apple Pencil:
  - **Ferramenta ligada**: caneta desenha; dedo arrasta/zoom; palma não puxa a página.
  - **Ferramenta desligada**: caneta e dedo fazem pan; pinch-zoom ok.
- Desktop: sem mudanças comportamentais.

---

## 0.4.4 — 2025-08-12
### Ajuste de pan com dedo
- Corrigido caso em que o pan por toque ficava bloqueado com a ferramenta de desenho ativa.
- Mantido bloqueio apenas para **caneta** durante o traço (palm rejection parcial nesta versão).

### Testes
- iPad: dedo volta a pan/zoom com ferramenta ligada.

---

## 0.4.3 — 2025-08-12
### Melhorias para Apple Pencil / Stylus
- **Traço mais grosso com stylus**: multiplicador dedicado e **largura mínima = valor do slider** (evita traço “quase invisível”).
- Cada traço agora grava `device: "pen" | "mouse" | "touch"`; renderer e export respeitam isso.

### Testes
- iPad: espessura perceptível em todo o range do slider; mouse mantém comportamento anterior.

---

## 0.4.2 — 2025-08-12
### Zoom & Render
- Corrigido desaparecimento intermitente da tinta após zoom/re-render do PDF.js:
  - Overlay acompanha **transform** da `canvasWrapper/textLayer`.
  - **`ensureOnTop()`** mantém a camada de tinta como último filho da página (z-index).
  - **ResizeObserver + MutationObserver** para re-sync em mudanças do viewer.
  - Render double-buffer (`inkCanvas` + `canvas` live) para evitar flicker.
- **Espessura estável** com zoom: traços usam `refW/refH` e reescala coerente.

### Persistência
- **Substituído** o método de salvar no PDF por:
  - **Autosave (sidecar JSON)** e
  - **Botão “Salvar” (sidecar JSON)**.
- **Exportar “Flatten”**: gera **cópia** do PDF com a tinta embutida por página (via `pdf-lib`) sem alterar o original.

### Testes
- Zoom lento/rápido; alternar páginas; rotação; re-render do PDF.js — desenhos permanecem.
- Export flatten preserva cor, opacidade e espessura.

### O que deu errado (removido)
- Tentativa inicial de **salvar diretamente como anotação PDF** gerou erro (`UnexpectedObjectTypeError`); adotado sidecar + export flatten.

---

## 0.4.1 — 2025-08-12
### Toolbar & UX
- Toolbar integrada ao **lado direito** da barra nativa do leitor:
  - **Caneta**, **Borracha**, **Cor**, **Espessura**, **Opacidade**, **Undo/Redo**, **Salvar (JSON)**, **Exportar (flatten)**.
- **Opacidade**: controle **apenas na toolbar** (removido dos Settings).
- **Toggle de ferramenta** estável (ativar/desativar caneta; borracha troca corretamente; salvar clicável mesmo após desenhar).

### Persistência & Pastas
- **Configuração da pasta de sidecars** e **estratégias**:
  - **mirror** (espelha estrutura do vault sob uma raiz, ex.: `PDF Ink/...`),
  - **flat** (pasta única, com hash no nome para colisões),
  - **sibling** (ao lado do PDF; modo legado).
- **Autosave** com debounce; **Salvar** manual disponível.

### Testes
- Desktop: “Caneta” → desenhar → “Salvar” → OK; “Caneta” de novo → desativa.
- iPad: slider de opacidade visível na toolbar; funciona.

---

## 0.4.0 — 2025-08-12
### Primeira entrega funcional
- Overlay de desenho por **página**, com **virtualização** (reúso de canvases para PDFs grandes).
- Ferramentas iniciais: **Caneta** e **Borracha**; **Cor** e **Espessura** (slider).
- Integração mínima com o viewer: overlay sincroniza **pan/zoom**; eventos básicos de pointer.
- Persistência **sidecar JSON** (1 arquivo por PDF), carregado na abertura do documento.
- **Exportar “Flatten”** disponível para gerar uma cópia com a tinta aplicada.

### Testes
- PDFs pequenos e médios; mouse + iPad; abrir/fechar arquivo e Obsidian preserva anotações.

### Problemas conhecidos (na época)
- Em algumas sequências de zoom rápido, a tinta podia “sumir” até o próximo sync (resolvido na 0.4.2).
- Ícones da toolbar ainda genéricos (melhorados na 0.4.1).

---

## Roadmap (próximos passos sugeridos)
- **Highlighter** (marca-texto) com blend *multiply* + cor dedicada.
- **Atalhos na Command Palette** (toggle ferramenta, salvar, exportar, undo/redo).
- **Smoothing avançado** (RDP + curvas) para traços longos.
- **Migrador de sidecars** (mirror ⇄ flat ⇄ sibling) com relatório.
- **Ajuste de “pen width boost”** nos Settings (1.0–3.0).
- **Renderer WebGL** opcional para traços super suaves em iPad.

---
