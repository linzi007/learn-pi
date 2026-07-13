import { pathToFileURL } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	estimateTokens,
	findCutPoint,
	type SessionEntry,
	SessionManager,
	shouldCompact,
} from "@earendil-works/pi-coding-agent";

const FIXED_SUMMARY = "摘要：旧回合已确认目标与约束；从 C 开始继续当前实现。";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface DemoSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface CompactionScenario {
	session: SessionManager;
	labels: Map<string, string>;
	ids: { A: string; B: string; C: string; D: string };
	tokensBefore: number;
	contextWindow: number;
	settings: DemoSettings;
}

export interface CheckpointDecision {
	status: "not-needed" | "requires-turn-prefix" | "appended";
	firstKeptEntryId?: string;
	entryId?: string;
	isSplitTurn: boolean;
	turnStartIndex: number;
}

export interface LessonResult {
	shortContextWouldCompact: boolean;
	compactionAppended: boolean;
	cut: CheckpointDecision;
	tokensBefore: number;
	threshold: number;
	fullEntryLabels: string[];
	contextEntryLabels: string[];
	contextRoles: string[];
	compactionParentLabel: string | undefined;
}

const consoleOutput: LessonOutput = { writeLine: (text) => console.log(text) };

function writeStep(output: LessonOutput, step: number, text: string): void {
	output.writeLine(`[步骤 ${step}/5] ${text}`);
}

function longText(label: string): string {
	return `${label}: ${"用于观察压缩切点的稳定内容。".repeat(18)}`;
}

function labelsForEntries(entries: readonly SessionEntry[], labels: ReadonlyMap<string, string>): string[] {
	return entries.map((entry) => labels.get(entry.id) ?? entry.type);
}

/**
 * 这组数据只模拟已经存在的会话条目，不会调用模型。
 * A/B 是旧回合，C/D 是完整保留区；正文用固定摘要观察其后的会话重建。
 */
export function createCompactionScenario(): CompactionScenario {
	const session = SessionManager.inMemory("learn-pi-s09-session-compaction");
	const labels = new Map<string, string>();
	const a = session.appendMessage({ role: "user", content: longText("A 旧问题"), timestamp: 1 });
	labels.set(a, "A");
	const b = session.appendMessage(fauxAssistantMessage(longText("B 旧回答"), { timestamp: 2 }));
	labels.set(b, "B");
	const c = session.appendMessage({ role: "user", content: longText("C 当前问题"), timestamp: 3 });
	labels.set(c, "C");
	const d = session.appendMessage(fauxAssistantMessage(longText("D 当前回答"), { timestamp: 4 }));
	labels.set(d, "D");

	const messages = session.buildSessionContext().messages;
	const tokensBefore = messages.reduce((total, message) => total + estimateTokens(message), 0);
	const keepRecentTokens = messages.slice(-2).reduce((total, message) => total + estimateTokens(message), 0);
	const reserveTokens = Math.max(1, Math.floor(tokensBefore / 4));
	return {
		session,
		labels,
		ids: { A: a, B: b, C: c, D: d },
		tokensBefore,
		contextWindow: tokensBefore,
		settings: { enabled: true, reserveTokens, keepRecentTokens },
	};
}

/**
 * 本课只处理摘要已经成功生成后的持久化与重建。
 * 遇到会拆开回合的切点时不硬写摘要；生产 compact() 会先生成 turn-prefix summary。
 */
