import {
	createModels,
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";
import { createPipelineRuntime, type PipelineRuntimeOptions, runCode } from "./code.ts";

function createFauxRuntime(responses: FauxResponseStep[], options: Partial<PipelineRuntimeOptions> = {}) {
	const faux = fauxProvider({
		api: "learn-pi-s03",
		provider: "learn-pi-s03",
		models: [{ id: "learn-pi-s03", name: "Learn Pi Tool Pipeline" }],
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(responses);

	return {
		faux,
		runtime: createPipelineRuntime({
			model: faux.getModel(),
			streamFn: (model, context, streamOptions) => models.streamSimple(model, context, streamOptions),
			...options,
		}),
	};
}

describe("s03 tool execution pipeline", () => {
	it("共享的 Anthropic-compatible runtime 读取 OAuth 优先级、MODEL_ID 和自定义 base URL", async () => {
		const runtime = createAnthropicCompatibleRuntime({
			ANTHROPIC_API_KEY: "example-api-key",
			ANTHROPIC_OAUTH_TOKEN: "example-oauth-token",
			MODEL_ID: "example-compatible-model",
			ANTHROPIC_BASE_URL: "https://example.invalid/anthropic",
		});

		expect(runtime.apiKey).toBe("example-oauth-token");
		expect(runtime.model).toMatchObject({
			id: "example-compatible-model",
			api: "anthropic-messages",
			baseUrl: "https://example.invalid/anthropic",
		});
		expect(runtime.models.getModel(runtime.model.provider, runtime.model.id)).toBe(runtime.model);
		await expect(runtime.models.getAuth(runtime.model)).resolves.toMatchObject({
			auth: { apiKey: "example-oauth-token" },
		});

		const apiKeyRuntime = createAnthropicCompatibleRuntime({
			ANTHROPIC_API_KEY: " example-api-key ",
			ANTHROPIC_OAUTH_TOKEN: "   ",
		});
		expect(apiKeyRuntime.apiKey).toBe("example-api-key");
		await expect(apiKeyRuntime.models.getAuth(apiKeyRuntime.model)).resolves.toMatchObject({
			auth: { apiKey: "example-api-key" },
		});
	});

	it("两批教学流程先保留并行完成顺序，再处理审计和策略拦截", async () => {
		const { faux, runtime } = createFauxRuntime([
			fauxAssistantMessage([
				fauxToolCall("slow_lookup", { query: "slow" }, { id: "slow" }),
				fauxToolCall("fast_lookup", { query: "fast" }, { id: "fast" }),
			]),
			fauxAssistantMessage([
				fauxToolCall("serial_audit", { summary: "记录第一批" }, { id: "audit" }),
				fauxToolCall("blocked_lookup", { target: "private://forbidden" }, { id: "blocked" }),
			]),
			fauxAssistantMessage("两批工具结果已记录。"),
		]);

		const result = await runCode({ runtime, writeLine: () => undefined });

		expect(result.executionTrace).toEqual([
			"before:slow",
			"before:fast",
			"execute:slow_lookup:start",
			"execute:fast_lookup:start",
			"execute:fast_lookup:end",
			"after:fast",
			"execute:slow_lookup:end",
			"after:slow",
			"before:audit",
			"execute:serial_audit:start",
			"execute:serial_audit:end",
			"after:audit",
			"before:blocked",
		]);
		expect(result.toolEnds.map((record) => record.id)).toEqual(["fast", "slow", "audit", "blocked"]);
		expect(result.toolResultIds).toEqual(["slow", "fast", "audit", "blocked"]);
		expect(result.toolEnds.map((record) => record.isError)).toEqual([false, false, false, true]);
		expect(result.toolEnds.at(-1)?.text).toBe("演示策略：不允许读取 private:// 资源");
		expect(result.finalText).toBe("两批工具结果已记录。");
		expect(faux.state.callCount).toBe(3);
	});

	it("typed validation 和 beforeToolCall block 都生成错误 tool result，且不会执行工具", async () => {
		const { faux, runtime } = createFauxRuntime([
			fauxAssistantMessage([
				fauxToolCall("fast_lookup", {}, { id: "invalid" }),
				fauxToolCall("blocked_lookup", { target: "private://forbidden" }, { id: "blocked" }),
			]),
			fauxAssistantMessage("失败结果已记录。"),
		]);

		const result = await runCode({ runtime, writeLine: () => undefined });

		expect(result.executionTrace).toEqual(["before:blocked"]);
		expect(result.toolEnds.map((record) => record.id)).toEqual(["invalid", "blocked"]);
		expect(result.toolEnds.every((record) => record.isError)).toBe(true);
		expect(result.toolEnds[0]?.text).toContain("must have required properties query");
		expect(result.toolEnds[1]?.text).toBe("演示策略：不允许读取 private:// 资源");
		expect(result.toolResultIds).toEqual(["invalid", "blocked"]);
		expect(faux.state.callCount).toBe(2);
	});

	it("同一批次只要有一个 sequential tool，就会让所有工具串行执行", async () => {
		const { runtime } = createFauxRuntime([
			fauxAssistantMessage([
				fauxToolCall("slow_lookup", { query: "slow" }, { id: "slow" }),
				fauxToolCall("fast_lookup", { query: "fast" }, { id: "fast" }),
				fauxToolCall("serial_audit", { summary: "ordered" }, { id: "audit" }),
			]),
			fauxAssistantMessage("串行批次已完成。"),
		]);

		const result = await runCode({ runtime, writeLine: () => undefined });

		expect(result.executionTrace).toEqual([
			"before:slow",
			"execute:slow_lookup:start",
			"execute:slow_lookup:end",
			"after:slow",
			"before:fast",
			"execute:fast_lookup:start",
			"execute:fast_lookup:end",
			"after:fast",
			"before:audit",
			"execute:serial_audit:start",
			"execute:serial_audit:end",
			"after:audit",
		]);
		expect(result.toolEnds.map((record) => record.id)).toEqual(["slow", "fast", "audit"]);
		expect(result.toolResultIds).toEqual(["slow", "fast", "audit"]);
	});

	it("所有 finalized tool result 都 terminate 时，Agent 不再请求下一条模型响应", async () => {
		const { faux, runtime } = createFauxRuntime(
			[
				fauxAssistantMessage([
					fauxToolCall("slow_lookup", { query: "stop" }, { id: "slow" }),
					fauxToolCall("fast_lookup", { query: "stop" }, { id: "fast" }),
				]),
			],
			{ terminateAfterTools: true },
		);

		const result = await runCode({ runtime, writeLine: () => undefined });

		expect(result.toolEnds.map((record) => record.terminate)).toEqual([true, true]);
		expect(result.toolResultIds).toEqual(["slow", "fast"]);
		expect(result.finalText).toBe("");
		expect(result.messageRoles).toEqual(["user", "assistant", "toolResult", "toolResult"]);
		expect(faux.state.callCount).toBe(1);
	});
});
