export class KnowledgeValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Knowledge base is invalid:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'KnowledgeValidationError';
    this.issues = issues;
  }
}
