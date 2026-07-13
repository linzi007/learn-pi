import { pathToFileURL } from "node:url";
import {
	type AssistantMessageEvent,
	type Context,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
} from "@earendil-works/pi-ai";

const DEFAULT_RESPONSE = "事件流会分段到达。";

export interface LessonOutput {
	writeLine(text: string): void;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

export interface RunLessonOptions {
	output?: LessonOutput;
	response?: string | null;
}

export async function runLesson(options: RunLessonOptions = {}) {
	const output = options.output ?? consoleOutput;
	const response = options.response === undefined ? DEFAULT_RESPONSE : options.response;
	const faux = fauxProvider({
		api: "learn-pi-s01",
		provider: "learn-pi-s01",
		models: [{ id: "learn-pi-s01", name: "Learn Pi Faux Model" }],
		tokenSize: { min: 1, max: 1 },
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(response === null ? [] : [fauxAssistantMessage(response, { timestamp: 0 })]);

	const context: Context = {
		systemPrompt: "只回复预设内容。",
		messages: [{ role: "user", content: "模型响应是一次性返回的吗？", timestamp: 0 }],
	};

	output.writeLine(`用户消息: ${context.messages[0]?.content}`);
	output.writeLine(`调用模型: ${faux.getModel().provider}/${faux.getModel().id}`);

	const eventTypes: AssistantMessageEvent["type"][] = [];
	const deltas: string[] = [];
	const stream = models.streamSimple(faux.getModel(), context);

	for await (const event of stream) {
		eventTypes.push(event.type);
		if (event.type === "text_delta") {
			deltas.push(event.delta);
			output.writeLine(`text_delta #${deltas.length}: ${event.delta}`);
		}
	}

	const message = await stream.result();
	const finalText = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");

	output.writeLine(`最终消息: ${finalText || "(无文本)"}`);
	output.writeLine(`事件序列: ${eventTypes.join(" -> ")}`);
	output.writeLine(`结束原因: ${message.stopReason}`);

	return { eventTypes, deltas, finalText, message };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
