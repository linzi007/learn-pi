import { pathToFileURL } from "node:url";
import { type Component, Container, type Terminal, TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RENDER_SETTLE_MS = 30;
const SYNCHRONIZED_OUTPUT_START = "\x1b[?2026h";

export class TaskStatusComponent implements Component {
	private readonly task: string;
	private status: string;

	constructor(task: string, status: string) {
		this.task = task;
		this.status = status;
	}

	setStatus(status: string): void {
		this.status = status;
	}

	render(width: number): string[] {
		return [truncateToWidth(`任务: ${this.task}`, width), truncateToWidth(`状态: ${this.status}`, width)];
	}

	invalidate(): void {}
}

// 用内存终端记录真实 TUI 写出的 ANSI 帧，不接管读者的 stdin 或屏幕。
export class RecordingTerminal implements Terminal {
	readonly writes: string[] = [];
	readonly kittyProtocolActive = false;
	readonly columns: number;
	readonly rows: number;

	constructor(columns: number, rows: number) {
		this.columns = columns;
		this.rows = rows;
	}

	get frameWrites(): string[] {
		return this.writes.filter((data) => data.includes(SYNCHRONIZED_OUTPUT_START));
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
}

export interface DiffRenderObservation {
	columns: number;
	initialLines: string[];
	updatedLines: string[];
	initialVisibleWidths: number[];
	firstFrameWrite: string;
	diffFrameWrite: string;
	firstFrameContainsAllLines: boolean;
	diffContainsUnchangedTask: boolean;
	diffContainsUpdatedStatus: boolean;
	fullRedrawsAfterInitial: number;
	fullRedrawsAfterUpdate: number;
	sameFrameWriteCount: number;
}

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface RunLessonOptions {
	columns?: number;
	output?: LessonOutput;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

function yesOrNo(value: boolean): string {
	return value ? "是" : "否";
}

async function settleRender(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
}

export async function observeTuiDiff(columns = 24): Promise<DiffRenderObservation> {
	const terminal = new RecordingTerminal(columns, 8);
	const component = new TaskStatusComponent("分析代码", "等待");
	const layout = new Container();
	layout.addChild(component);

	const tui = new TUI(terminal);
	tui.addChild(layout);

	try {
		tui.start();
		await settleRender();

		const initialLines = component.render(columns);
		const firstFrameWrite = terminal.frameWrites[0] ?? "";
		const fullRedrawsAfterInitial = tui.fullRedraws;

		component.setStatus("完成");
		const updatedLines = component.render(columns);
		tui.requestRender();
		await settleRender();

		const diffFrameWrite = terminal.frameWrites[1] ?? "";
		const fullRedrawsAfterUpdate = tui.fullRedraws;
		const frameCountBeforeSameRender = terminal.frameWrites.length;

		tui.requestRender();
		await settleRender();

		return {
			columns,
			initialLines,
			updatedLines,
			initialVisibleWidths: initialLines.map(visibleWidth),
			firstFrameWrite,
			diffFrameWrite,
			firstFrameContainsAllLines: initialLines.every((line) => firstFrameWrite.includes(line)),
			diffContainsUnchangedTask: diffFrameWrite.includes(updatedLines[0] ?? ""),
			diffContainsUpdatedStatus: diffFrameWrite.includes(updatedLines[1] ?? ""),
			fullRedrawsAfterInitial,
			fullRedrawsAfterUpdate,
			sameFrameWriteCount: terminal.frameWrites.length - frameCountBeforeSameRender,
		};
	} finally {
		tui.stop();
	}
}

export async function runLesson(options: RunLessonOptions = {}): Promise<DiffRenderObservation> {
	const output = options.output ?? consoleOutput;
	const result = await observeTuiDiff(options.columns);

	output.writeLine(`终端宽度: ${result.columns} 列`);
	output.writeLine(`首帧: ${result.initialLines.join(" | ")}`);
	output.writeLine(`首帧包含全部两行: ${yesOrNo(result.firstFrameContainsAllLines)}`);
	output.writeLine(`更新帧: ${result.updatedLines.join(" | ")}`);
	output.writeLine(`差分写入包含未变化任务行: ${yesOrNo(result.diffContainsUnchangedTask)}`);
	output.writeLine(`差分写入包含新状态行: ${yesOrNo(result.diffContainsUpdatedStatus)}`);
	output.writeLine(`全量重绘次数: ${result.fullRedrawsAfterInitial} -> ${result.fullRedrawsAfterUpdate}`);
	output.writeLine(`相同帧新增写入: ${result.sameFrameWriteCount}`);
	output.writeLine(`首帧可见宽度: ${result.initialVisibleWidths.join(", ")}（上限 ${result.columns}）`);

	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
