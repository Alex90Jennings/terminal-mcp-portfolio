/** Stable resource URIs. Changing one breaks clients that saved it, so treat them as public API. */
export const PROFILE_URI = 'portfolio://profile';
export const SKILLS_URI = 'portfolio://skills';
export const PROJECTS_URI = 'portfolio://projects';
export const PROJECT_URI_TEMPLATE = 'portfolio://projects/{id}';

export const projectUri = (id: string): string => `${PROJECTS_URI}/${id}`;
