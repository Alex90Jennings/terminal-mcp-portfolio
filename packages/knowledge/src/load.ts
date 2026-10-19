import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBundle, type LabelledDocument, type RawContent } from './bundle.ts';
import { KnowledgeValidationError } from './errors.ts';
import type { KnowledgeBundle } from './schema.ts';

/**
 * Node-only: reads authored content from disk. Runtime code never calls this;
 * it imports the bundle that `npm run knowledge:build` generates.
 */
export async function readContent(contentDir: string): Promise<RawContent> {
  const projectsDir = path.join(contentDir, 'projects');
  const projectFiles = (await readdir(projectsDir)).filter((file) => file.endsWith('.json')).sort();

  const [profile, skills, ...projects] = await Promise.all([
    readDocument(contentDir, 'profile.json'),
    readDocument(contentDir, 'skills.json'),
    ...projectFiles.map((file) => readDocument(contentDir, path.join('projects', file))),
  ]);
  if (profile === undefined || skills === undefined) throw new Error('unreachable: profile and skills are always read');

  const misnamed = projects.flatMap((document, index) => {
    const expected = path.basename(projectFiles[index] ?? '', '.json');
    const id = (document.data as { id?: unknown } | null)?.id;
    return id === expected ? [] : [`${document.label}: id "${String(id)}" must match the file name "${expected}"`];
  });
  if (misnamed.length > 0) throw new KnowledgeValidationError(misnamed);

  return { profile, skills, projects };
}

export async function loadBundle(contentDir: string): Promise<KnowledgeBundle> {
  return buildBundle(await readContent(contentDir));
}

async function readDocument(contentDir: string, relativePath: string): Promise<LabelledDocument> {
  const label = path.posix.join('content', relativePath.split(path.sep).join('/'));
  const text = await readFile(path.join(contentDir, relativePath), 'utf8');
  try {
    return { label, data: JSON.parse(text) as unknown };
  } catch (error) {
    throw new KnowledgeValidationError([`${label}: invalid JSON (${(error as Error).message})`]);
  }
}
