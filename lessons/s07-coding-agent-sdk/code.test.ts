import { describe, expect, it } from "vitest";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";
import { createFauxCodingAgentRuntime, DEFAULT_RESPONSE } from "../../src/testing/s07-coding-agent-sdk-test-fixture.ts";
import {
	createCodingAgentSession,
	GENERIC_MODEL_FAILURE,
	MEMORY_AGENTS_PATH,
	MEMORY_INSTRUCTIONS,
	runLesson,
} from "./code.ts";

describe("s07 Coding Agent SDK", () => {
	it("通过 createAgentSession 装配真实调用形状、内存资源和一次 prompt", async () => {
		const { runtime } = createFauxCodingAgentRuntime();
		const output: string[] = [];
		const result = await runLesson({
			runtime,
			output: { writeLine: (text) => output.push(text) },
			setExitCodeOnFailure: false,
		});

		expect(result.succeeded).toBe(true);
		expect(result.finalText).toBe(DEFAULT_RESPONSE);
		expect(result.stopReason).toBe("stop");
		expect(result.eventTypes).toContain("agent_start");
		expect(result.eventTypes).toContain("agent_end");
		expect(output).toContain(`资源: ${MEMORY_AGENTS_PATH}`);
		expect(output).toContain(`最终文本: ${DEFAULT_RESPONSE}`);
	});

	it("共享 Anthropic-compatible runtime 的 Provider 和 Model 能注册到内存 ModelRegistry", async () => {
		const runtime = createAnthropicCompatibleRuntime({
			ANTHROPIC_API_KEY: "test-key",
			MODEL_ID: "test-model",
			ANTHROPIC_BASE_URL: "https://example.test/anthropic",
		});
		const sessionRuntime = await createCodingAgentSession(runtime);

		try {
			expect(sessionRuntime.modelRegistry.find(runtime.model.provider, runtime.model.id)).toMatchObject({
				provider: runtime.model.provider,
				id: "test-model",
				baseUrl: "https://example.test/anthropic",
			});
			expect(sessionRuntime.session.sessionFile).toBeUndefined();
			expect(sessionRuntime.session.getActiveToolNames()).toEqual([]);
			expect(sessionRuntime.session.systemPrompt).toContain(MEMORY_INSTRUCTIONS);
		} finally {
			sessionRuntime.dispose();
		}

		expect(sessionRuntime.modelRegistry.find(runtime.model.provider, runtime.model.id)).toBeUndefined();
	});

	it("模型失败只输出通用诊断，不泄露 Provider 原始错误", async () => {
		const { runtime } = createFauxCodingAgentRuntime(null);
		const output: string[] = [];
		const result = await runLesson({
			runtime,
			output: { writeLine: (text) => output.push(text) },
			setExitCodeOnFailure: false,
		});

		expect(result.succeeded).toBe(false);
		expect(result.stopReason).toBe("error");
		expect(output).toContain(GENERIC_MODEL_FAILURE);
		expect(output.join("\n")).not.toContain("No more faux responses queued");
	});
});
