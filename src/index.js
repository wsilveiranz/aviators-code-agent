/**
 * Logic Apps Aviators Newsletter Agent
 * Entry point
 */

import { 
  agentConfig, 
  skills, 
  tools, 
  getNewsletterTemplate,
  executeSkill,
  executeTool,
  getSkillDefinitions,
  getToolDefinitions
} from './agent.js';

/**
 * Display agent information
 */
function showInfo() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${agentConfig.name} v${agentConfig.version}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n${agentConfig.description}\n`);
  
  console.log('Available Skills:');
  Object.values(skills).forEach(skill => {
    console.log(`  - ${skill.name}: ${skill.description}`);
  });
  
  console.log('\nAvailable Tools:');
  Object.values(tools).forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
  
  console.log('\nNewsletter Structure:');
  agentConfig.structure.forEach((section, i) => {
    console.log(`  ${i + 1}. ${section.name}${section.skill ? ` (${section.skill})` : ''}`);
  });
  
  console.log('\nGuardrails:');
  agentConfig.guardrails.forEach(rule => {
    console.log(`  • ${rule}`);
  });
  
  console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * Interactive mode - demonstrates skill execution
 */
async function runDemo() {
  console.log('Running demo...\n');
  
  // Demo: Compute date window
  console.log('1. Computing date window for February 2026:');
  const dateWindow = await executeSkill('computeDateWindow', { month: 'February 2026' });
  console.log(JSON.stringify(dateWindow, null, 2));
  
  // Demo: Show skill/tool definitions (for LLM integration)
  console.log('\n2. Skill definitions for LLM:');
  console.log(JSON.stringify(getSkillDefinitions(), null, 2));
  
  console.log('\n3. Tool definitions for LLM:');
  console.log(JSON.stringify(getToolDefinitions(), null, 2));
  
  console.log('\nDemo complete.');
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showInfo();
  console.log('Usage:');
  console.log('  node src/index.js           Show agent info');
  console.log('  node src/index.js --demo    Run demonstration');
  console.log('  node src/index.js --help    Show this help');
  process.exit(0);
}

if (args.includes('--demo')) {
  runDemo().catch(err => {
    console.error('Demo failed:', err);
    process.exit(1);
  });
} else {
  showInfo();
}

// Export for programmatic use
export {
  agentConfig,
  skills,
  tools,
  getNewsletterTemplate,
  executeSkill,
  executeTool,
  getSkillDefinitions,
  getToolDefinitions
};
