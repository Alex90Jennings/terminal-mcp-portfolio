import { editDistance } from '@portfolio/knowledge/runtime';
import { interests, softSkills, stories } from './commands/evidence';
import { about, approach, contact, skills } from './commands/profile';
import { projects } from './commands/projects';
import { cv, education, experience, firstRound, interview, technical } from './commands/recruiter';
import { ask, clear, help, history } from './commands/session';
import type { Command } from './types';

export interface Registry {
  readonly commands: readonly Command[];
  find(name: string): Command | undefined;
  /** Command names close to a mistyped one, best first. */
  suggest(name: string, limit?: number): string[];
}

export function createRegistry(commands: readonly Command[]): Registry {
  const byName = new Map<string, Command>();
  for (const entry of commands) {
    for (const name of [entry.name, ...entry.aliases]) {
      if (byName.has(name)) throw new Error(`Command name "${name}" is registered twice`);
      byName.set(name, entry);
    }
  }

  return {
    commands,
    find: (name) => byName.get(name.toLowerCase()),
    suggest: (name, limit = 2) => {
      const input = name.toLowerCase();
      return [...byName.entries()]
        .map(([candidate, entry]) => ({ name: entry.name, distance: editDistance(input, candidate) }))
        .filter(({ distance }) => distance <= Math.max(1, Math.floor(input.length / 3)))
        .sort((a, b) => a.distance - b.distance)
        .map((match) => match.name)
        .filter((match, index, all) => all.indexOf(match) === index)
        .slice(0, limit);
    },
  };
}

/** Every built-in command, in the order `help` lists them. */
export const registry = createRegistry([
  help,
  firstRound,
  technical,
  about,
  experience,
  projects,
  softSkills,
  stories,
  education,
  interests,
  skills,
  approach,
  cv,
  interview,
  contact,
  ask,
  history,
  clear,
]);
