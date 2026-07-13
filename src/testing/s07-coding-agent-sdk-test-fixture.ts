import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

export const DEFAULT_RESPONSE = "AgentSession 把真实模型请求、资源和内存会话装配在一起。";

/** 仅供 s07 离线测试注入的确定性模型 runtime。 */
export function createFauxCodingAgentRuntime(response: string | null = DEFAULT_RESPONSE) {
	const faux = fauxProvider({
		api: "learn-pi-s07-test",
		provider: "learn-pi-s07-test",
		models: [{ id: "learn-pi-s07-test", name: "Learn Pi S07 Test Model" }],
		tokenSize: { min: 1, max: 1 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(response === null ? [] : [fauxAssistantMessage(response, { timestamp: 0 })]);

	return {
		faux,
		runtime: {
			model: faux.getModel(),
			models,
			apiKey: "test-only-key",
		},
	};
}
