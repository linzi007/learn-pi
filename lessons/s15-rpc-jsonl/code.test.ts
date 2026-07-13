import { beforeAll, describe, expect, it } from "vitest";
import { type FauxRpcObservation, runFauxRpcObservation } from "../../src/testing/s15-rpc-test-fixture.ts";
import { runLesson } from "./code.ts";

describe("s15 RPC JSONL", () => {
	let result: FauxRpcObservation;
	const unicodePrompt = "第一段\u2028第二段\u2029第三段";

	beforeAll(async () => {
		result = await runFauxRpcObservation(unicodePrompt);
	}, 20_000);

	it("通过真实 RpcClient 子进程关联并发响应并接收异步 Agent 事件", () => {
		expect(result.state.model).toMatchObject({ provider: "learn-pi-s15", id: "learn-pi-s15" });
		expect(result.availableModels).toContainEqual({ provider: "learn-pi-s15", id: "learn-pi-s15" });
		expect(result.eventTypes).toContain("agent_start");
		expect(result.eventTypes).toContain("message_update");
		expect(result.eventTypes.at(-1)).toBe("agent_settled");
	});

	it("严格 JSONL 不会把 U+2028 和 U+2029 当成记录分隔符", () => {
		expect(result.finalText).toBe(`RPC 收到: ${unicodePrompt}`);
		expect(result.finalText).toContain("\u2028");
		expect(result.finalText).toContain("\u2029");
	});

	it("错误 model 通过关联 response 返回给调用方", () => {
		expect(result.missingModelError).toBe("Model not found: missing-provider/missing-model");
	});

	it("测试结束后停止子进程并删除临时配置", () => {
		expect(result.stoppedRequestError).toBe("Client not started");
		expect(result.tempRootRemoved).toBe(true);
	});

	it("缺少认证时只输出统一诊断，不抛出原始错误", async () => {
		const originalApiKey = process.env.ANTHROPIC_API_KEY;
		const originalOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
		const originalExitCode = process.exitCode;
		const errors: string[] = [];

		try {
			delete process.env.ANTHROPIC_API_KEY;
			delete process.env.ANTHROPIC_OAUTH_TOKEN;
			process.exitCode = undefined;

			const lessonResult = await runLesson({ writeLine: () => {}, writeError: (text) => errors.push(text) });

			expect(lessonResult).toBeUndefined();
			expect(errors).toEqual(["真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。"]);
			expect(process.exitCode).toBe(1);
		} finally {
			if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = originalApiKey;
			if (originalOauthToken === undefined) delete process.env.ANTHROPIC_OAUTH_TOKEN;
			else process.env.ANTHROPIC_OAUTH_TOKEN = originalOauthToken;
			process.exitCode = originalExitCode;
		}
	});
});
