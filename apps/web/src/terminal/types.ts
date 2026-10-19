import type { KnowledgeBase } from '@portfolio/knowledge/runtime';
import type { CommandResult } from './output';

export interface CommandContext {
  kb: KnowledgeBase;
  /** Previously entered commands, oldest first. */
  history: readonly string[];
  commands: readonly Command[];
  /** Whether natural-language questions can be answered by the AI assistant. */
  aiAvailable: boolean;
}

export interface Command {
  name: string;
  aliases: readonly string[];
  /** One line for `help`. */
  summary: string;
  /** e.g. "projects [name] [section]". Defaults to the name. */
  usage?: string;
  run(args: readonly string[], context: CommandContext): CommandResult;
  /** Candidates for the argument being typed (`args` ends with the partial argument). */
  complete?(args: readonly string[], context: CommandContext): readonly string[];
}
