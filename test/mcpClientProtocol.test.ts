import {
  createMcpInitializeParams,
  handleMcpServerMessage,
  type McpRoot,
} from '../src/core/mcpClientProtocol.js';

type TestFunction = () => void;

function test(name: string, fn: TestFunction): boolean {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
    return false;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected "${String(expected)}", got "${String(actual)}"`,
    );
  }
}

function assertTrue(actual: unknown, message: string): asserts actual {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

console.log('\n=== MCP Client Protocol Tests ===\n');

let passed = 0;
let failed = 0;

if (
  test(
    'Should advertise fixed roots and handle roots/list during a pending tool call',
    () => {
      const initialize = createMcpInitializeParams();
      assertEqual(
        initialize.capabilities.roots.listChanged,
        false,
        'Fixed roots capability',
      );

      const storageRoot: McpRoot = {
        uri: 'file:///C:/Users/Test/AppData/Roaming/Aviators%20Newsletter',
        name: 'Aviators Newsletter global storage',
      };
      const rootsRequest = handleMcpServerMessage(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'roots/list',
        },
        [storageRoot],
      );

      assertEqual(rootsRequest.kind, 'request', 'Interleaved request kind');
      assertTrue(
        rootsRequest.kind === 'request',
        'Roots request should produce a response',
      );
      assertEqual(
        rootsRequest.response.id,
        2,
        'Interleaved server request ID',
      );
      const rootsResult = rootsRequest.response.result as {
        roots: McpRoot[];
      };
      assertEqual(rootsResult.roots.length, 1, 'Root count');
      assertEqual(
        rootsResult.roots[0].uri,
        storageRoot.uri,
        'Encoded global storage URI',
      );
      assertEqual(
        rootsResult.roots[0].name,
        storageRoot.name,
        'Global storage root name',
      );

      const storageStateResponse = handleMcpServerMessage(
        {
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [{ type: 'text', text: 'Storage state saved.' }],
          },
        },
        [storageRoot],
      );
      assertEqual(
        storageStateResponse.kind,
        'response',
        'Pending storage-state response kind',
      );
      assertTrue(
        storageStateResponse.kind === 'response',
        'Storage-state call should remain resolvable',
      );
      assertEqual(storageStateResponse.id, 2, 'Pending tool call ID');
    },
  )
) {
  passed += 1;
} else {
  failed += 1;
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
