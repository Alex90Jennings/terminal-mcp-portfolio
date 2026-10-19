import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { ClaudeModel, demoScript, ScriptedModel, type ChatModel, type MessagesClient } from '@portfolio/assistant';
import { awsCredentialsProvider } from '@vercel/functions/oidc';
import type { AiConfig } from './config';

// Clients are reused across requests; models are per request (they may hold per-conversation state).
let anthropic: MessagesClient | undefined;
let bedrock: MessagesClient | undefined;

/**
 * The only place that knows about providers. Bedrock authenticates through the
 * standard AWS chain locally, and on Vercel by exchanging the deployment's OIDC
 * token for a short-lived role session: no long-lived AWS keys anywhere.
 */
export function createChatModel(config: AiConfig): ChatModel {
  const options = { maxRetries: 1, timeout: config.timeoutMs };
  switch (config.provider) {
    case 'scripted':
      return new ScriptedModel(demoScript, 'scripted-demo');
    case 'anthropic':
      anthropic ??= new Anthropic({ ...options, apiKey: config.anthropicApiKey ?? null });
      return new ClaudeModel(anthropic, config.providerModelId, { effort: config.effort });
    case 'bedrock': {
      const { region, roleArn } = config.bedrock;
      bedrock ??= new AnthropicBedrockMantle({
        ...options,
        awsRegion: region,
        ...(roleArn !== undefined && { providerChainResolver: async () => awsCredentialsProvider({ roleArn }) }),
      });
      return new ClaudeModel(bedrock, config.providerModelId, { effort: config.effort });
    }
  }
}
