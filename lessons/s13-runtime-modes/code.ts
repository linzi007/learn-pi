import { pathToFileURL } from "node:url";
import { InteractiveMode, parseArgs, runPrintMode, runRpcMode } from "@earendil-works/pi-coding-agent";

export type PiAppMode = "interactive" | "print" | "json" | "rpc";

export interface IoShape {
	stdinIsTTY: boolean;
	stdoutIsTTY: boolean;
}

export interface ModeScenario {
	label: string;
	argv: string[];
	io: IoShape;
}

export interface RuntimeModeDecision {
	label?: string;
	argv: string[];
	io: IoShape;
	appMode: PiAppMode;
	adapter: string;
	protocol: string;
	reason: string;
	messages: string[];
	fileArgs: string[];
	diagnostics: string[];
}

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface LessonResult {
	decisions: RuntimeModeDecision[];
	rpcFileDecision: RuntimeModeDecision;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

// 选择模式后，Pi 会进入不同的输入输出适配器；同一 Agent 能力因此服务终端、人类脚本或 RPC 客户端。
const ADAPTERS: Record<PiAppMode, { adapter: string; protocol: string }> = {
	interactive: { adapter: InteractiveMode.name, protocol: "终端组件树" },
	print: { adapter: `${runPrintMode.name}({ mode: "text" })`, protocol: "最终 assistant 文本" },
	json: { adapter: `${runPrintMode.name}({ mode: "json" })`, protocol: "Session header + AgentSessionEvent JSONL" },
	rpc: { adapter: runRpcMode.name, protocol: "命令、响应与事件 JSONL" },
};

const DEFAULT_MODE_SCENARIOS: ModeScenario[] = [
	{ label: "默认交互", argv: ["检查当前项目"], io: { stdinIsTTY: true, stdoutIsTTY: true } },
	{ label: "单次文本", argv: ["-p", "总结当前项目"], io: { stdinIsTTY: true, stdoutIsTTY: true } },
	{ label: "事件 JSON", argv: ["--mode", "json", "检查测试"], io: { stdinIsTTY: true, stdoutIsTTY: true } },
	{ label: "双向 RPC", argv: ["--mode", "rpc"], io: { stdinIsTTY: true, stdoutIsTTY: true } },
	{ label: "管道输入", argv: ["总结标准输入"], io: { stdinIsTTY: false, stdoutIsTTY: true } },
];

function formatArgv(argv: string[]): string {
	return argv.length > 0 ? argv.map((arg) => JSON.stringify(arg)).join(" ") : "(无参数)";
}

function selectAppMode(
	parsed: ReturnType<typeof parseArgs>,
	{ stdinIsTTY, stdoutIsTTY }: IoShape,
): { appMode: PiAppMode; reason: string } {
	// 这是 Pi 的短路优先级：显式协议先于 --print，非 TTY 再兜底为单次输出。
	if (parsed.mode === "rpc") return { appMode: "rpc", reason: "--mode rpc 显式选择" };
	if (parsed.mode === "json") return { appMode: "json", reason: "--mode json 显式选择" };
	if (parsed.print) return { appMode: "print", reason: "--print/-p 请求单次输出" };
	if (!stdinIsTTY) return { appMode: "print", reason: "stdin 不是 TTY" };
	if (!stdoutIsTTY) return { appMode: "print", reason: "stdout 不是 TTY" };
	return { appMode: "interactive", reason: "stdin/stdout 都是 TTY，且没有非交互标志" };
}

// parseArgs 是公开 API，负责保留 Pi 的参数语义；resolveAppMode 是内部实现，
// 所以课程只在这里表达可验证的优先级，不深度导入私有源码。
export function resolveRuntimeMode(argv: string[], io: IoShape, label?: string): RuntimeModeDecision {
	const parsed = parseArgs(argv);
	const { appMode, reason } = selectAppMode(parsed, io);
	const adapter = ADAPTERS[appMode];
	const diagnostics = parsed.diagnostics.map(
		(diagnostic) => `${diagnostic.type === "error" ? "Error" : "Warning"}: ${diagnostic.message}`,
	);
	if (appMode === "rpc" && parsed.fileArgs.length > 0) {
		diagnostics.push("Error: @file arguments are not supported in RPC mode");
	}

	return {
		label,
		argv: [...argv],
		io: { ...io },
		appMode,
		adapter: adapter.adapter,
		protocol: adapter.protocol,
		reason,
		messages: [...parsed.messages],
		fileArgs: [...parsed.fileArgs],
		diagnostics,
	};
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<LessonResult> {
	// 本课只观察“命令行和终端能力如何选模式”，不启动 AgentSessionRuntime 或模型请求。
	const decisions = DEFAULT_MODE_SCENARIOS.map((scenario) =>
		resolveRuntimeMode(scenario.argv, scenario.io, scenario.label),
	);

	output.writeLine("[步骤 1/3] 设置命令行参数和终端环境：本课不启动 AgentSessionRuntime。");
	output.writeLine("[步骤 2/3] 按上游优先级计算每个场景应选择的入口。");
	for (const decision of decisions) {
		output.writeLine(
			`${decision.label}: ${formatArgv(decision.argv)} -> ${decision.appMode} -> ${decision.adapter} -> ${decision.protocol}`,
		);
	}

	const rpcFileDecision = resolveRuntimeMode(
		["--mode", "rpc", "@prompt.md"],
		{ stdinIsTTY: true, stdoutIsTTY: true },
		"RPC 文件参数",
	);
	output.writeLine("[步骤 3/3] 观察 RPC 的输入边界：文件参数不能与 JSONL 标准输入混用。");
	output.writeLine(`边界检查: ${rpcFileDecision.diagnostics.join(" | ")}`);

	return { decisions, rpcFileDecision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
