import {
  aceAviatorSkill,
  extractLinkedIn,
  extractName,
  generateHTML as generateAceAviatorHTML,
  parseQAPairs,
} from '../src/core/aceAviator.js';
import { sampleAceAviatorEmail } from './sampleData.js';

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
    throw new Error(`${message}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

function assertTrue(actual: unknown, message: string): asserts actual {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

console.log('\n=== Ace Aviator Email Parsing Tests ===\n');

let passed = 0;
let failed = 0;
const emailBody = sampleAceAviatorEmail.emails[0].body;

if (test('Should extract LinkedIn profile URL', () => {
  assertEqual(
    extractLinkedIn(emailBody),
    'https://www.linkedin.com/in/camilla-bielk-0481411',
    'LinkedIn URL',
  );
})) passed += 1; else failed += 1;

if (test('Should extract name from email', () => {
  assertEqual(extractName(emailBody), 'Camilla Bielk', 'Name');
})) passed += 1; else failed += 1;

if (test('Should parse all canonical Q&A pairs from email', () => {
  assertEqual(parseQAPairs(emailBody).length, 6, 'Q&A pair count');
})) passed += 1; else failed += 1;

if (test('Should parse first question about role', () => {
  const qa = parseQAPairs(emailBody);
  assertTrue(qa[0], 'Should have a first question');
  assertTrue(qa[0].question.toLowerCase().includes('role'), 'First question should be about role');
  assertTrue(qa[0].answer.includes('Camilla Bielk'), 'Answer should contain the name');
})) passed += 1; else failed += 1;

if (test('Should capture multi-line advice answers', () => {
  const qa = parseQAPairs(emailBody);
  const advice = qa.find((pair) => pair.question.toLowerCase().includes('advice'));
  assertTrue(advice, 'Should have advice question');
  assertTrue(advice.answer.length > 50, 'Advice answer should be substantial');
})) passed += 1; else failed += 1;

if (test('Should escape untrusted Ace Aviator content', () => {
  const html = generateAceAviatorHTML({
    month: 'March <script>alert(1)</script>',
    name: 'Alex "Ace" <Admin>',
    linkedin: 'https://example.com/profile?a=1&b=2',
    imageUrl: 'https://example.com/photo.png?size=1&crop=2',
    qaPairs: [{
      question: 'What <em>changed</em>?',
      answer: 'First line\n<script>alert(2)</script>',
    }],
  });

  assertTrue(html.includes('March &lt;script&gt;'), 'Month should be escaped');
  assertTrue(html.includes('Alex &quot;Ace&quot; &lt;Admin&gt;'), 'Name should be escaped');
  assertTrue(html.includes('profile?a=1&amp;b=2'), 'Link attribute should be escaped');
  assertTrue(html.includes('First line<br>&lt;script&gt;'), 'Answer should be escaped while preserving line breaks');
  assertTrue(!html.includes('<script>'), 'Should not include executable script markup');
})) passed += 1; else failed += 1;

if (test('Should omit invalid Ace Aviator URLs', () => {
  const html = generateAceAviatorHTML({
    month: 'March 2026',
    name: 'Alex',
    linkedin: 'javascript:alert(1)',
    imageUrl: 'data:image/png;base64,abc',
    qaPairs: [{ question: 'Question', answer: 'Answer' }],
  });

  assertTrue(!html.includes('href='), 'Invalid LinkedIn URL should be omitted');
  assertTrue(!html.includes('<li-image'), 'Invalid image URL should be omitted');
})) passed += 1; else failed += 1;

async function runSkillTest(): Promise<void> {
  const result = await aceAviatorSkill.execute({
    month: 'February 2026',
    emailBody,
    name: 'Camilla Bielk',
    linkedin: extractLinkedIn(emailBody) ?? undefined,
  });

  if (test('Should generate the Ace Aviator section through the core skill', () => {
    assertTrue(result.success, 'Skill should succeed');
    assertTrue(result.html.includes('<h1 id="aceaviator">'), 'Should contain the section heading');
    assertEqual(result.qaPairsCount, 6, 'Generated Q&A pair count');
  })) passed += 1; else failed += 1;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) process.exitCode = 1;
}

void runSkillTest();
