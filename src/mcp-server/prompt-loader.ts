import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpPromptAsset {
  readonly sourceName: string;
  readonly content: string;
}

/**
 * Register Markdown prompt assets that were embedded into the application at
 * build time.
 *
 * Frontmatter format:
 *   ---
 *   name: my-prompt
 *   description: What this prompt does
 *   arguments:
 *     - name: argName
 *       description: What this arg is for
 *       required: true   # (default true)
 *   ---
 *   Prompt body with {{argName}} placeholders.
 */
export function registerPromptAssets(
  server: McpServer,
  assets: readonly McpPromptAsset[],
): void {
  for (const asset of assets) {
    const { meta, body } = parseFrontmatter(asset.content);

    const name = (meta.name as string) ?? asset.sourceName.replace(/\.md$/, '');
    const description = (meta.description as string) ?? '';
    const argDefs = (meta.arguments as ArgDef[] | undefined) ?? [];

    const argsSchema: Record<string, z.ZodTypeAny> = {};
    for (const argument of argDefs) {
      const value = z.string().describe(argument.description ?? '');
      argsSchema[argument.name] = argument.required === false ? value.optional() : value;
    }

    server.registerPrompt(
      name,
      {
        description,
        argsSchema: Object.keys(argsSchema).length > 0 ? argsSchema : undefined,
      },
      (input) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: renderTemplate(body, input as Record<string, string>),
            },
          },
        ],
      }),
    );
  }
}

interface ArgDef {
  name: string;
  description: string;
  required?: boolean;
}

function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: text };
  }

  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return { meta: {}, body: text };
  }

  const meta: Record<string, unknown> = {};
  let i = 1;

  while (i < end) {
    const top = lines[i].match(/^(\w+):\s*(.*)/);
    if (top) {
      const key = top[1];
      const rest = top[2].trim();

      if (key === 'arguments') {
        const args: ArgDef[] = [];
        i++;
        while (i < end) {
          const match = lines[i].match(/^\s+-\s+(\w+):\s*(.*)/);
          if (!match) {
            break;
          }

          const argument: Record<string, string | boolean> = {};
          argument[match[1]] = coerceValue(match[2].trim());

          i++;
          while (i < end) {
            const property = lines[i].match(/^\s+(\w+):\s*(.*)/);
            if (!property || lines[i].trimStart().startsWith('-')) {
              break;
            }
            argument[property[1]] = coerceValue(property[2].trim());
            i++;
          }
          args.push({
            name: String(argument.name ?? ''),
            description: String(argument.description ?? ''),
            required: argument.required !== false,
          });
        }
        meta[key] = args;
        continue;
      }

      meta[key] = coerceValue(rest);
    }
    i++;
  }

  return { meta, body: lines.slice(end + 1).join('\n').trim() };
}

function coerceValue(raw: string): string | boolean {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return raw;
}

function renderTemplate(template: string, args: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => args[key] ?? `{{${key}}}`);
}
