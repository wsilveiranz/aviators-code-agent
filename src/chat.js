/**
 * Interactive Chat Mode
 * Run the agent as an interactive CLI that responds to user input
 */

import { AzureOpenAI } from 'openai';
import readline from 'readline';
import { 
  agentConfig, 
  getSkillDefinitions, 
  getToolDefinitions,
  executeSkill,
  executeTool,
  getNewsletterTemplate
} from './agent.js';
import { connectToPlaywrightMCP, disconnectMCP, listMCPTools, connectToEmailMCP, disconnectEmailMCP, listEmailMCPTools, isStorageValid, runLinkedInLogin } from './tools/index.js';
import { detectRequiredSkills, buildDynamicPrompt } from './prompts/skillPrompts.js';

// Azure OpenAI configuration
const AZURE_ENDPOINT = 'https://wsilveira-aviator-agent-resource.cognitiveservices.azure.com/';
const AZURE_API_KEY = '3WTAV9zLUKRMnJqjlxLeZIxUkZPuqfu1flHv2oarcefXMk5mcqZRJQQJ99CBACfhMk5XJ3w3AAAAACOGkMK9';

const client = new AzureOpenAI({
  endpoint: AZURE_ENDPOINT,
  apiKey: AZURE_API_KEY,
  apiVersion: '2024-12-01-preview'
});

// Combine skills and tools into function definitions for OpenAI
function getFunctionDefinitions() {
  const skills = getSkillDefinitions().map(s => ({
    type: 'function',
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters
    }
  }));
  
  const tools = getToolDefinitions().map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
  
  return [...skills, ...tools];
}

// Base system prompt (lightweight - skills loaded on demand)
const BASE_SYSTEM_PROMPT = `You are the ${agentConfig.name}.

${agentConfig.description}

## Newsletter Structure
1. Table of Contents
2. Ace Aviator of the Month - Q&A interview with featured community member
3. News from Product Group - Tech Community blog posts about Logic Apps
4. News from Community - Community-contributed articles and videos

## Guardrails
${agentConfig.guardrails.map(g => `- ${g}`).join('\n')}

When generating newsletter sections, use markdown code blocks with \`\`\`html to format HTML output.

## Available Skills
- **Ace Aviator**: Create Q&A section from email (say "ace aviator" or "aviator of the month")
- **Product Group**: Scrape Tech Community blog posts (say "product group" or "blog posts")
- **Community News**: Process LinkedIn activity URLs (say "community" or "linkedin")
- **Date Window**: Calculate PST date range (say "date window" or "time frame")

When the user requests a specific section, I will load the detailed instructions for that skill.
`;

