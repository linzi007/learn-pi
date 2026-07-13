import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const NOTE_CONTENT = "研究结论：嵌入式宿主应显式提供运行依赖。\n风险：不要启用写入工具。\n";
const AGENTS_CONTENT = "# 研究助手\n只读取项目笔记，不修改项目文件。\n";
const SKILL_CONTENT =
	"---\nname: fixture-research\ndescription: 读取项目笔记并给出简短研究结论。\n---\n先使用 read 查看 project-notes.md。\n";
export const FINAL_RESPONSE = "研究完成：已读取项目笔记，宿主只提供了可审计的只读能力。";
export type LessonOutput = { writeLine(text: string): void };
type Fixture = { cwd: string; agentDir: string; agentsPath: string; skillPath: string; notePath: string };
export interface EmbeddedHarness {
	session: AgentSession;
	resourceLoader: DefaultResourceLoader;
	auditLog: string[];
	fixture: Fixture;
	requestTranscripts: string[][];
	getModelCallCount(): number;
	dispose(): Promise<void>;
}
export interface ResearchObservation {
	activeToolNames: string[];
	loadedAgents: string[];
	loadedSkills: string[];
	auditLog: string[];
	auditedReadResult: string;
	finalText: string;
	sessionIsInMemory: boolean;
	resourcesStayInFixture: boolean;
	noteUnchanged: boolean;
	modelCallCount: number;
}
const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("");
}
function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null || !("content" in message)) return "";
	return contentText(message.content);
}
async function createFixture(): Promise<Fixture> {
	const cwd = await mkdtemp(join(tmpdir(), "learn-pi-s12-"));
	const agentDir = join(cwd, ".agent");
	const agentsPath = join(cwd, "AGENTS.md");
	const skillPath = join(cwd, "skills", "fixture-research", "SKILL.md");
	const notePath = join(cwd, "project-notes.md");
	await mkdir(join(cwd, "skills", "fixture-research"), { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await Promise.all([
		writeFile(agentsPath, AGENTS_CONTENT),
		writeFile(skillPath, SKILL_CONTENT),
		writeFile(notePath, NOTE_CONTENT),
	]);
	return { cwd, agentDir, agentsPath, skillPath, notePath };
}
function createAuditExtension(auditLog: string[]): ExtensionFactory {
	return (pi) => {
		pi.on("session_start", () => {
			auditLog.push("extension:session_start");
		});
		pi.on("agent_start", () => {
			auditLog.push("extension:agent_start");
		});
		pi.on("tool_call", (event) => {
			auditLog.push(`extension:tool_call:${event.toolName}`);
		});
		pi.on("tool_result", (event) => {
			auditLog.push(`extension:tool_result:${event.toolName}`);
			if (event.toolName !== "read") return;
			return { content: [{ type: "text" as const, text: `[审计] ${contentText(event.content)}` }] };
		});
		pi.on("agent_end", () => {
			auditLog.push("extension:agent_end");
		});
	};
}
function defaultResponses() {
	return [
		fauxAssistantMessage(fauxToolCall("read", { path: "project-notes.md", limit: 20 }, { id: "read-notes" })),
		fauxAssistantMessage(FINAL_RESPONSE),
	];
}
export async function createEmbeddedResearchHarness(): Promise<EmbeddedHarness> {
	// 宿主只装配依赖，Pi SDK 负责实际连接。
	const fixture = await createFixture();
	const auditLog: string[] = [];
	const faux = fauxProvider({
		api: "learn-pi-s12-fixture",
		provider: "learn-pi-s12-fixture",
		models: [{ id: "learn-pi-s12-fixture", name: "Learn Pi Embedded Harness" }],
		tokenSize: { min: 1, max: 1 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(defaultResponses());
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "fixture-token");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const sourceModel = faux.getModel();
	const requestTranscripts: string[][] = [];
	modelRegistry.registerProvider(sourceModel.provider, {
		api: sourceModel.api,
		baseUrl: sourceModel.baseUrl,
		apiKey: "fixture-token",
		streamSimple: (model, context, streamOptions) => {
			requestTranscripts.push(context.messages.map(messageText));
			return models.streamSimple(model, context, streamOptions);
		},
		models: [
			{
				id: sourceModel.id,
				name: sourceModel.name,
				api: sourceModel.api,
				baseUrl: sourceModel.baseUrl,
				reasoning: sourceModel.reasoning,
				input: sourceModel.input,
				cost: sourceModel.cost,
				contextWindow: sourceModel.contextWindow,
				maxTokens: sourceModel.maxTokens,
			},
		],
	});
	try {
		const model = modelRegistry.find(sourceModel.provider, sourceModel.id);
		if (!model) throw new Error("离线模型未进入内存模型目录。");
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
		const resourceLoader = new DefaultResourceLoader({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			settingsManager,
			additionalSkillPaths: [fixture.skillPath],
			extensionFactories: [{ name: "audit", factory: createAuditExtension(auditLog) }],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			agentsFilesOverride: (base) => ({
				agentsFiles: base.agentsFiles.filter((file) => file.path === fixture.agentsPath),
			}),
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			model,
			thinkingLevel: "off",
			authStorage,
			modelRegistry,
			sessionManager: SessionManager.inMemory(fixture.cwd),
			settingsManager,
			resourceLoader,
			tools: READ_ONLY_TOOLS,
		});
		await session.bindExtensions({ mode: "print" });
		let disposed = false;
		return {
			session,
			resourceLoader,
			auditLog,
			fixture,
			requestTranscripts,
			getModelCallCount: () => faux.state.callCount,
			async dispose() {
				if (disposed) return;
				disposed = true;
				session.dispose();
				modelRegistry.unregisterProvider(sourceModel.provider);
				await rm(fixture.cwd, { recursive: true, force: true });
			},
		};
	} catch (error) {
		modelRegistry.unregisterProvider(sourceModel.provider);
		await rm(fixture.cwd, { recursive: true, force: true });
		throw error;
	}
}
export async function runEmbeddedResearch(output: LessonOutput = consoleOutput): Promise<ResearchObservation> {
	const harness = await createEmbeddedResearchHarness();
	try {
		const { session, resourceLoader } = harness;
		const loadedAgents = resourceLoader.getAgentsFiles().agentsFiles.map((file) => basename(file.path));
		const loadedSkills = resourceLoader.getSkills().skills.map((skill) => skill.name);
		output.writeLine("[步骤 1/5] 创建临时项目：只放入一份 AGENTS、一个 Skill 和一份研究笔记。");
		output.writeLine("[步骤 2/5] 宿主注入内存认证、模型目录、会话和资源加载器；不读取用户配置。");
		output.writeLine(`[步骤 3/5] SDK 只启用只读工具：${session.getActiveToolNames().join(", ")}；并绑定审计扩展。`);
		output.writeLine("[步骤 4/5] 离线模型请求 read；Pi 执行真实只读工具，扩展为结果加上审计标记。");
		await session.prompt("请读取 project-notes.md，并简短说明宿主提供了什么能力。");
		await session.waitForIdle();
		const auditedReadResult = messageText(session.messages.find((message) => message.role === "toolResult"));
		const finalText = messageText([...session.messages].reverse().find((message) => message.role === "assistant"));
		const resourcePaths = [
			...resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.path),
			...resourceLoader.getSkills().skills.map((skill) => skill.filePath),
		];
		const observation = {
			activeToolNames: session.getActiveToolNames(),
			loadedAgents,
			loadedSkills,
			auditLog: [...harness.auditLog],
			auditedReadResult,
			finalText,
			sessionIsInMemory: session.sessionFile === undefined,
			resourcesStayInFixture: resourcePaths.every((path) => path.startsWith(harness.fixture.cwd)),
			noteUnchanged: (await readFile(harness.fixture.notePath, "utf8")) === NOTE_CONTENT,
			modelCallCount: harness.getModelCallCount(),
		};
		output.writeLine("[步骤 5/5] 验证：资源和 Skill 已进入系统提示，read 结果经过扩展审计，内存会话随后释放。");
		output.writeLine(`资源: ${loadedAgents.join(", ")}；Skill: ${loadedSkills.join(", ")}`);
		output.writeLine(`审计: ${observation.auditLog.join(" -> ")}`);
		output.writeLine(`最终回复: ${finalText}`);
		return observation;
	} finally {
		await harness.dispose();
	}
}
export async function runLesson(): Promise<ResearchObservation | undefined> {
	try {
		return await runEmbeddedResearch();
	} catch {
		console.error("嵌入式演示未完成。请检查本地依赖安装是否完整。");
		process.exitCode = 1;
		return undefined;
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
