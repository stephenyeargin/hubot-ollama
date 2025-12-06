const registry = require('../src/tool-registry');

describe('Tool Registry', () => {
  beforeEach(() => {
    // Clear tools between tests, preserving built-in time tool
    registry.clearTools();
  });

  describe('Built-in Tools', () => {
    it('should have hubot_ollama_get_current_time tool registered', () => {
      const tools = registry.getTools();
      expect(tools).toHaveProperty('hubot_ollama_get_current_time');
    });

    it('hubot_ollama_get_current_time should have required metadata', () => {
      const tools = registry.getTools();
      const timeTool = tools.hubot_ollama_get_current_time;

      expect(timeTool).toHaveProperty('name', 'hubot_ollama_get_current_time');
      expect(timeTool).toHaveProperty('description');
      expect(timeTool).toHaveProperty('handler');
      expect(timeTool).toHaveProperty('parameters');
      expect(typeof timeTool.handler).toBe('function');
    });

    it('hubot_ollama_get_current_time handler should return ISO timestamp', async () => {
      const tools = registry.getTools();
      const timeTool = tools.hubot_ollama_get_current_time;
      const result = await timeTool.handler({});

      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      // Verify it's a valid ISO 8601 timestamp
      const date = new Date(result.timestamp);
      expect(date).not.toEqual(new Date('Invalid Date'));
      expect(result.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Tool Registration', () => {
    it('should register a new tool', () => {
      const testTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('test_tool', testTool);
      const tools = registry.getTools();

      expect(tools).toHaveProperty('test_tool');
      expect(tools.test_tool.name).toBe('test_tool');
    });

    it('should reject registration without a handler function', () => {
      const invalidTool = {
        name: 'invalid_tool',
        description: 'Missing handler',
        parameters: {},
        handler: null
      };

      expect(() => {
        registry.registerTool('invalid_tool', invalidTool);
      }).toThrow();
    });

    it('should reject registration without a description', () => {
      const invalidTool = {
        name: 'invalid_tool',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      expect(() => {
        registry.registerTool('invalid_tool', invalidTool);
      }).toThrow();
    });

    it('should reject registration without a name', () => {
      const invalidTool = {
        description: 'No name tool',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      expect(() => {
        registry.registerTool(undefined, invalidTool);
      }).toThrow();
    });

    it('should accept tools with empty parameters', () => {
      const toolWithNoParams = {
        name: 'no_params_tool',
        description: 'Tool with no parameters',
        parameters: {},
        handler: async () => ({ result: 'success' })
      };

      registry.registerTool('no_params_tool', toolWithNoParams);
      const tools = registry.getTools();

      expect(tools).toHaveProperty('no_params_tool');
    });

    it('should accept tools with complex parameter schemas', () => {
      const complexTool = {
        name: 'complex_tool',
        description: 'Tool with complex parameters',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input string' },
            count: { type: 'number', description: 'Count parameter' },
            options: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' }
              }
            }
          }
        },
        handler: async (args) => ({ result: args })
      };

      registry.registerTool('complex_tool', complexTool);
      const tools = registry.getTools();

      expect(tools).toHaveProperty('complex_tool');
      expect(tools.complex_tool.parameters).toEqual(complexTool.parameters);
    });
  });

  describe('Tool Execution', () => {
    it('should execute a registered tool handler', async () => {
      const testTool = {
        name: 'executable_tool',
        description: 'A tool that can be executed',
        parameters: {},
        handler: async (args) => ({ executed: true, args })
      };

      registry.registerTool('executable_tool', testTool);
      const tools = registry.getTools();
      const result = await tools.executable_tool.handler({ key: 'value' });

      expect(result.executed).toBe(true);
      expect(result.args).toEqual({ key: 'value' });
    });

    it('should pass parameters to tool handler', async () => {
      const parameterizedTool = {
        name: 'param_tool',
        description: 'Tool that uses parameters',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        handler: async (args) => ({ greeting: `Hello, ${args.name}!` })
      };

      registry.registerTool('param_tool', parameterizedTool);
      const tools = registry.getTools();
      const result = await tools.param_tool.handler({ name: 'World' });

      expect(result.greeting).toBe('Hello, World!');
    });

    it('should handle async operations in tool handler', async () => {
      const asyncTool = {
        name: 'async_tool',
        description: 'Tool with async operations',
        parameters: {},
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { delayed: true };
        }
      };

      registry.registerTool('async_tool', asyncTool);
      const tools = registry.getTools();
      const result = await tools.async_tool.handler({});

      expect(result.delayed).toBe(true);
    });

    it('should allow tool handlers to throw errors', async () => {
      const errorTool = {
        name: 'error_tool',
        description: 'Tool that throws an error',
        parameters: {},
        handler: async () => {
          throw new Error('Tool failed');
        }
      };

      registry.registerTool('error_tool', errorTool);
      const tools = registry.getTools();

      await expect(tools.error_tool.handler({})).rejects.toThrow('Tool failed');
    });
  });

  describe('Tool Retrieval', () => {
    it('should return a copy of tools to prevent external mutation', () => {
      const tools1 = registry.getTools();
      const tools2 = registry.getTools();

      expect(tools1).not.toBe(tools2);
      expect(tools1).toEqual(tools2);
    });

    it('should include all registered tools', () => {
      const newTool = {
        name: 'retrieval_test_tool',
        description: 'Tool for retrieval test',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('retrieval_test_tool', newTool);
      const tools = registry.getTools();

      expect(tools).toHaveProperty('retrieval_test_tool');
      expect(tools).toHaveProperty('hubot_ollama_get_current_time');
    });
  });

  describe('Tool Metadata', () => {
    it('should preserve tool name in metadata', () => {
      const tool = {
        name: 'metadata_tool',
        description: 'Tool for metadata testing',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('metadata_tool', tool);
      const tools = registry.getTools();

      expect(tools.metadata_tool.name).toBe('metadata_tool');
    });

    it('should preserve tool description in metadata', () => {
      const description = 'This is a test tool with a specific description';
      const tool = {
        name: 'desc_tool',
        description,
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('desc_tool', tool);
      const tools = registry.getTools();

      expect(tools.desc_tool.description).toBe(description);
    });

    it('should preserve tool parameters in metadata', () => {
      const parameters = {
        type: 'object',
        properties: {
          input: { type: 'string' }
        }
      };
      const tool = {
        name: 'params_tool',
        description: 'Tool with parameters',
        parameters,
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('params_tool', tool);
      const tools = registry.getTools();

      expect(tools.params_tool.parameters).toEqual(parameters);
    });
  });

  describe('Tool Validation', () => {
    it('should validate tool name is present', () => {
      const tool = {
        description: 'Missing name',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      expect(() => {
        registry.registerTool(undefined, tool);
      }).toThrow();
    });

    it('should validate handler is a function', () => {
      const tool = {
        name: 'bad_handler',
        description: 'Handler is not a function',
        parameters: {},
        handler: 'not a function'
      };

      expect(() => {
        registry.registerTool('bad_handler', tool);
      }).toThrow();
    });

    it('should validate description is present', () => {
      const tool = {
        name: 'no_description',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      expect(() => {
        registry.registerTool('no_description', tool);
      }).toThrow();
    });

    it('should allow tools to override built-in tools', () => {
      // Override the time tool with a custom one
      const customTool = {
        name: 'hubot_ollama_get_current_time',
        description: 'Custom time tool',
        parameters: {},
        handler: async () => ({ timestamp: '2025-01-01T00:00:00.000Z' })
      };

      registry.registerTool('hubot_ollama_get_current_time', customTool);
      const tools = registry.getTools();

      expect(tools.hubot_ollama_get_current_time.description).toBe('Custom time tool');
    });
  });

  describe('Tool Integration Scenarios', () => {
    it('should handle multiple tools registered', () => {
      const tool1 = {
        name: 'tool_a',
        description: 'First tool',
        parameters: {},
        handler: async () => ({ tool: 'a' })
      };

      const tool2 = {
        name: 'tool_b',
        description: 'Second tool',
        parameters: {},
        handler: async () => ({ tool: 'b' })
      };

      registry.registerTool('tool_a', tool1);
      registry.registerTool('tool_b', tool2);
      const tools = registry.getTools();

      expect(Object.keys(tools).length).toBeGreaterThanOrEqual(3); // At least these 2 plus built-in
      expect(tools).toHaveProperty('tool_a');
      expect(tools).toHaveProperty('tool_b');
    });

    it('should allow tool names to be used as object keys', () => {
      const tool = {
        name: 'key_compatible_tool',
        description: 'Tool with key-compatible name',
        parameters: {},
        handler: async () => ({ result: 'test' })
      };

      registry.registerTool('key_compatible_tool', tool);
      const tools = registry.getTools();

      // Test that we can access it as a key
      expect(tools['key_compatible_tool']).toBeDefined();
      expect(tools.key_compatible_tool).toBeDefined();
    });

    it('should preserve tool handler across multiple getTools calls', async () => {
      const tool = {
        name: 'persistent_tool',
        description: 'Tool to test persistence',
        parameters: {},
        handler: async () => ({ call_count: Math.random() })
      };

      registry.registerTool('persistent_tool', tool);

      const tools1 = registry.getTools();
      const result1 = await tools1.persistent_tool.handler({});

      const tools2 = registry.getTools();
      const result2 = await tools2.persistent_tool.handler({});

      // Both should be able to execute (they return different random values)
      expect(result1).toHaveProperty('call_count');
      expect(result2).toHaveProperty('call_count');
    });
  });
});
