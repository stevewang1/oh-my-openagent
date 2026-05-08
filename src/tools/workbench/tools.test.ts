import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { workbench } from "./tools"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { WorkbenchCheckpoint } from "./types"

const root = join(tmpdir(), `workbench-tool-test-${Date.now()}`)
const original = process.cwd()

const context = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  abort: new AbortController().signal,
} as ToolContext

function checkpoint(title: string, timestamp: string): WorkbenchCheckpoint {
  return {
    version: 1,
    source: "auto",
    timestamp,
    session_id: "session-1",
    title,
    status: "in_progress",
    active_skill: "super-workflow",
    used_skills: ["super-workflow"],
    stage: "验收标准已确定",
    decisions: ["受众是早期开发者"],
    rejected: ["不写成营销长文"],
    next_step: "生成大纲",
    memory_hint: ".opencode/memory/full/session-1.md",
  }
}

describe("workbench tool", () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true })
    mkdirSync(join(root, ".opencode", "workbench", "checkpoints"), { recursive: true })
    process.chdir(root)

    const first = checkpoint("产品发布文章", "2026-05-06T10:00:00.000Z")
    const second = checkpoint("产品发布文章", "2026-05-06T11:00:00.000Z")
    writeFileSync(join(root, ".opencode", "workbench", "checkpoints", "first.json"), JSON.stringify(first, null, 2))
    writeFileSync(join(root, ".opencode", "workbench", "checkpoints", "second.json"), JSON.stringify(second, null, 2))
    writeFileSync(join(root, ".opencode", "workbench", "latest.json"), JSON.stringify(second, null, 2))
  })

  afterEach(() => {
    process.chdir(original)
    rmSync(root, { recursive: true, force: true })
  })

  test("returns latest checkpoint details", async () => {
    // #when
    const result = await workbench.execute({ action: "latest" }, context)

    // #then
    expect(result).toContain("产品发布文章")
    expect(result).toContain("super-workflow")
    expect(result).toContain("生成大纲")
  })

  test("generates report from checkpoints", async () => {
    // #when
    const result = await workbench.execute({ action: "report", query: "产品" }, context)

    // #then
    expect(result).toContain("Report generated:")
    expect(result).toContain("Workbench Report")
    expect(result).toContain("受众是早期开发者")
    expect(result).toContain("不写成营销长文")
  })
})
