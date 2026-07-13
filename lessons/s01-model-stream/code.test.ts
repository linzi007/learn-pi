import { type Context, createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { consumeModelStream, createRealRuntime, type LessonOutput, type ModelRuntime } from "./code.ts";

function createFauxRuntime(response: string | null): ModelRuntime {
	const faux = fauxProvider({
		api: "learn-pi-s01-test",
		provider: "learn-pi-s01-test",
		models: [{ id: "learn-pi-s01-test" }],
		tokenSize: { min: 1, max: 1 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(response === null ? [] : [fauxAssistantMessage(response, { timestamp: 0 })]);
	return { models, model: faux.getModel() };
}

const context: Context = {
	systemPrompt: "只回复预设内容。",
	messages: [{ role: "user", content: "模型响应是一次性返回的吗？", timestamp: 0 }],
};

describe("s01 model stream", () => {
	it("将多次 text_delta 和完整消息视为同一个 Stream", async () => {
		const output: string[] = [];
		const observation = await consumeModelStream(createFauxRuntime("事件流会分段到达。"), context, {
			writeLine: (line) => output.push(line),
		} satisfies LessonOutput);

		expect(observation.deltas).toEqual(["事件流会", "分段到达", "。"]);
		expect(observation.message.stopReason).toBe("stop");
		expect(observation.eventTypes).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(output).toContain("text_delta #2: 分段到达");
	});

	it("Provider 错误也通过 error 事件和最终消息收束", async () => {
		const observation = await consumeModelStream(createFauxRuntime(null), context, { writeLine: () => undefined });

		expect(observation.eventTypes).toEqual(["error"]);
		expect(observation.message.stopReason).toBe("error");
		expect(observation.message.errorMessage).toContain("No more faux responses queued");
	});

	it("默认真实 runtime 使用 Anthropic API Key 和兼容 Base URL", () => {
		const runtime = createRealRuntime({
			ANTHROPIC_API_KEY: "test-key",
			ANTHROPIC_BASE_URL: "https://example.test/anthropic",
			MODEL_ID: "test-model",
		});

		expect(runtime.model.id).toBe("test-model");
		expect(runtime.model.baseUrl).toBe("https://example.test/anthropic");
		expect(runtime.models.getProvider(runtime.model.provider)?.id).toBe(runtime.model.provider);
	});
});
