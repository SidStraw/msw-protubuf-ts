import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const disallowedPatterns = [/from\s+["']msw["']/, /require\(["']msw["']\)/];

async function collectTypeScriptFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await collectTypeScriptFiles(fullPath)));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(fullPath);
		}
	}

	return files;
}

const sourceFiles = await collectTypeScriptFiles(
	fileURLToPath(new URL("../src", import.meta.url)),
);
const offenders = [];

for (const file of sourceFiles) {
	const content = await readFile(file, "utf8");
	if (disallowedPatterns.some((pattern) => pattern.test(content))) {
		offenders.push(file);
	}
}

if (offenders.length > 0) {
	console.error("Forbidden runtime imports found:");
	for (const file of offenders) {
		console.error(`- ${file}`);
	}
	process.exit(1);
}
