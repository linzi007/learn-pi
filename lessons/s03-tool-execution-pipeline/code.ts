import { pathToFileURL } from "node:url";
import {
	Agent,
	type AgentMessage,
	type AgentOptions,
	type AgentTool,
	type StreamFn,
	type ToolExecutionMode,
} from "@earendil-works/pi-agent-core";
import { type Api, type Model, Type } from "@earendil-works/pi-ai";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";

const DEFAULT_PROMPT = `请完成一次 Pi 工具管线演示，严格按下面三个回复阶段进行。

第一批：第一条 assistant 回复只能按这个 source order 调用两个工具，不要附加文本，也不要调用其他工具：
1. slow_lookup，参数 {"query":"Pi typed validation"}
2. fast_lookup，参数 {"query":"Pi typed validation"}

收到这两个 tool result 后，第二条 assistant 回复只能按这个 source order 调用两个工具：
1. serial_audit，参数 {"summary":"检查第一批的工具完成顺序"}
2. blocked_lookup，参数 {"target":"private://forbidden"}

收到第二批 tool result 后，第三条 assistant 回复只用一句中文总结结果，不要再调用工具。`;

const lookupParameters = Type.Object({ query: Type.String() });
const auditParameters = Type.Object({ summary: Type.String() });
const blockedParameters = Type.Object({ target: Type.String() });

export interface PipelineRuntime {
	agent: Agent;
	executionTrace: string[];
}

export interface PipelineRuntimeOptions {
	model: Model<Api>;
	streamFn: StreamFn;
	getApiKey?: AgentOptions["getApiKey"];
	toolExecution?: ToolExecutionMode;
	terminateAfterTools?: boolean;
}

export interface ToolEndRecord {
	id: string;
	name: string;
	isError: boolean;
	text: string;
	terminate: boolean;
}

