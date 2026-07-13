import {
	type ApiKeyAuth,
	createModels,
	createProvider,
	envApiKeyAuth,
	type Model,
	type MutableModels,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

const PROVIDER_ID = "learn-pi-anthropic-compatible";
const DEFAULT_MODEL_ID = "claude-haiku-4-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

export interface AnthropicCompatibleRuntime {
	model: Model<"anthropic-messages">;
	models: MutableModels;
	apiKey: string;
}

function createCompatibleModel(modelId: string, baseUrl: string): Model<"anthropic-messages"> {
	return {
		id: modelId,
		name: modelId,
		api: "anthropic-messages",
		provider: PROVIDER_ID,
		baseUrl,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	};
}

function firstConfiguredValue(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function createBoundApiKeyAuth(apiKey: string): ApiKeyAuth {
	const interactiveAuth = envApiKeyAuth("Anthropic-compatible API key", ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);
	return {
		name: interactiveAuth.name,
		login: interactiveAuth.login,
		resolve: async () => ({ auth: { apiKey }, source: "explicit runtime configuration" }),
	};
}

/**
 * Builds a local Anthropic-compatible provider from explicit environment values.
 * The returned key stays in memory and is never logged or persisted by this helper.
 */
export function createAnthropicCompatibleRuntime(
	environment: NodeJS.ProcessEnv = process.env,
): AnthropicCompatibleRuntime {
	const apiKey = firstConfiguredValue(environment.ANTHROPIC_OAUTH_TOKEN, environment.ANTHROPIC_API_KEY);
	if (!apiKey) {
		throw new Error("缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_OAUTH_TOKEN。");
	}

	const modelId = environment.MODEL_ID?.trim() || DEFAULT_MODEL_ID;
	const baseUrl = environment.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL;
	const model = createCompatibleModel(modelId, baseUrl);
	const provider = createProvider({
		id: PROVIDER_ID,
		name: "Anthropic-compatible",
		baseUrl,
		auth: {
			apiKey: createBoundApiKeyAuth(apiKey),
		},
		models: [model],
		api: anthropicMessagesApi(),
	});
	const models = createModels();
	models.setProvider(provider);

	return { model, models, apiKey };
}
