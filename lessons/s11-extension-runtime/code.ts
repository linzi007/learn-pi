import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AuthStorage,
	discoverAndLoadExtensions,
	type ExtensionError,
	ExtensionRunner,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const TRACE_KEY = "__learnPiS11Trace";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface ExtensionObservation {
	eventTrace: string[];
	blockReason?: string;
	diagnostics: Array<{ event: string; error: string }>;
	loadedExtensionCount: number;
}

interface Fixture {
	root: string;
	cwd: string;
	agentDir: string;
	extensionPath: string;
}

const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };

function traceStore(): string[] {
	const host = globalThis as typeof globalThis & { [TRACE_KEY]?: string[] };
	const existing = host[TRACE_KEY];
	if (existing) return existing;
	const trace: string[] = [];
	host[TRACE_KEY] = trace;
	return trace;
}

// 扩展文件是隔离测试夹具；它只登记事件处理器，不读取用户机器上的 Pi 扩展目录。
const INLINE_EXTENSION_SOURCE = `
const trace = () => (globalThis.__learnPiS11Trace ??= []);

export default function auditExtension(pi) {
  pi.on("agent_start", () => {
    trace().push("agent_start");
  });
  pi.on("tool_call", (event) => {
    trace().push("tool_call:" + event.toolName);
    if (event.toolName === "bash" && event.input.command.includes("rm -rf")) {
      return { block: true, reason: "教学策略：禁止破坏性 bash 命令" };
    }
  });
  pi.on("agent_end", () => {
    trace().push("agent_end");
    throw new Error("教学扩展的故意失败");
  });
}
`;

async function createFixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "learn-pi-s11-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent-config");
	const extensionPath = join(root, "audit-extension.mjs");
	await writeFile(extensionPath, INLINE_EXTENSION_SOURCE, "utf8");
	return { root, cwd, agentDir, extensionPath };
}

function toDiagnostic(error: ExtensionError): { event: string; error: string } {
	return { event: error.event, error: error.error };
}

/**
 * 通过公开的 discoverAndLoadExtensions() 装载一个 inline extension，再由 ExtensionRunner 统一分发事件。
 * 这里不启动 Agent 或模型：课程只验证扩展注册、拦截和错误隔离这条运行时边界。
 */
export async function runLesson(output: LessonOutput = consoleOutput): Promise<ExtensionObservation> {
	traceStore().length = 0;
	const fixture = await createFixture();
	try {
		output.writeLine("[步骤 1/4] 在临时目录加载 inline extension，不读取用户扩展或全局配置。");
		const loaded = await discoverAndLoadExtensions([fixture.extensionPath], fixture.cwd, fixture.agentDir);
		const sessionManager = SessionManager.inMemory(fixture.cwd);
		const modelRegistry = ModelRegistry.inMemory(AuthStorage.inMemory());
		const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, fixture.cwd, sessionManager, modelRegistry);
		const diagnostics: Array<{ event: string; error: string }> = [];
		runner.onError((error) => diagnostics.push(toDiagnostic(error)));

		output.writeLine("[步骤 2/4] runner 分发 agent_start：扩展只记录生命周期事件，不参与 Agent 状态归约。");
		await runner.emit({ type: "agent_start" });
		output.writeLine(`事件记录：${traceStore().join(" -> ")}`);

		output.writeLine("[步骤 3/4] runner 分发危险 bash 调用：扩展返回 block，工具不会进入执行阶段。");
		const toolResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "s11-dangerous-bash",
			toolName: "bash",
			input: { command: "rm -rf /tmp/learn-pi" },
		});
		output.writeLine(`拦截结果：${toolResult?.block ? toolResult.reason : "未拦截"}`);

		output.writeLine("[步骤 4/4] agent_end 处理器故意抛错：ExtensionRunner 捕获它并转成诊断，而不是让运行时崩溃。");
		await runner.emit({ type: "agent_end", messages: [] });
		output.writeLine(`诊断：${diagnostics.map((diagnostic) => `${diagnostic.event}:${diagnostic.error}`).join(" | ")}`);

		return {
			eventTrace: [...traceStore()],
			blockReason: toolResult?.reason,
			diagnostics,
			loadedExtensionCount: loaded.extensions.length,
		};
	} finally {
		// 扩展模块和其路径都只属于本次演示，避免产生可被下一次读取的本地状态。
		await rm(fixture.root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
