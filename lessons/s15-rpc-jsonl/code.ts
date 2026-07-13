import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type AgentSessionEvent, RpcClient, type RpcSessionState } from "@earendil-works/pi-coding-agent";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";

const PROMPT = "只回复：RPC 真实模型调用成功。不要添加其他内容。";

export interface LessonOutput {
	writeLine(text: string): void;
	writeError(text: string): void;
}

export interface LessonResult {
	state: RpcSessionState;
	availableModelCount: number;
	eventTypes: AgentSessionEvent["type"][];
	finalText: string | null;
	missingModelError: string;
	clientStopped: boolean;
	tempConfigRemoved: boolean;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
	writeError: (text) => console.error(text),
};

export async function runRpcLesson(output: LessonOutput = consoleOutput): Promise<LessonResult> {
	// 真实模型配置只复制到本次临时目录；RPC 子进程不会读取用户已有的 Pi 状态。
	const { model: providerModel, apiKey } = createAnthropicCompatibleRuntime();
	const tempRoot = await mkdtemp(join(tmpdir(), "learn-pi-s15-"));
	const agentDir = join(tempRoot, "pi-agent");
	const model = `${providerModel.provider}/${providerModel.id}`;

	let state: RpcSessionState;
	let availableModelCount = 0;
	let eventTypes: AgentSessionEvent["type"][] = [];
	let finalText: string | null = null;
	let missingModelError = "";
	let clientStopped = false;
	let client: RpcClient | undefined;

	try {
		// 子进程只通过这份 models.json 认识本课 Provider，避免依赖 ~/.pi/agent 的模型注册。
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "models.json"),
			`${JSON.stringify(
				{
					providers: {
						[providerModel.provider]: {
							name: "Anthropic-compatible",
							baseUrl: providerModel.baseUrl,
							apiKey: "$ANTHROPIC_API_KEY",
							api: providerModel.api,
							models: [
								{
									id: providerModel.id,
									name: providerModel.name,
									reasoning: providerModel.reasoning,
									thinkingLevelMap: providerModel.thinkingLevelMap,
									input: providerModel.input,
									cost: providerModel.cost,
									contextWindow: providerModel.contextWindow,
									maxTokens: providerModel.maxTokens,
									headers: providerModel.headers,
									compat: providerModel.compat,
								},
							],
						},
					},
				},
				null,
				2,
			)}\n`,
		);
		// rpc-entry 是包公开的入口；不深度导入内部实现，升级 Pi 时协议边界更稳定。
		const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
		const nodePath = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
		// RpcClient 封装 JSONL 子进程边界；环境和参数明确关闭本课无关的本地资源加载。
		client = new RpcClient({
			cliPath: rpcEntryPath,
			cwd: tempRoot,
			model,
			env: {
				ANTHROPIC_API_KEY: apiKey,
				HOME: join(tempRoot, "home"),
				PATH: nodePath,
				PI_CODING_AGENT_DIR: agentDir,
				PI_CONFIG_DIR: join(tempRoot, "pi-config"),
				PI_OFFLINE: "1",
			},
			args: [
				"--offline",
				"--no-session",
				"--no-tools",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-context-files",
				"--no-approve",
			],
		});

		// start 先建立子进程和协议握手，后续命令才可安全发出。
		await client.start();
		output.writeLine("[步骤 1/5] 启动隔离的 RPC 子进程，并建立标准输入/输出通道。");
		output.writeLine(`RPC 子进程: 已启动（model=${model}）`);

		// 两个独立命令并发发往同一 JSONL 会话，响应通过 request id 回到各自调用方。
		output.writeLine("[步骤 2/5] 并发发送两条查询：响应必须按请求编号归还，而非按到达顺序。");
		const [currentState, availableModels] = await Promise.all([client.getState(), client.getAvailableModels()]);
		state = currentState;
		availableModelCount = availableModels.length;
		output.writeLine(`并发响应: get_state.sessionId=${state.sessionId}, models=${availableModelCount}`);

		// promptAndWait 收集本次请求产生的事件，等 session 空闲后才读取最终 assistant 文本。
		output.writeLine("[步骤 3/5] 发送问题：接受响应与 Agent 完成事件分开观察。");
		const events = await client.promptAndWait(PROMPT);
		eventTypes = events.map((event) => event.type);
		output.writeLine(`异步事件: ${eventTypes.join(" -> ")}`);
		for (const event of events) {
			if (
				event.type === "message_end" &&
				event.message.role === "assistant" &&
				(event.message.stopReason === "error" || event.message.stopReason === "aborted")
			) {
				throw new Error("RPC 真实模型调用失败，请检查 MODEL_ID、认证信息、Base URL 和 Provider 兼容性");
			}
		}

		finalText = await client.getLastAssistantText();
		output.writeLine(`最终文本: ${finalText ?? "(无文本)"}`);

		// 故意请求不存在的模型，观察 RPC 如何把服务端失败返回给客户端。
		output.writeLine("[步骤 4/5] 故意请求不存在的模型：观察关联的错误响应。");
		try {
			await client.setModel("missing-provider", "missing-model");
		} catch (error) {
			missingModelError = error instanceof Error ? error.message : String(error);
		}
		output.writeLine(`错误响应: ${missingModelError}`);
	} finally {
		// 先结束子进程，再删除其配置目录；无论模型调用结果如何都不留下临时状态。
		try {
			if (client) {
				await client.stop();
				try {
					await client.getState();
				} catch {
					clientStopped = true;
				}
			}
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
			output.writeLine("[步骤 5/5] 清理：停止 RPC 子进程并删除本次临时配置。");
			output.writeLine("清理: RPC 子进程已停止，临时配置目录已删除");
		}
	}

	return {
		state,
		availableModelCount,
		eventTypes,
		finalText,
		missingModelError,
		clientStopped,
		tempConfigRemoved: true,
	};
}

export async function runLesson(output: LessonOutput = consoleOutput): Promise<LessonResult | undefined> {
	try {
		return await runRpcLesson(output);
	} catch {
		output.writeError("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
		process.exitCode = 1;
		return undefined;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
