const assert = require('node:assert/strict');
const test = require('node:test');

const chat = require('../api/chat');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
}

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

test('chat completion settings leave room for multi-species comparison answers', () => {
  assert.equal(chat._test.CHAT_MAX_TOKENS, 700);
});

test('chat handler rejects unexpected browser origins before doing model work', async () => {
  const req = {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: {
      messages: [{ role: 'user', content: 'hello' }],
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = createMockRes();

  await chat(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Origin not allowed' });
  assert.equal(res.headers.Vary, 'Origin');
});

test('chat handler uses prompt caching and strips extra client fields before forwarding', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const fetchCalls = [];

  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (String(url).includes('api.anthropic.com')) {
      return {
        ok: true,
        async json() {
          return { content: [{ text: 'stubbed reply' }] };
        },
      };
    }

    return {
      ok: true,
      async text() {
        return '<html><body><main>Black Barrel site content for testing.</main></body></html>';
      },
    };
  };

  try {
    const req = {
      method: 'POST',
      headers: { origin: 'https://www.blackbarrelwoodco.com' },
      body: {
        messages: [
          { role: 'user', content: 'Tell me about walnut.', injected: 'ignore me' },
          { role: 'assistant', content: 'Sure.', cache_control: { type: 'ephemeral' } },
        ],
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = createMockRes();

    await chat(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { reply: 'stubbed reply' });
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://www.blackbarrelwoodco.com');

    const anthropicCall = fetchCalls.find((call) => String(call.url).includes('api.anthropic.com'));
    assert.ok(anthropicCall, 'expected Anthropic API call');

    const payload = JSON.parse(anthropicCall.options.body);
    assert.deepEqual(payload.messages, [
      { role: 'user', content: 'Tell me about walnut.' },
      { role: 'assistant', content: 'Sure.' },
    ]);
    assert.deepEqual(payload.system, [
      {
        type: 'text',
        text: payload.system[0].text,
        cache_control: { type: 'ephemeral' },
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  }
});
