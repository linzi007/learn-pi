import { pathToFileURL } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	type SessionEntry,
	SessionManager,
	type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";

export interface LessonOutput {
	writeLine(text: string): void;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

export interface RunLessonOptions {
	output?: LessonOutput;
}

export async function runLesson(options: RunLessonOptions = {}) {
	const output = options.output ?? consoleOutput;
	const session = SessionManager.inMemory("learn-pi-s08-session-tree");
	const labels = new Map<string, string>();

	// 1. 每一次 append 都创建 entry，并把 leaf 推进到新 entry。
	const a = session.appendMessage({ role: "user", content: "A: 先说明当前方案。", timestamp: 0 });
	labels.set(a, "A");
	const b = session.appendMessage(fauxAssistantMessage("B: 当前方案已经建立。", { timestamp: 0 }));
	labels.set(b, "B");
	const c = session.appendMessage({ role: "user", content: "C: 沿原方向继续。", timestamp: 0 });
	labels.set(c, "C");

	// 2. branch 只移动 leaf；C 不会被删除。D 因而成为 B 的第二个 child。
	session.branch(b);
	const d = session.appendMessage({ role: "user", content: "D: 改走另一条方向。", timestamp: 0 });
	labels.set(d, "D");

	const currentContext = session.buildSessionContext();
	const originalBranchContext = buildSessionContext(session.getEntries(), c);
	const treeBeforeReset = renderTree(session.getTree(), labels, session.getLeafId());

	output.writeLine("追加顺序: A -> B -> C，再从 B 分叉 D");
	output.writeLine(`当前 leaf: ${labels.get(session.getLeafId() ?? "")}`);
	output.writeLine("完整 entry tree:");
	for (const line of treeBeforeReset) {
		output.writeLine(`  ${line}`);
	}
	output.writeLine(`当前 Context: ${labelsForContext(currentContext.messages).join(" -> ")}`);
	output.writeLine(`指定 C 重建 Context: ${labelsForContext(originalBranchContext.messages).join(" -> ")}`);

	// 3. resetLeaf 也不删除旧树；下一次 append 会从 null parent 新建 root。
	session.resetLeaf();
	const e = session.appendMessage({ role: "user", content: "E: 从空 leaf 开始的新根。", timestamp: 0 });
	labels.set(e, "E");
	const treeAfterReset = renderTree(session.getTree(), labels, session.getLeafId());

	output.writeLine("resetLeaf() 后追加: E");
	output.writeLine(`新 Context: ${labelsForContext(session.buildSessionContext().messages).join(" -> ")}`);
	output.writeLine(
		`所有 root: ${session
			.getTree()
			.map((node) => labels.get(node.entry.id))
			.join(", ")}`,
	);

	return {
		persisted: session.isPersisted(),
		sessionFile: session.getSessionFile(),
		ids: { A: a, B: b, C: c, D: d, E: e },
		currentLeaf: session.getLeafId(),
		currentBranch: session.getBranch().map((entry) => labels.get(entry.id)),
		contextBeforeReset: labelsForContext(currentContext.messages),
		contextForOriginalBranch: labelsForContext(originalBranchContext.messages),
		contextAfterReset: labelsForContext(session.buildSessionContext().messages),
		treeBeforeReset,
		treeAfterReset,
	};
}

function labelsForContext(messages: readonly unknown[]): string[] {
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

function renderTree(
	nodes: readonly SessionTreeNode[],
	labels: Map<string, string>,
	leafId: string | null,
	prefix = "",
): string[] {
	const lines: string[] = [];
	for (const [index, node] of nodes.entries()) {
		const last = index === nodes.length - 1;
		const connector = prefix ? (last ? "`- " : "|- ") : "";
		const leafMarker = node.entry.id === leafId ? " <leaf>" : "";
		lines.push(`${prefix}${connector}${labelForEntry(node.entry, labels)} [${node.entry.type}]${leafMarker}`);
		const childPrefix = prefix ? `${prefix}${last ? "   " : "|  "}` : "   ";
		lines.push(...renderTree(node.children, labels, leafId, childPrefix));
	}
	return lines;
}

function labelForEntry(entry: SessionEntry, labels: Map<string, string>): string {
	return labels.get(entry.id) ?? entry.type;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
