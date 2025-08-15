import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { InkController } from "./InkController";
import { PdfDomAdapter } from "../pdf/PdfDomAdapter";
import { DocumentSession } from "../core/DocumentSession";
import { SidecarStore } from "../storage/SidecarStore";
import { MirrorStrategy } from "../storage/strategies/MirrorStrategy";
import { FlatStrategy } from "../storage/strategies/FlatStrategy";
import { SiblingStrategy } from "../storage/strategies/SiblingStrategy";
import { FlattenExporter } from "../export/FlattenExporter";

export type SidecarStrategy = "mirror" | "flat" | "sibling";

export interface Settings {
  onlyPenDraws: boolean;
  penColor: string;
  penSize: number;
  penOpacity: number; // 0..1
  velocityAffectsSize: boolean;
  enableTiltDynamics: boolean;
  doubleTapUndo: boolean;

  sidecarDir: string;          // raiz usada em mirror/flat
  sidecarStrategy: SidecarStrategy;
}

export const DEFAULT_SETTINGS: Settings = {
  onlyPenDraws: true,
  penColor: "#ff2d55",
  penSize: 3,
  penOpacity: 1,
  velocityAffectsSize: true,
  enableTiltDynamics: true,
  doubleTapUndo: true,
  sidecarDir: "",
  sidecarStrategy: "mirror",
};

export class PdfInkApp {
  constructor(
    public app: App,
    public plugin: Plugin & { settings: Settings; saveSettings: () => Promise<void> },
    public file: TFile
  ) {}

  controller!: InkController;

  async init() {
    const view: any = (this.app.workspace.activeLeaf as any)?.view;
    const contentEl: HTMLElement = (view?.contentEl ?? view?.containerEl) as HTMLElement;
    if (!contentEl) throw new Error("View content não encontrado.");

    const pdf = new PdfDomAdapter(contentEl);
    const session = new DocumentSession(this.plugin.settings);
    const store = new SidecarStore(
      this.strategyFor(this.plugin.settings.sidecarStrategy, this.plugin.settings.sidecarDir),
      this.app.vault.adapter
    );
    const exporter = new FlattenExporter();

    this.controller = new InkController({
      app: this.app,
      settings: this.plugin.settings,
      file: this.file,
      pdf,
      session,
      store,
      exporter,
      onRequestSaveSettings: async () => this.plugin.saveSettings(),
    });

    await this.controller.mount();
  }

  destroy() {
    this.controller?.destroy();
  }

  private strategyFor(kind: SidecarStrategy, sidecarDir: string) {
    const root = (sidecarDir || "").trim();
    if (kind === "sibling" || !root) return new SiblingStrategy();
    if (kind === "mirror") return new MirrorStrategy(normalizePath(root));
    return new FlatStrategy(normalizePath(root));
  }
}

/* ------------------- Settings Tab (somente necessárias) ------------------- */

export class PdfInkSettingTab extends PluginSettingTab {
  plugin: Plugin & { settings: Settings; saveSettings: () => Promise<void> };
  constructor(app: App, plugin: any) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PDF Ink – Configurações" });

    new Setting(containerEl)
      .setName("Estratégia de salvamento")
      .setDesc("Onde salvar os .ink.json")
      .addDropdown(d => {
        d.addOption("mirror", "Espelhar estrutura do vault (padrão)");
        d.addOption("flat", "Pasta única (flat)");
        d.addOption("sibling", "Ao lado do PDF (legado)");
        d.setValue(this.plugin.settings.sidecarStrategy || "mirror");
        d.onChange(async (v: any) => {
          this.plugin.settings.sidecarStrategy = v;
          await this.plugin.saveSettings(); this.display();
        });
      });

    const dirSetting = new Setting(containerEl)
      .setName("Pasta raiz para sidecars")
      .setDesc("Usada nos modos 'Espelhar' e 'Pasta única'. Ex.: PDF Ink")
      .addText(t => t
        .setPlaceholder("PDF Ink")
        .setValue(this.plugin.settings.sidecarDir || "")
        .onChange(async (v) => { this.plugin.settings.sidecarDir = v.trim(); await this.plugin.saveSettings(); })
      );

    const isSibling = (this.plugin.settings.sidecarStrategy === "sibling");
    dirSetting.settingEl.toggleClass("mod-disabled", isSibling);
    (dirSetting.settingEl.querySelector("input") as HTMLInputElement | null)?.toggleAttribute("disabled", isSibling);
  }
}
