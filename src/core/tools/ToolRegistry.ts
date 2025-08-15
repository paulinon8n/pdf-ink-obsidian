import type { Tool, ToolId } from "./Tool";

export class ToolRegistry {
  private tools = new Map<ToolId, Tool>();
  private current: ToolId = "pen";

  register(tool: Tool) { this.tools.set(tool.id, tool); }
  get(id: ToolId): Tool | undefined { return this.tools.get(id); }

  setActive(id: ToolId) { this.current = id; }
  activeId(): ToolId { return this.current; }
  active(): Tool | undefined { return this.tools.get(this.current); }
}