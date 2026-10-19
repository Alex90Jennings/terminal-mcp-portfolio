/**
 * Validates `content/`, writes the public bundle to `generated/knowledge.json`,
 * and refreshes the JSON Schemas editors use to validate content files.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildBundle } from '../src/bundle.ts';
import { KnowledgeValidationError } from '../src/errors.ts';
import { readContent } from '../src/load.ts';
import { ProfileSchema, ProjectSchema, SkillsSchema } from '../src/schema.ts';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contentDir = path.resolve(packageDir, '../../content');
const outputFile = path.join(packageDir, 'generated/knowledge.json');
const schemaDir = path.join(contentDir, 'schemas');

try {
  const content = await readContent(contentDir);
  const bundle = buildBundle(content);

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`);

  await mkdir(schemaDir, { recursive: true });
  const schemas = { project: ProjectSchema, profile: ProfileSchema, skills: SkillsSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    await writeFile(path.join(schemaDir, `${name}.schema.json`), `${JSON.stringify(jsonSchema, null, 2)}\n`);
  }

  const authored = content.projects.length;
  const withheld = countUnverified(content);
  console.log(
    `knowledge: ${bundle.projects.length}/${authored} projects published, ${bundle.skills.skills.length} skills, ` +
      `${withheld} unverified claim(s) withheld → ${path.relative(process.cwd(), outputFile)}`,
  );
} catch (error) {
  if (error instanceof KnowledgeValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

function countUnverified(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countUnverified(item), 0);
  if (value === null || typeof value !== 'object') return 0;
  const self = (value as { status?: unknown }).status === 'unverified' ? 1 : 0;
  return self + Object.values(value).reduce<number>((sum, child) => sum + countUnverified(child), 0);
}