export interface RunCodeOptions {
	runtime?: PipelineRuntime;
	prompt?: string;
	writeLine?: (line: string) => void;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function textFromAssistant(message: AgentMessage | undefined): string {
	if (message?.role !== "assistant") return "";
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function textFromToolResult(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function createLookupTool(
	name: "slow_lookup" | "fast_lookup",
	label: string,
	delayMs: number,
	executionTrace: string[],
): AgentTool<typeof lookupParameters, { query: string; delayMs: number }> {
	return {
		name,
		label,
		description: "返回一个确定性的查询结果。",
		parameters: lookupParameters,
		executionMode: "parallel",
		async execute(_toolCallId, parameters) {
			executionTrace.push(`execute:${name}:start`);
			await sleep(delayMs);
			executionTrace.push(`execute:${name}:end`);
			return {
				content: [{ type: "text", text: `${name} 找到 ${parameters.query}` }],
				details: { query: parameters.query, delayMs },
			};
		},
	};
}

/**
 * 本课的 Agent 装配点。默认运行会由 createAnthropicRuntime() 提供真实 Model；
 * 测试只在这里注入 faux stream，不改变工具、hook 或 Agent 的真实实现。
 */
export function createPipelineRuntime(options: PipelineRuntimeOptions): PipelineRuntime {
	const executionTrace: string[] = [];
	const slowLookup = createLookupTool("slow_lookup", "慢速查询", 30, executionTrace);
	const fastLookup = createLookupTool("fast_lookup", "快速查询", 1, executionTrace);
	const serialAudit: AgentTool<typeof auditParameters, { summary: string }> = {
		name: "serial_audit",
		label: "串行审计",
		description: "写入一条需要与同批工具串行执行的审计记录。",
		parameters: auditParameters,
		executionMode: "sequential",
		async execute(_toolCallId, parameters) {
			executionTrace.push("execute:serial_audit:start");
			await sleep(5);
			executionTrace.push("execute:serial_audit:end");
			return {
				content: [{ type: "text", text: `serial_audit 已记录：${parameters.summary}` }],
				details: { summary: parameters.summary },
			};
		},
	};
	const blockedLookup: AgentTool<typeof blockedParameters, { target: string }> = {
		name: "blocked_lookup",
		label: "受限查询",
		description: "演示 beforeToolCall 拦截的受限资源查询。",
		parameters: blockedParameters,
		async execute(_toolCallId, parameters) {
			executionTrace.push("execute:blocked_lookup:unexpected");
			return {
				content: [{ type: "text", text: `不应访问：${parameters.target}` }],
				details: { target: parameters.target },
			};
		},
	};

	const agent = new Agent({
		initialState: {
			systemPrompt: "你是一个严格遵守用户工具调用顺序的演示助手。",
			model: options.model,
			tools: [slowLookup, fastLookup, serialAudit, blockedLookup],
		},
		streamFn: options.streamFn,
		getApiKey: options.getApiKey,
		toolExecution: options.toolExecution ?? "parallel",
		beforeToolCall: async ({ toolCall }) => {
			executionTrace.push(`before:${toolCall.id}`);
			if (toolCall.name === "blocked_lookup") {
				return { block: true, reason: "演示策略：不允许读取 private:// 资源" };
			}
			return undefined;
		},
		afterToolCall: async ({ toolCall, result }) => {
			executionTrace.push(`after:${toolCall.id}`);
			return {
				content: [{ type: "text", text: `[已审计] ${textFromToolResult(result.content)}` }],
				terminate: options.terminateAfterTools ? true : undefined,
			};
		},
	});

	return { agent, executionTrace };
}

/** 默认运行路径：真实 Anthropic Provider，API key 只从环境变量读取。 */
export function createAnthropicRuntime(): PipelineRuntime {
	const runtime = createAnthropicCompatibleRuntime();

	return createPipelineRuntime({
		model: runtime.model,
		streamFn: (nextModel, context, streamOptions) => runtime.models.streamSimple(nextModel, context, streamOptions),
		getApiKey: () => runtime.apiKey,
	});
}

export async function runCode(options: RunCodeOptions = {}) {
	const writeLine = options.writeLine ?? console.log;
	const runtime = options.runtime ?? createAnthropicRuntime();
	const { agent, executionTrace } = runtime;
	const toolEnds: ToolEndRecord[] = [];
	const toolResultIds: string[] = [];

	const unsubscribe = agent.subscribe((event) => {
		if (event.type === "tool_execution_start") {
			writeLine(`开始: ${event.toolCallId} ${event.toolName} ${JSON.stringify(event.args)}`);
		}
		if (event.type === "tool_execution_end") {
			const record = {
				id: event.toolCallId,
				name: event.toolName,
				isError: event.isError,
				text: textFromToolResult(event.result.content),
				terminate: event.result.terminate === true,
			};
			toolEnds.push(record);
			writeLine(`完成: ${record.id} error=${record.isError} terminate=${record.terminate}`);
		}
		if (event.type === "message_end" && event.message.role === "toolResult") {
			toolResultIds.push(event.message.toolCallId);
			writeLine(`写入 transcript: ${event.message.toolCallId}`);
		}
	});

	try {
		writeLine(`模型: ${agent.state.model.provider}/${agent.state.model.id}`);
		await agent.prompt(options.prompt ?? DEFAULT_PROMPT);
	} finally {
		unsubscribe();
	}

	const finalAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
	const finalText = textFromAssistant(finalAssistant);
	const hasRuntimeError = agent.state.errorMessage !== undefined;
	const stoppedAfterTools = toolEnds.length > 0 && toolEnds.every((record) => record.terminate);
	writeLine(`执行记录: ${executionTrace.join(" -> ")}`);
	writeLine(`完成事件顺序: ${toolEnds.map((record) => record.id).join(" -> ") || "(无工具)"}`);
	writeLine(`结果写入顺序: ${toolResultIds.join(" -> ") || "(无工具)"}`);
	if (hasRuntimeError) writeLine("运行错误: 模型请求未完成，请检查有效的 Anthropic-compatible 配置。");
	writeLine(`最终回复: ${finalText || (stoppedAfterTools ? "(本批次已提前终止)" : "(无文本)")}`);

	return {
		executionTrace: executionTrace.slice(),
		toolEnds,
		toolResultIds,
		finalText,
		hasRuntimeError,
		messageRoles: agent.state.messages.map((message) => message.role),
	};
}

export async function runLesson() {
	try {
		const result = await runCode();
		if (result.hasRuntimeError) process.exitCode = 1;
		return result;
	} catch {
		console.error("运行失败：请检查有效的 Anthropic-compatible 配置后重试。");
		process.exitCode = 1;
		return undefined;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
