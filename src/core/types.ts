export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonSchemaType =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  default?: JsonValue;
  enum?: JsonValue[];
  additionalProperties?: boolean | JsonSchema;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ExecutableDefinition<TParams = unknown, TResult = unknown>
  extends FunctionDefinition {
  execute: (params: TParams) => Promise<TResult>;
}

export type Skill<TParams = unknown, TResult = unknown> = ExecutableDefinition<
  TParams,
  TResult
>;

export type Tool<TParams = unknown, TResult = unknown> = ExecutableDefinition<
  TParams,
  TResult
>;

export function toFunctionDefinition(
  definition: FunctionDefinition,
): FunctionDefinition {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
