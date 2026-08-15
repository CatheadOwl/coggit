import * as assert from 'node:assert';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type {
  CoggitProject,
  CoggitServices,
  ConfigProvider,
  FileStat,
  FileSystem,
  UriComponents,
} from '../../core/interfaces.js';
import type { CoggitWorkspaceRoot } from '../../core/types.js';
import { PROJECTS_RESOURCE_URI } from '../resources.js';
import { createCoggitMcpServer } from '../server.js';

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

const root: CoggitWorkspaceRoot = {
  id: 'root',
  label: 'root',
  workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
  configUri: uri('/workspace/.coggit/config.yaml'),
  projectRootUri: uri('/workspace'),
  sourceRootUri: uri('/workspace/src'),
  cognitionRootUri: uri('/workspace/cognition'),
};

class EmptyFileSystem implements FileSystem {
  async readFile(_uri: UriComponents): Promise<string> {
    throw new Error('ENOENT');
  }

  async writeFile(_uri: UriComponents, _content: string): Promise<void> {}

  async stat(_uri: UriComponents): Promise<FileStat | undefined> {
    return undefined;
  }

  async readDirectory(_uri: UriComponents): Promise<Array<[string, number]>> {
    return [];
  }

  async exists(_uri: UriComponents): Promise<boolean> {
    return false;
  }

  async createDirectory(_uri: UriComponents): Promise<void> {}

  async delete(_uri: UriComponents): Promise<void> {}
}

class EmptyConfigProvider implements ConfigProvider {
  getWorkspaceFolders() {
    return [root.workspaceFolder];
  }

  async findFiles(_pattern: string): Promise<UriComponents[]> {
    throw new Error('unexpected discovery');
  }
}

function createFakeProject(onEnsureFresh: () => void): CoggitProject {
  return {
    root,
    ensureFresh: async () => {
      onEnsureFresh();
    },
    buildSnapshot: async () => ({
      roots: [],
      allNodes: [],
      nodeById: new Map(),
      nodeBySourceUri: new Map(),
      mappingIndex: {
        sourceToCognition: new Map(),
        cognitionToSource: new Map(),
        structuralEdges: [],
        semanticEdges: [],
      },
    }),
    buildCognitionRoutes: async () => ({
      project: {
        label: 'root',
        configUri: 'test:/workspace/.coggit/config.yaml',
        projectRootUri: 'test:/workspace',
        sourceRootUri: 'test:/workspace/src',
        cognitionRootUri: 'test:/workspace/cognition',
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
        sourcePathRule: 'Use source-root-relative paths.',
      },
      generatedAt: 1,
      entries: [],
      diagnostics: [],
    }),
    addCognition: async () => {
      throw new Error('not used');
    },
    getCognitionHandbook: () => ({
      kind: 'all',
      version: 'skeleton-leaf-v3',
      content: '',
    }),
    getCognitionTemplate: () => ({
      kind: 'leaf',
      version: 'skeleton-leaf-v3',
      content: '',
    }),
    getNode: async () => undefined,
    resolveSourcePath: async (sourcePath) => ({ node: undefined, normalizedPath: sourcePath }),
    listUntracked: async () => [],
    listOrphanedCognition: async () => [],
    listMisplacedCognition: async () => [],
    listStrayCognition: async () => [],
    moveCognitionToExpected: async () => undefined,
    applySourceRename: async () => false,
    recordSourceChange: async () => false,
    recordDirectoryEntryChange: async () => false,
    recordCognitionChange: async () => false,
    markResolved: async () => ({
      sourceKey: 'tracked.ts',
    }),
    refreshNode: async () => undefined,
    flush: async () => {},
  };
}

suite('MCP project cache', () => {
  test('uses startup-discovered projects without refreshing again on the first tool call', async () => {
    let ensureFreshCount = 0;
    const services: CoggitServices = {
      fs: new EmptyFileSystem(),
      config: new EmptyConfigProvider(),
    };
    const server = createCoggitMcpServer(services, {
      toolsEnabled: true,
      initialProjects: [createFakeProject(() => {
        ensureFreshCount++;
      })],
    });
    const client = new Client({ name: 'coggit-mcp-cache-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.callTool({
        name: 'coggit_status',
        arguments: { sourcePath: 'tracked.ts' },
      });
      assert.strictEqual(ensureFreshCount, 0);

      await client.callTool({
        name: 'coggit_status',
        arguments: { sourcePath: 'tracked.ts' },
      });
      assert.strictEqual(ensureFreshCount, 1);
    } finally {
      await client.close();
    }
  });

  test('shares startup-discovered projects between resources and tools', async () => {
    let ensureFreshCount = 0;
    const services: CoggitServices = {
      fs: new EmptyFileSystem(),
      config: new EmptyConfigProvider(),
    };
    const server = createCoggitMcpServer(services, {
      toolsEnabled: true,
      initialProjects: [createFakeProject(() => {
        ensureFreshCount++;
      })],
    });
    const client = new Client({ name: 'coggit-mcp-cache-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.readResource({ uri: PROJECTS_RESOURCE_URI });
      assert.strictEqual(ensureFreshCount, 0);

      await client.callTool({
        name: 'coggit_status',
        arguments: { sourcePath: 'tracked.ts' },
      });
      assert.strictEqual(ensureFreshCount, 1);

      await client.callTool({
        name: 'coggit_status',
        arguments: { sourcePath: 'tracked.ts' },
      });
      assert.strictEqual(ensureFreshCount, 2);
    } finally {
      await client.close();
    }
  });

  test('exposes only node-kind handbook resources through MCP', async () => {
    const services: CoggitServices = {
      fs: new EmptyFileSystem(),
      config: new EmptyConfigProvider(),
    };
    const server = createCoggitMcpServer(services, {
      toolsEnabled: true,
      initialProjects: [createFakeProject(() => {})],
    });
    const client = new Client({ name: 'coggit-mcp-cache-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const resources = await client.listResources();
      const uris = resources.resources.map((resource) => resource.uri);

      assert.ok(uris.includes('coggit://handbook/leaf'));
      assert.ok(uris.includes('coggit://handbook/skeleton'));
      assert.ok(!uris.includes('coggit://handbook/all'));
    } finally {
      await client.close();
    }
  });
});
