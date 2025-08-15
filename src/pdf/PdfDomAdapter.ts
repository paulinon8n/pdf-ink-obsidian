export class PdfDomAdapter {
  constructor(public container: HTMLElement) {}

  get viewer(): HTMLElement {
    return (
      this.container.querySelector("#viewerContainer") ||
      this.container.querySelector(".pdfViewer") ||
      this.container.querySelector("#viewer") ||
      this.container.querySelector(".pdf-viewer") ||
      this.container.querySelector(".pdf-container") ||
      this.container.querySelector(".pdfjs-container") ||
      this.container
    ) as HTMLElement;
  }

  scrollRoot(): HTMLElement | null {
    return (
      this.viewer.closest('.pdfContainer') ||
      (this.container.querySelector('.view-content') as HTMLElement) ||
      this.viewer.parentElement
    );
  }

  findToolbarRight(): HTMLElement | null {
    return (
      this.container.querySelector('.pdf-toolbar-right') ||
      this.container.querySelector('#toolbarViewerRight') ||
      this.container.querySelector('.toolbarViewerRight')
    ) as HTMLElement | null;
  }

  /** Cria/garante um host para a toolbar à direita.
   *  Se uma barra nativa existir, integra nela; caso contrário, usa um host flutuante sem mexer no layout. */
  ensureToolbarRight(): HTMLElement {
    // 1) Tente integrar na barra nativa conhecida
    const toolbarRoot =
      (this.container.querySelector('.pdf-toolbar') as HTMLElement) ||
      (this.container.querySelector('#toolbarViewer') as HTMLElement) ||
      (this.container.querySelector('#toolbarContainer') as HTMLElement) ||
      (this.container.querySelector('.toolbar') as HTMLElement) ||
      null;

    if (toolbarRoot) {
      // Integra na barra nativa, com layout seguro
      toolbarRoot.classList.add('pdf-ink-flexbar');

      let rightHost = toolbarRoot.querySelector<HTMLElement>('.pdf-ink-right');
      if (rightHost) return rightHost;

      // Spacer garante “lado direito”
      let spacer = toolbarRoot.querySelector<HTMLElement>('.pdf-ink-spacer');
      if (!spacer) {
        spacer = document.createElement('div');
        spacer.className = 'pdf-ink-spacer';
        toolbarRoot.appendChild(spacer);
      }

      rightHost = document.createElement('div');
      rightHost.className = 'pdf-ink-right';
      toolbarRoot.appendChild(rightHost);
      return rightHost;
    }

    // 2) Fallback: host flutuante no container, sem alterar display/layout
    let floatHost = this.container.querySelector<HTMLElement>('.pdf-ink-right.pdf-ink-floating');
    if (floatHost) return floatHost;

    // Garante ancoragem absoluta sem quebrar fluxo
    const cs = getComputedStyle(this.container);
    if (cs.position === 'static') {
      (this.container.style as any).position = 'relative';
    }

    floatHost = document.createElement('div');
    floatHost.className = 'pdf-ink-right pdf-ink-floating';
    this.container.appendChild(floatHost);
    return floatHost;
  }

  allPages(): HTMLElement[] {
    return Array.from(this.viewer.querySelectorAll<HTMLElement>('.page, .pdf-page'));
  }

  pageAt(i: number): HTMLElement | undefined { return this.allPages()[i]; }

  indexForPage(pageEl: HTMLElement): number | null {
    const n = pageEl.getAttribute('data-page-number');
    if (n) return Number(n) - 1;
    const all = this.allPages();
    const idx = all.indexOf(pageEl);
    return idx >= 0 ? idx : null;
  }
}