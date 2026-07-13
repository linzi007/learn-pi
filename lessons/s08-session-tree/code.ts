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
	// 使用公开的内存 SessionManager，而不是手造树节点，才能观察 Pi 真正的 append/branch 语义。
	const session = SessionManager.inMemory("learn-pi-s08-session-tree");
	const labels = new Map<string, string>();
	output.writeLine("[步骤 1/5] 创建不落盘的会话管理器：本次演示只在内存中保存会话。");

	// 每一次 append 都创建 entry，并把 leaf 推进到新 entry。
	const a = session.appendMessage({ role: "user", content: "A: 先说明当前方案。", timestamp: 0 });
	labels.set(a, "A");
	const b = session.appendMessage(fauxAssistantMessage("B: 当前方案已经建立。", { timestamp: 0 }));
	labels.set(b, "B");
	const c = session.appendMessage({ role: "user", content: "C: 沿原方向继续。", timestamp: 0 });
	labels.set(c, "C");
	output.writeLine("[步骤 2/5] 依次追加 A -> B -> C：当前末端来到 C。");

	// branch 只移动 leaf；C 不会被删除。D 因而成为 B 的第二个 child。
	session.branch(b);
	const d = session.appendMessage({ role: "user", content: "D: 改走另一条方向。", timestamp: 0 });
	labels.set(d, "D");
	output.writeLine("[步骤 3/5] 回到 B 后追加 D：C 仍保留，D 成为 B 的另一条分支。");

	// Context 由当前 leaf 向上回溯得到；同一棵树换 leaf，就会得到不同的模型上下文。
	const currentContext = session.buildSessionContext();
	const originalBranchContext = buildSessionContext(session.getEntries(), c);
	const treeBeforeReset = renderTree(session.getTree(), labels, session.getLeafId());

	output.writeLine("[步骤 4/5] 比较两个末端的模型上下文：当前末端 D 与指定的旧末端 C。");
	output.writeLine(`当前末端: ${labels.get(session.getLeafId() ?? "")}`);
	output.writeLine("完整会话条目树:");
	for (const line of treeBeforeReset) {
		output.writeLine(`  ${line}`);
	}
	output.writeLine(`当前模型上下文: ${labelsForContext(currentContext.messages).join(" -> ")}`);
	output.writeLine(`指定 C 重建的模型上下文: ${labelsForContext(originalBranchContext.messages).join(" -> ")}`);

	// resetLeaf 只改变“下一次从哪里接续”，不删除历史；下一次 append 会从 null parent 新建 root。
	session.resetLeaf();
	const e = session.appendMessage({ role: "user", content: "E: 从空末端开始的新根。", timestamp: 0 });
	labels.set(e, "E");
	const treeAfterReset = renderTree(session.getTree(), labels, session.getLeafId());

	output.writeLine("[步骤 5/5] 清空当前末端后追加 E：E 成为新根，旧历史不删除。");
	output.writeLine(`新的模型上下文: ${labelsForContext(session.buildSessionContext().messages).join(" -> ")}`);
	output.writeLine(
		`所有根节点: ${session
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
	// 这里只把 SessionManager 返回的树转成可读文本，不参与 Pi 的树构建或 Context 选择。
	const lines: string[] = [];
	for (const [index, node] of nodes.entries()) {
		const last = index === nodes.length - 1;
		const connector = prefix ? (last ? "`- " : "|- ") : "";
		const leafMarker = node.entry.id === leafId ? " <当前末端>" : "";
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
