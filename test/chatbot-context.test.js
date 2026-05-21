const assert = require('node:assert/strict');
const test = require('node:test');

const chat = require('../api/chat');

test('buildFaqContext exposes the CSV knowledge base to the chatbot prompt', () => {
  assert.equal(typeof chat._test.buildFaqContext, 'function');

  const faqContext = chat._test.buildFaqContext();

  assert.match(faqContext, /Furniture styles/i);
  assert.match(faqContext, /Mid-century/i);
  assert.match(faqContext, /Modern Rustic/i);
  assert.match(faqContext, /custom work uses premium materials and craftsmanship/i);
  assert.match(faqContext, /Red Oak/i);
  assert.match(faqContext, /White Oak/i);
  assert.match(faqContext, /50% deposit/i);
});

test('buildSystemPrompt includes buying guidance and FAQ context', () => {
  assert.equal(typeof chat._test.buildSystemPrompt, 'function');

  const prompt = chat._test.buildSystemPrompt({
    webContent: 'Website scrape placeholder',
    faqContent: 'FAQ knowledge placeholder',
  });

  assert.match(prompt, /CUSTOM BUYING GUIDANCE/i);
  assert.match(prompt, /styles/i);
  assert.match(prompt, /off-the-shelf/i);
  assert.match(prompt, /FAQ knowledge placeholder/);
  assert.match(prompt, /Website scrape placeholder/);
});
