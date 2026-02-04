/**
 * Test script for Product Group skill
 * Run with: node src/test-productGroup.js
 */

import { productGroupSkill } from './skills/productGroup.js';
import { computeDateWindow } from './skills/dateWindow.js';

// Test data with various date formats (as LLM might provide)
const testPosts = [
  {
    title: "Logic Apps Aviators Newsletter - February 2026",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/logic-apps-aviators-newsletter---february-2026/4491309",
    publishedAt: "Feb 02, 2026",  // Format from scraped page
    summary: "In this issue: Ace Aviator of the Month News from our product group News from our community..."
  },
  {
    title: "Introducing Unit Test Agent Profiles for Logic Apps & Data Maps",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/introducing-unit-test-agent-profiles-for-logic-apps--data-maps/4490216",
    publishedAt: "Jan 28, 2026",
    summary: "I did some experimentation this week with GitHub Copilot custom agents and custom prompts..."
  },
  {
    title: "Automated Test Framework - Missing Tests in Test Explorer",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/automated-test-framework---missing-tests-in-test-explorer/4490186",
    publishedAt: "2026-01-28",  // ISO format
    summary: "Have your tests created using the Logic Apps Standard Automated Test Framework disappeared..."
  },
  {
    title: "Upcoming Agentic Azure Logic Apps Workshops",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/upcoming-agentic-azure-logic-apps-workshops/4484526",
    date: "Jan 09, 2026",  // Alternative field name
    excerpt: "Join me for a couple of upcoming workshops where you can learn about Logic Apps MCP Servers..."
  },
  {
    title: "Logic Apps Aviators Newsletter - January 2026",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/logic-apps-aviators-newsletter---january-2026/4482877",
    publishedAt: "January 5, 2026",  // Full month name
    summary: "In this issue: Ace Aviator of the Month News from our product group Community Playbook..."
  },
  {
    title: "Microsoft BizTalk Server Product Lifecycle Update",
    link: "https://techcommunity.microsoft.com/blog/integrationsonazureblog/microsoft-biztalk-server-product-lifecycle-update/4478559",
    publishedAt: "Dec 17, 2025",
    summary: "For more than 25 years, Microsoft BizTalk Server has supported mission-critical integration..."
  }
];

async function runTests() {
  console.log('='.repeat(60));
  console.log('Product Group Skill Tests (with varied date formats)');
  console.log('='.repeat(60));

  // Test 1: Date window computation
  console.log('\n--- Test 1: Date Window for February 2026 ---');
  const dateWindow = computeDateWindow('February 2026');
  console.log('Start PST:', dateWindow.startPST);
  console.log('End PST:', dateWindow.endPST);

  // Test 2: Run the full skill with varied formats
  console.log('\n--- Test 2: Full Skill Execution (varied date formats) ---');
  const result = await productGroupSkill.execute({
    month: 'February 2026',
    posts: testPosts
  });
  
  console.log('Success:', result.success);
  console.log('Total Posts:', result.totalPosts);
  console.log('Filtered Count:', result.filteredCount);
  console.log('\nFiltered Posts:');
  result.posts.forEach(p => {
    console.log(`  - ${p.title}`);
    console.log(`    Date: ${p.publishedAt}`);
  });
  
  if (result.filteredCount === 0) {
    console.log('\n⚠️  WARNING: No posts passed the filter!');
  } else {
    console.log('\n✅ Skill working correctly with varied date formats!');
  }

  console.log('\n--- Generated HTML Preview ---');
  console.log(result.html.substring(0, 500) + '...');

  console.log('\n' + '='.repeat(60));
}

runTests().catch(console.error);
