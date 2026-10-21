import type { KnowledgeBase } from '@portfolio/knowledge/runtime';
import type { AiAnswer } from './ai-answer';

/** A follow-up offered under an answer: running it is exactly like typing `input`. */
export interface FollowUp {
  label: string;
  input: string;
}

/**
 * Follow-ups for a finished answer, from what it actually referenced: a story it told (the full story, another
 * example) and the one project it was about (Alex's role there). Nothing is suggested that the answer didn't touch, and
 * no AI call is made to find suggestions. Project links already appear in the answer's "Projects" line.
 */
export function followUps(answer: Pick<AiAnswer, 'status' | 'projects' | 'stories'>, kb: Pick<KnowledgeBase, 'getProject' | 'getStory'>): FollowUp[] {
  if (answer.status !== 'done') return [];
  const suggestions: FollowUp[] = [];
  const story = answer.stories.find(({ id }) => kb.getStory(id) !== undefined);
  if (story !== undefined) {
    suggestions.push({ label: 'See the full story', input: `/stories ${story.id} full` }, { label: 'Another example', input: 'Can you give me another example?' });
  }
  const [only, ...others] = answer.projects;
  const project = only !== undefined && others.length === 0 ? kb.getProject(only.id) : undefined;
  if (project !== undefined && project.responsibilities.length > 0) {
    suggestions.push({ label: `Alex's role on ${project.name}`, input: `What was Alex's role on ${project.name}?` });
  }
  return suggestions;
}
