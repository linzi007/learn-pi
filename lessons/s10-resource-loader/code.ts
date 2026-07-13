import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	DefaultResourceLoader,
	formatSkillsForPrompt,
	loadProjectContextFiles,
	loadSkills,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface ResourceObservation {
	contextOrder: string[];
	skills: Array<{ name: string; scope: string | undefined }>;
	skillCollisionCount: number;
	badSkillDiagnosticCount: number;
	modelVisibleSkillNames: string[];
	prompts: Array<{ name: string; scope: string | undefined }>;
	promptCollisionCount: number;
	disabledCounts: { contexts: number; skills: number; prompts: number };
}

interface Fixture {
	root: string;
	agentDir: string;
	projectDir: string;
	cwd: string;
}

const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };

function writeStep(output: LessonOutput, step: number, text: string): void {
	output.writeLine(`[步骤 ${step}/4] ${text}`);
}

async function writeFixtureFile(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

// 临时目录是本课唯一的资源范围；agentDir 也是临时的，因此不会读取用户 Pi 配置或用户目录。
export async function createResourceFixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "learn-pi-s10-"));
	const agentDir = join(root, "agent-config");
	const projectDir = join(root, "workspace");
	const cwd = join(projectDir, "app");

	await Promise.all([
		writeFixtureFile(join(agentDir, "AGENTS.md"), "范围：全局\n"),
		writeFixtureFile(join(projectDir, "AGENTS.md"), "范围：父\n"),
		writeFixtureFile(join(cwd, "AGENTS.md"), "范围：子\n"),
		writeFixtureFile(
			join(agentDir, "skills", "inspect", "SKILL.md"),
			"---\nname: inspect\ndescription: 全局检查规则\n---\n全局技能内容\n",
		),
		writeFixtureFile(
			join(cwd, ".pi", "skills", "inspect", "SKILL.md"),
			"---\nname: inspect\ndescription: 项目同名检查规则\n---\n项目技能内容\n",
		),
		writeFixtureFile(
			join(cwd, ".pi", "skills", "manual", "SKILL.md"),
			"---\nname: manual\ndescription: 只能由用户显式调用\ndisable-model-invocation: true\n---\n手动技能内容\n",
		),
		writeFixtureFile(
			join(cwd, ".pi", "skills", "broken", "SKILL.md"),
			"---\nname: broken\ndescription: [\n---\n坏 frontmatter\n",
		),
		writeFixtureFile(join(agentDir, "prompts", "review.md"), "---\ndescription: 全局审查模板\n---\n请审查 $1。\n"),
		writeFixtureFile(
			join(cwd, ".pi", "prompts", "review.md"),
			"---\ndescription: 项目同名审查模板\n---\n请按项目规则审查 $1。\n",
		),
	]);
	return { root, agentDir, projectDir, cwd };
}

function scopeOf(resource: { sourceInfo?: { scope?: string } }): string | undefined {
	return resource.sourceInfo?.scope;
}

function contextLabel(content: string): string {
	return content.match(/范围：(全局|父|子)/)?.[1] ?? "未知";
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<ResourceObservation> {
	const fixture = await createResourceFixture();
	try {
		// loadProjectContextFiles 先读显式 agentDir，再把 cwd 的祖先文件按父到子排列。
		const contextFiles = loadProjectContextFiles({ cwd: fixture.cwd, agentDir: fixture.agentDir });
		const contextOrder = contextFiles.map((file) => contextLabel(file.content));
		writeStep(output, 1, "在临时项目范围内发现上下文文件：agentDir 优先，项目目录从父到子追加。");
		writeStep(output, 1, `上下文顺序：${contextOrder.join(" -> ")}`);

		// 默认 skills 先扫描 agentDir/skills，再扫描 cwd/.pi/skills；同名的第一个留下并形成 collision 诊断。
		const skillResult = loadSkills({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			skillPaths: [],
			includeDefaults: true,
		});
		const skills = skillResult.skills.map((skill) => ({ name: skill.name, scope: scopeOf(skill) }));
		const skillCollisionCount = skillResult.diagnostics.filter((diagnostic) => diagnostic.type === "collision").length;
		const badSkillDiagnosticCount = skillResult.diagnostics.filter(
			(diagnostic) => diagnostic.type === "warning",
		).length;
		const formattedSkills = formatSkillsForPrompt(skillResult.skills);
		const modelVisibleSkillNames = skillResult.skills
			.filter((skill) => formattedSkills.includes(`<name>${skill.name}</name>`))
			.map((skill) => skill.name);
		writeStep(output, 2, `技能加载：${skills.map((skill) => `${skill.name}(${skill.scope})`).join(" -> ")}`);
		writeStep(output, 2, `同名技能诊断 ${skillCollisionCount} 条；坏 frontmatter 诊断 ${badSkillDiagnosticCount} 条。`);
		writeStep(output, 2, `会写入系统提示的技能：${modelVisibleSkillNames.join(", ") || "(无)"}`);

		// Prompt loader 使用两个显式路径；同名 review 的第一个保留，第二个只进入 diagnostics。
		const promptLoader = new DefaultResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			settingsManager: SettingsManager.inMemory(),
			additionalPromptTemplatePaths: [join(fixture.agentDir, "prompts"), join(fixture.cwd, ".pi", "prompts")],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await promptLoader.reload();
		const promptResult = promptLoader.getPrompts();
		const prompts = promptResult.prompts.map((prompt) => ({ name: prompt.name, scope: scopeOf(prompt) }));
		const promptCollisionCount = promptResult.diagnostics.filter(
			(diagnostic) => diagnostic.type === "collision",
		).length;
		writeStep(output, 3, `提示词模板：${prompts.map((prompt) => `/${prompt.name}(${prompt.scope})`).join(" -> ")}`);
		writeStep(output, 3, `同名提示词诊断 ${promptCollisionCount} 条；第一个 review 保留。`);

		const disabledLoader = new DefaultResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await disabledLoader.reload();
		const disabledCounts = {
			contexts: disabledLoader.getAgentsFiles().agentsFiles.length,
			skills: disabledLoader.getSkills().skills.length,
			prompts: disabledLoader.getPrompts().prompts.length,
		};
		writeStep(
			output,
			4,
			`禁用默认上下文、技能和模板后：contexts=${disabledCounts.contexts}, skills=${disabledCounts.skills}, prompts=${disabledCounts.prompts}`,
		);
		writeStep(output, 4, "禁用的是默认发现；显式传入的临时路径仍可由调用方单独允许。");

		return {
			contextOrder,
			skills,
			skillCollisionCount,
			badSkillDiagnosticCount,
			modelVisibleSkillNames,
			prompts,
			promptCollisionCount,
			disabledCounts,
		};
	} finally {
		// 无论诊断还是加载异常，都删除临时项目；不会保留任何用户目录状态。
		await rm(fixture.root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
