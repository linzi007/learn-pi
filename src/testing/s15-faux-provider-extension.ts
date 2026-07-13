import { type Context, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "learn-pi-s15";
const MODEL = "learn-pi-s15";

function getLastUserText(context: Context): string {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("");
	}
	return "";
}

export default function registerS15FauxProvider(pi: ExtensionAPI): void {
	const faux = fauxProvider({
		api: PROVIDER,
		provider: PROVIDER,
		models: [{ id: MODEL, name: "Learn Pi s15 Faux Model" }],
		tokensPerSecond: 10_000,
		tokenSize: { min: 1, max: 3 },
	});
	faux.setResponses([(context) => fauxAssistantMessage(`RPC 收到: ${getLastUserText(context)}`, { timestamp: 0 })]);

	const model = faux.getModel();
	pi.registerProvider(PROVIDER, {
		name: "Learn Pi s15 Faux Provider",
		baseUrl: "https://example.invalid",
		apiKey: "test-only-faux-key",
		api: faux.api,
		streamSimple: faux.provider.streamSimple,
		models: [
			{
				id: model.id,
				name: model.name,
				reasoning: model.reasoning,
				input: [...model.input],
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			},
		],
	});
}
