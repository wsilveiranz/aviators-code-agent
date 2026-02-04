/**
 * Tests for Ace Aviator email parsing and HTML generation
 */

import { sampleAceAviatorEmail } from './sampleData.js';

/**
 * Parse Q&A from email body
 * Extracts question-answer pairs from the email content
 */
function parseAceAviatorEmail(emailBody) {
  const qa = [];
  
  // Look for patterns like:
  // **Question?**
  // Answer text
  // OR
  // Q: Question?
  // A: Answer text
  
  const lines = emailBody.split('\n');
  let currentQ = null;
  let currentA = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match bold questions: **What is your name?**
    const boldQMatch = line.match(/^\*\*([^*]+\?)\*\*$/);
    if (boldQMatch) {
      // Save previous Q&A
      if (currentQ && currentA.length > 0) {
        qa.push({ question: currentQ, answer: currentA.join(' ').trim() });
      }
      currentQ = boldQMatch[1];
      currentA = [];
      continue;
    }
    
    // Match Q: format
    const qMatch = line.match(/^Q:\s*(.+\?)$/i);
    if (qMatch) {
      if (currentQ && currentA.length > 0) {
        qa.push({ question: currentQ, answer: currentA.join(' ').trim() });
      }
      currentQ = qMatch[1];
      currentA = [];
      continue;
    }
    
    // Collect answer lines (skip empty lines at start)
    if (currentQ && line.length > 0) {
      // Skip lines that look like metadata
      if (!line.startsWith('**') && !line.match(/^(Best|Regards|Thanks|Cheers)/i)) {
        currentA.push(line);
      }
    }
  }
  
  // Save last Q&A
  if (currentQ && currentA.length > 0) {
    qa.push({ question: currentQ, answer: currentA.join(' ').trim() });
  }
  
  return qa;
}

/**
 * Extract LinkedIn profile from email
 */
function extractLinkedIn(emailBody) {
  const match = emailBody.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\s]+/i);
  return match ? match[0].replace(/\/$/, '') : null;
}

/**
 * Extract name from email content
 */
function extractName(emailBody) {
  // Look for patterns like "Camilla Bielk, Senior..." or in Q&A answers
  // First try: Name followed by title/role
  let match = emailBody.match(/([A-Z][a-z]+\s+[A-Z][a-z]+),\s*(?:Senior|Integration|Architect|Developer|Engineer|Manager|Lead|Principal)/i);
  if (match) return match[1];
  
  // Second try: After "name" in Q&A context
  match = emailBody.match(/(?:my name is|I'm|I am)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
  if (match) return match[1];
  
  return null;
}

// ========== TESTS ==========

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    return false;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(actual, message) {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

console.log('\n=== Ace Aviator Email Parsing Tests ===\n');

let passed = 0;
let failed = 0;

const emailBody = sampleAceAviatorEmail.emails[0].body;

// Test 1: Extract LinkedIn URL
if (test('Should extract LinkedIn profile URL', () => {
  const linkedin = extractLinkedIn(emailBody);
  assertEqual(linkedin, 'https://www.linkedin.com/in/camilla-bielk-0481411', 'LinkedIn URL');
})) passed++; else failed++;

// Test 2: Extract name
if (test('Should extract name from email', () => {
  const name = extractName(emailBody);
  assertEqual(name, 'Camilla Bielk', 'Name');
})) passed++; else failed++;

// Test 3: Parse Q&A pairs
if (test('Should parse Q&A pairs from email', () => {
  const qa = parseAceAviatorEmail(emailBody);
  assertTrue(qa.length >= 4, 'Should have at least 4 Q&A pairs');
})) passed++; else failed++;

// Test 4: First question should be about name/role
if (test('Should parse first question about name and role', () => {
  const qa = parseAceAviatorEmail(emailBody);
  assertTrue(qa[0].question.toLowerCase().includes('name'), 'First question should be about name');
  assertTrue(qa[0].answer.includes('Camilla Bielk'), 'Answer should contain the name');
})) passed++; else failed++;

// Test 5: Should capture multi-line answers
if (test('Should capture advice answer', () => {
  const qa = parseAceAviatorEmail(emailBody);
  const adviceQ = qa.find(q => q.question.toLowerCase().includes('advice'));
  assertTrue(adviceQ, 'Should have advice question');
  assertTrue(adviceQ.answer.length > 50, 'Advice answer should be substantial');
})) passed++; else failed++;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

// Export for use
export { parseAceAviatorEmail, extractLinkedIn, extractName };
