import { Plugin, Notice, TFile, App } from "obsidian";
import { PdfInkApp, DEFAULT_SETTINGS, Settings, PdfInkSettingTab } from "./app/PdfInkApp";

export default class PdfInkPlugin extends Plugin {
  settings: Settings;
  appLayer: PdfInkApp | null = null;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new PdfInkSettingTab(this.app, this));

    const attach = () => this.attachIfPdf(this.app);
    this.app.workspace.onLayoutReady(attach);
    this.registerEvent(this.app.workspace.on("active-leaf-change", attach));
    this.registerEvent(this.app.workspace.on("file-open", attach));
    attach();
  }

  onunload() {
    this.appLayer?.destroy();
    this.appLayer = null;
  }

  async saveSettings() { await this.saveData(this.settings); }

  private attachIfPdf(app: App) {
    const leaf = app.workspace.activeLeaf;
    const file = (leaf?.view as any)?.file as TFile | undefined;

    if (!leaf || !file || file.extension?.toLowerCase() !== "pdf") {
      this.appLayer?.destroy();
      this.appLayer = null;
      return;
    }
    if (this.appLayer && this.appLayer.file?.path === file.path) return;

    this.appLayer?.destroy();
    this.appLayer = new PdfInkApp(app, this, file);
    this.appLayer.init().catch(err => new Notice("PDF Ink: erro ao iniciar: " + err));
  }
}