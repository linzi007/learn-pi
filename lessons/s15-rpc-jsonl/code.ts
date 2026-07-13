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
		const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
		const nodePath = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
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

		await client.start();
		output.writeLine(`RPC 子进程: 已启动（model=${model}）`);

		const [currentState, availableModels] = await Promise.all([client.getState(), client.getAvailableModels()]);
		state = currentState;
		availableModelCount = availableModels.length;
		output.writeLine(`并发响应: get_state.sessionId=${state.sessionId}, models=${availableModelCount}`);

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

		try {
			await client.setModel("missing-provider", "missing-model");
		} catch (error) {
			missingModelError = error instanceof Error ? error.message : String(error);
		}
		output.writeLine(`错误响应: ${missingModelError}`);
	} finally {
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