// Execute a function call (skill or tool)
async function executeFunction(name, args) {
  try {
    // Check if it's a skill
    const skillDefs = getSkillDefinitions();
    if (skillDefs.some(s => s.name === name)) {
      return await executeSkill(name, args);
    }
    
    // Check if it's a tool
    const toolDefs = getToolDefinitions();
    if (toolDefs.some(t => t.name === name)) {
      return await executeTool(name, args);
    }
    
    return { error: `Unknown function: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

// Chat with Azure OpenAI using tools
async function chat(messages, systemPrompt) {
  const response = await client.chat.completions.create({
    model: 'model-router',
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    tools: getFunctionDefinitions(),
    tool_choice: 'auto'
  });
  
  return response;
}

// Process a single turn of conversation
async function processTurn(messages, systemPrompt) {
  let response = await chat(messages, systemPrompt);
  let message = response.choices[0].message;
  
  // Handle tool calls in a loop
  while (message.tool_calls && message.tool_calls.length > 0) {
    messages.push(message);
    
    for (const toolCall of message.tool_calls) {
      console.log(`\n[Calling ${toolCall.function.name}...]`);
      const args = JSON.parse(toolCall.function.arguments);
      const result = await executeFunction(toolCall.function.name, args);
      
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result, null, 2)
      });
    }
    
    response = await chat(messages, systemPrompt);
    message = response.choices[0].message;
  }
  
  return message.content || '';
}

// Interactive REPL
async function startInteractive() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${agentConfig.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log('\nI can help you create the Logic Apps Aviators Newsletter.');
  console.log('Commands: /help, /template, /quit\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const messages = [];
  let loadedSkills = []; // Track which skill prompts have been loaded
  
  const prompt = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }
      
      // Handle commands
      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('Disconnecting MCP servers...');
        await disconnectMCP().catch(() => {});
        await disconnectEmailMCP().catch(() => {});
        console.log('Goodbye!');
        rl.close();
        return;
      }
      
      if (trimmed === '/help') {
        console.log(`
Available commands:
  /help      - Show this help
  /template  - Show newsletter HTML template
  /login     - Login to LinkedIn (required for scraping)
  /mcp       - Connect to Playwright MCP and list tools
  /email     - Connect to EmailCompanion MCP and list tools
  /quit      - Exit the agent

You can ask me to:
  - Create the Ace Aviator section (fetch email by subject or paste Q&A)
  - Create the Product Group section (I'll filter by date window)
  - Create the Community section (provide LinkedIn activity URLs)
  - Navigate to a URL and scrape content (uses Playwright MCP)
  - Fetch an email by subject (uses EmailCompanion MCP)
  - Compute the date window for a month
`);
        prompt();
        return;
      }
      
      if (trimmed === '/login') {
        console.log('\nChecking LinkedIn storage...');
        const check = isStorageValid();
        if (check.valid) {
          console.log(`✅ Storage is valid with ${check.cookieCount} LinkedIn cookies.`);
          console.log('You can proceed with scraping. Use /mcp to connect.\n');
        } else {
          console.log(`⚠️  ${check.reason}`);
          console.log('\nStarting LinkedIn login...');
          console.log('A browser will open. Log in to LinkedIn, then press Enter here.\n');
          try {
            await runLinkedInLogin();
            console.log('✅ Login successful! You can now use /mcp to connect.\n');
          } catch (err) {
            console.error(`Login failed: ${err.message}\n`);
          }
        }
        prompt();
        return;
      }
      
      if (trimmed === '/mcp') {
        console.log('\nChecking LinkedIn storage...');
        const check = isStorageValid();
        if (!check.valid) {
          console.log(`⚠️  ${check.reason}`);
          console.log('Run /login first to authenticate with LinkedIn.\n');
          prompt();
          return;
        }
        console.log(`✅ Storage valid with ${check.cookieCount} LinkedIn cookies.`);
        console.log('Connecting to Playwright MCP...');
        try {
          await connectToPlaywrightMCP({ headless: false });
          const tools = await listMCPTools();
          console.log('\nAvailable MCP Tools:');
          tools.forEach(t => console.log(`  - ${t.name}: ${t.description?.substring(0, 60)}...`));
          console.log('');
        } catch (err) {
          console.error(`Failed to connect: ${err.message}`);
        }
        prompt();
        return;
      }
      
      if (trimmed === '/email') {
        console.log('\nConnecting to EmailCompanion MCP...');
        try {
          await connectToEmailMCP();
          const tools = await listEmailMCPTools();
          console.log('\nAvailable Email MCP Tools:');
          tools.forEach(t => console.log(`  - ${t.name}: ${t.description?.substring(0, 60)}...`));
          console.log('');
        } catch (err) {
          console.error(`Failed to connect: ${err.message}`);
        }
        prompt();
        return;
      }
      
      if (trimmed === '/template') {
        console.log('\nNewsletter Template:\n');
        console.log(getNewsletterTemplate());
        console.log('');
        prompt();
        return;
      }
      
      // Chat with the agent
      messages.push({ role: 'user', content: trimmed });
      
      // Detect required skills for this message and accumulate
      const requiredSkills = detectRequiredSkills(trimmed);
      const newSkills = requiredSkills.filter(s => !loadedSkills.includes(s));
      if (newSkills.length > 0) {
        console.log(`[Loading skill prompts: ${newSkills.join(', ')}]`);
        loadedSkills = [...loadedSkills, ...newSkills];
      }
      
      // Build dynamic system prompt
      const dynamicPrompt = buildDynamicPrompt(BASE_SYSTEM_PROMPT, loadedSkills);
      
      try {
        const response = await processTurn(messages, dynamicPrompt);
        console.log(`\nAgent: ${response}\n`);
        messages.push({ role: 'assistant', content: response });
      } catch (err) {
        console.error(`\nError: ${err.message}\n`);
        if (err.status === 401 || err.message.includes('API key') || err.message.includes('Unauthorized')) {
          console.log('Authentication failed. Check your Azure API key.');
          rl.close();
          return;
        }
      }
      
      prompt();
    });
  };
  
  prompt();
}

// Run if called directly
startInteractive().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
