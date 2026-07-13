import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const SESSION_TREE_CWD = "learn-pi-s08-session-tree";

type NodeLabel = "A" | "B" | "C" | "D" | "E";

export interface SessionTreeFixture {
	session: SessionManager;
	ids: Record<Exclude<NodeLabel, "E">, string>;
	labels: Map<string, NodeLabel>;
}

function appendUser(session: SessionManager, label: NodeLabel, text: string): string {
	return session.appendMessage({
		role: "user",
		content: `${label}: ${text}`,
		timestamp: 0,
	});
}

function appendAssistant(session: SessionManager, label: NodeLabel, text: string): string {
	return session.appendMessage(fauxAssistantMessage(`${label}: ${text}`, { timestamp: 0 }));
}

export function createSessionTreeFixture(): SessionTreeFixture {
	const session = SessionManager.inMemory(SESSION_TREE_CWD);
	const labels = new Map<string, NodeLabel>();

	const a = appendUser(session, "A", "先说明当前方案。");
	labels.set(a, "A");
	const b = appendAssistant(session, "B", "当前方案已经建立。");
	labels.set(b, "B");
	const c = appendUser(session, "C", "沿原方向继续。 ");
	labels.set(c, "C");

	session.branch(b);
	const d = appendUser(session, "D", "改走另一条方向。");
	labels.set(d, "D");

	return { session, ids: { A: a, B: b, C: c, D: d }, labels };
}

export function labelsForContext(messages: readonly unknown[]): string[] {
	return messages.map((message) => messageText(message).slice(0, 1));
}

function messageText(message: unknown): string {
	if (!message || typeof message !== "object" || !("content" in message)) {
		return "";
	}

	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((block): block is { type: "text"; text: string } => {
			return typeof block === "object" && block !== null && block.type === "text" && "text" in block;
		})
		.map((block) => block.text)
		.join("");
}
