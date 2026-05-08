import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { discoverSkills, type LoadedSkill, type SkillScope } from "../../features/opencode-skill-loader"
import type { SkillCatalogArgs, SkillInfo } from "./types"

const SCOPES: SkillScope[] = ["builtin", "config", "user", "project", "opencode", "opencode-project"]

function info(skill: LoadedSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.definition.description || "",
    location: skill.path,
    scope: skill.scope,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
  }
}

function matches(skill: SkillInfo, query: string): boolean {
  const lower = query.toLowerCase()
  return [
    skill.name,
    skill.description,
    skill.scope,
    skill.compatibility,
    skill.location,
    ...(skill.allowedTools ?? []),
  ]
    .filter((item): item is string => Boolean(item))
    .some((item) => item.toLowerCase().includes(lower))
}

function format(skills: SkillInfo[]): string {
  if (skills.length === 0) return "No matching skills found."

  return [
    "## Available Skills",
    "",
    ...skills.map((skill) =>
      [
        `### ${skill.name}`,
        `- scope: ${skill.scope}`,
        skill.location ? `- location: ${skill.location}` : undefined,
        skill.compatibility ? `- compatibility: ${skill.compatibility}` : undefined,
        skill.allowedTools?.length ? `- allowed_tools: ${skill.allowedTools.join(", ")}` : undefined,
        `- description: ${skill.description || "(no description)"}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    ),
  ].join("\n\n")
}

export function createSkillCatalogTool(options: { skills?: LoadedSkill[]; opencodeOnly?: boolean } = {}): ToolDefinition {
  return tool({
    description:
      "List and search the current realtime Skill catalog, including builtin, configured, user, project, Claude Code, and OpenCode skills. Use this before choosing a skill when the best match is not obvious or may come from user-installed skills.",
    args: {
      query: tool.schema.string().optional().describe("Optional keyword search across skill names and descriptions"),
      scope: tool.schema.enum(SCOPES).optional().describe("Optional scope filter"),
      limit: tool.schema.number().optional().describe("Maximum skills to return (default 30)"),
    },
    execute: async (args: SkillCatalogArgs) => {
      const loaded = options.skills ?? (await discoverSkills({ includeClaudeCodePaths: !options.opencodeOnly }))
      const query = args.query?.trim()
      const limit = args.limit && args.limit > 0 ? args.limit : 30
      const skills = loaded
        .map(info)
        .filter((skill) => !args.scope || skill.scope === args.scope)
        .filter((skill) => !query || matches(skill, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit)

      return format(skills)
    },
  })
}