export function appendFixedCheckpoint(
	scenario: CompactionScenario,
	contextTokens: number,
	summary = FIXED_SUMMARY,
): CheckpointDecision {
	if (!shouldCompact(contextTokens, scenario.contextWindow, scenario.settings)) {
		return { status: "not-needed", isSplitTurn: false, turnStartIndex: -1 };
	}

	const entries = scenario.session.getEntries();
	const cut = findCutPoint(entries, 0, entries.length, scenario.settings.keepRecentTokens);
	const firstKept = entries[cut.firstKeptEntryIndex];
	if (!firstKept) {
		throw new Error("教学会话缺少可保留的条目。");
	}
	if (cut.isSplitTurn) {
		return {
			status: "requires-turn-prefix",
			firstKeptEntryId: firstKept.id,
			isSplitTurn: true,
			turnStartIndex: cut.turnStartIndex,
		};
	}

	// SessionManager 追加的是 compaction entry，旧 A/B/C/D 仍留在同一棵只追加的树里。
	const entryId = scenario.session.appendCompaction(summary, firstKept.id, contextTokens);
	scenario.labels.set(entryId, "摘要");
	return {
		status: "appended",
		firstKeptEntryId: firstKept.id,
		entryId,
		isSplitTurn: false,
		turnStartIndex: -1,
	};
}

export function runLesson(output: LessonOutput = consoleOutput): LessonResult {
	const scenario = createCompactionScenario();
	const threshold = scenario.contextWindow - scenario.settings.reserveTokens;
	const shortContextWouldCompact = shouldCompact(threshold, scenario.contextWindow, scenario.settings);
	writeStep(output, 1, `短上下文 ${threshold} tokens 到达阈值但不超过它：不压缩。`);
	writeStep(output, 1, `当前路径 ${scenario.tokensBefore} tokens 超过阈值 ${threshold}：需要压缩。`);

	const preview = findCutPoint(
		scenario.session.getEntries(),
		0,
		scenario.session.getEntries().length,
		scenario.settings.keepRecentTokens,
	);
	const previewEntry = scenario.session.getEntries()[preview.firstKeptEntryIndex];
	writeStep(
		output,
		2,
		`从末端反向累计后，切点选中 ${scenario.labels.get(previewEntry?.id ?? "")}：保留完整回合 C -> D。`,
	);
	writeStep(output, 2, `isSplitTurn=${preview.isSplitTurn}，因此本例不需要额外的回合前缀摘要。`);

	const cut = appendFixedCheckpoint(scenario, scenario.tokensBefore);
	if (cut.status !== "appended" || !cut.entryId) {
		throw new Error("示例应在完整回合边界追加压缩条目。");
	}
	const compactionEntry = scenario.session.getEntries().find((entry) => entry.id === cut.entryId);
	writeStep(output, 3, "固定检查点摘要已作为 compaction entry 追加到当前末端之后。");
	writeStep(
		output,
		3,
		`摘要的 parent 是 ${scenario.labels.get(compactionEntry?.parentId ?? "")}，firstKeptEntryId 指向 ${scenario.labels.get(cut.firstKeptEntryId ?? "")}。`,
	);

	// buildSessionContext 会先放最新摘要，再放 firstKeptEntryId 开始的保留区。
	const contextEntries = scenario.session.buildContextEntries();
	const rebuilt = buildSessionContext(scenario.session.getEntries(), scenario.session.getLeafId());
	writeStep(output, 4, `从当前末端重建模型上下文：${labelsForEntries(contextEntries, scenario.labels).join(" -> ")}`);
	writeStep(output, 4, `模型消息角色：${rebuilt.messages.map((message) => message.role).join(" -> ")}`);

	const fullEntryLabels = labelsForEntries(scenario.session.getEntries(), scenario.labels);
	writeStep(output, 5, `完整会话树的追加顺序仍是：${fullEntryLabels.join(" -> ")}`);
	writeStep(output, 5, "A 与 B 没有被删除；它们只是由摘要替代，不再进入当前模型上下文。");

	return {
		shortContextWouldCompact,
		compactionAppended: cut.status === "appended",
		cut,
		tokensBefore: scenario.tokensBefore,
		threshold,
		fullEntryLabels,
		contextEntryLabels: labelsForEntries(contextEntries, scenario.labels),
		contextRoles: rebuilt.messages.map((message) => message.role),
		compactionParentLabel: scenario.labels.get(compactionEntry?.parentId ?? ""),
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runLesson();
}
