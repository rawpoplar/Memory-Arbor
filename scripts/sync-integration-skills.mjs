import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const rootSkill = join("skills", "memory-context", "SKILL.md");
const targets = [
  join("integrations", "codex", "skills", "memory-context", "SKILL.md"),
  join("integrations", "claude-code", "skills", "memory-context", "SKILL.md"),
];

const notice =
  "Generated copy. Edit `skills/memory-context/SKILL.md` at the repository root, then resync integration skills.\n\n";
const source = await readFile(rootSkill, "utf8");
const content = source.replace(/---\r?\n\r?\n/, `---\n\n${notice}`);

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

console.log(`Synced ${targets.length} integration skill copies.`);
