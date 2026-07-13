import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const lessonsRoot = join(root, "lessons");
const requiredFiles = ["README.md", "demo.ts", "demo.test.ts"];
const errors: string[] = [];

function lessonDirectories() {
	return readdirSync(lessonsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^s\d{2}-/.test(entry.name))
		.map((entry) => join(lessonsRoot, entry.name))
		.sort();
}

function checkLesson(lessonDirectory: string) {
	const lessonName = relative(lessonsRoot, lessonDirectory);
	for (const fileName of requiredFiles) {
		if (!existsSync(join(lessonDirectory, fileName))) {
			errors.push(`${lessonName} 缺少 ${fileName}`);
		}
	}

	const demoPath = join(lessonDirectory, "demo.ts");
	if (!existsSync(demoPath)) return;

	const sourceText = readFileSync(demoPath, "utf8");
	const lineCount = sourceText.split(/\r?\n/).length;
	if (lineCount > 250) {
		errors.push(`${lessonName}/demo.ts 有 ${lineCount} 行，超过 250 行硬上限`);
	}

	const sourceFile = ts.createSourceFile(demoPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith(".")) continue;

		const importedPath = resolve(dirname(demoPath), specifier);
		if (importedPath.startsWith(lessonsRoot) && !importedPath.startsWith(lessonDirectory)) {
			errors.push(`${lessonName}/demo.ts 不得导入其他课程: ${specifier}`);
		}
	}

	const readmePath = join(lessonDirectory, "README.md");
	if (existsSync(readmePath)) {
		const readme = readFileSync(readmePath, "utf8");
		for (const heading of [
			"## 问题",
			"## 解决方案",
			"## 工作原理",
			"## 试一下",
			"## 接下来",
			"<summary>深入 Pi 源码</summary>",
		]) {
			if (!readme.includes(heading)) errors.push(`${lessonName}/README.md 缺少“${heading}”`);
		}
		const imageReferences = [...readme.matchAll(/!\[[^\]]+\]\((images\/[^)]+\.svg)\)/g)];
		if (imageReferences.length === 0) {
			errors.push(`${lessonName}/README.md 缺少课程 images/ 下的 SVG 教学图`);
		}
		for (const reference of imageReferences) {
			const imagePath = reference[1];
			if (imagePath && !existsSync(join(lessonDirectory, imagePath))) {
				errors.push(`${lessonName}/README.md 引用了不存在的图片: ${imagePath}`);
			}
		}
	}
}

function checkExactFeatureCopies() {
	const featuresRoot = join(root, "src", "features");
	if (!existsSync(featuresRoot)) return;

	const seen = new Map<string, string>();
	for (const fileName of readdirSync(featuresRoot)
		.filter((name) => name.endsWith(".ts"))
		.sort()) {
		const filePath = join(featuresRoot, fileName);
		const source = readFileSync(filePath, "utf8").replaceAll(/\s+/g, "");
		const hash = createHash("sha256").update(source).digest("hex");
		const previous = seen.get(hash);
		if (previous) errors.push(`${fileName} 与 ${previous} 完全重复，请抽取共享实现`);
		seen.set(hash, fileName);
	}
}

for (const lessonDirectory of lessonDirectories()) checkLesson(lessonDirectory);
checkExactFeatureCopies();

if (errors.length > 0) {
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log(`课程结构检查通过，共 ${lessonDirectories().length} 课`);
}
