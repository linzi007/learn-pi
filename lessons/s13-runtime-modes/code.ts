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
	if (parsed.mode === "rpc") return { appMode: "rpc", reason: "--mode rpc 显式选择" };
	if (parsed.mode === "json") return { appMode: "json", reason: "--mode json 显式选择" };
	if (parsed.print) return { appMode: "print", reason: "--print/-p 请求单次输出" };
	if (!stdinIsTTY) return { appMode: "print", reason: "stdin 不是 TTY" };
	if (!stdoutIsTTY) return { appMode: "print", reason: "stdout 不是 TTY" };
	return { appMode: "interactive", reason: "stdin/stdout 都是 TTY，且没有非交互标志" };
}

// Pi 的内部 resolveAppMode 没有公开导出；本课只保留同样的短路优先级。
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
	const decisions = DEFAULT_MODE_SCENARIOS.map((scenario) =>
		resolveRuntimeMode(scenario.argv, scenario.io, scenario.label),
	);

	output.writeLine("本课观察: argv 与 TTY 如何选择 adapter；不启动 AgentSessionRuntime。");
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
	output.writeLine(`边界检查: ${rpcFileDecision.diagnostics.join(" | ")}`);

	return { decisions, rpcFileDecision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
