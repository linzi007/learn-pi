import { runLesson as runS01 } from "../lessons/s01-model-stream/demo.ts";

const lessonRunners: Record<string, () => Promise<unknown>> = {
	s01: runS01,
};

const lessonId = process.argv[2];
const runner = lessonId ? lessonRunners[lessonId] : undefined;

if (!runner) {
	console.error(`未知课程: ${lessonId ?? "(未提供)"}`);
	console.error(`可用课程: ${Object.keys(lessonRunners).join(", ")}`);
	process.exitCode = 1;
} else {
	await runner();
}
