require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'CodeSage server is running' });
});

// Main AI route — streams response from Groq back to browser
app.post('/api/analyze', async (req, res) => {
  const { prompt, code, action } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'No action provided' });
  }

  // Validate input (custom questions may omit code)
  if (action !== 'custom' && (!code || code.trim() === '')) {
    return res.status(400).json({ error: 'No code provided' });
  }

  // Build the system prompt based on action
  const systemPrompts = {
    explain: 'You are a code explainer. Explain this code in simple english. Format: 1) Purpose (1 sentence) 2) How it works (max 4 bullet points, each one line) 3) Issues (max 2 bullets). Be concise.',

    refactor: 'You are a code refactorer. Fix ALL issues: SQL injection must use parameterized queries, add error handling, remove sensitive data exposure, use modern syntax. Show the complete improved code in one code block. Then list changes in max 4 bullet points.',

    bugs: 'You are a code debugger. Respond in EXACTLY this format, no exceptions:\n\n🔴 CRITICAL (security/crashes):\n- issue: fix\n\n🟡 WARNING (runtime errors):\n- issue: fix\n\n🔵 SUGGESTION (improvements):\n- issue: fix\n\nMax 3 items per category. Skip empty categories. Never call style issues bugs.',

    tests: 'You are a test writer. Write practical tests using pytest for Python, Jest for JavaScript, PHPUnit for PHP. Cover: happy path, one error case, one edge case. Keep each test short. Show complete runnable test file.',

    improve: 'You are a code reviewer. Give exactly 4 improvements. Format each as: **Title** - one line description, then show only the specific improved code snippet. No long paragraphs.',

    animate: 'You are a code execution visualizer. Return ONLY valid JSON. Zero text outside JSON. Zero markdown. Zero backticks. Structure: {"steps":[{"lineNumbers":[1],"explanation":"plain english, max 20 words","variables":[{"name":"x","value":"10","type":"number","isNew":true}],"callStack":[{"name":"main","isActive":true}],"status":"normal"}]}. CRITICAL: The user message states the exact line count N — you MUST return exactly N steps in order. Step 1 covers line 1 only (lineNumbers:[1]), step 2 covers line 2 only (lineNumbers:[2]), etc. Never skip, merge, or group lines. Every line gets its own step from first to last. For complex values use short strings like "[n items]" or "{n keys}". Status: normal, highlight, error, or return. Always valid JSON.'
  };

  const tokenLimits = {
    explain: 500,
    refactor: 900,
    bugs: 600,
    tests: 900,
    improve: 700,
    animate: 1200
  };

  const systemMessage = systemPrompts[action] || systemPrompts.explain;

  let userMessage;
  if (action === 'custom' && prompt) {
    userMessage = prompt;
  } else if (action === 'animate') {
    const codeLines = code.split('\n');
    const numbered = codeLines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    userMessage = `This code has exactly ${codeLines.length} lines. Generate exactly ${codeLines.length} animation steps — one step per line, sequential, no skipping.\n\n${numbered}`;
  } else {
    userMessage = `Here is the code to analyze:\n\n\`\`\`\n${code}\n\`\`\``;
  }

  const animateTokenLimit = action === 'animate'
    ? Math.min(4000, Math.max(1200, code.split('\n').length * 140))
    : (tokenLimits[action] || 800);

  // Set headers for Server-Sent Events streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        max_tokens: animateTokenLimit,
        temperature: 0.2,
        stream: true
      })
    });

    if (!groqResponse.ok) {
      const errorBody = await groqResponse.text();
      console.error('Groq API error:', groqResponse.status, errorBody);
      res.write(`data: ${JSON.stringify({ error: 'Groq API error: ' + groqResponse.status })}\n\n`);
      res.end();
      return;
    }

    // Stream Groq response to the browser
    const reader = groqResponse.body;
    let buffer = '';

    reader.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
          }
        } catch (e) {
          // Skip malformed chunks
        }
      }
    });

    reader.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    reader.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Server error:', err);
    res.write(`data: ${JSON.stringify({ error: 'Server error: ' + err.message })}\n\n`);
    res.end();
  }
});

// Catch-all: serve index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ CodeSage server running at http://localhost:${PORT}`);
  console.log(`   Groq API key loaded: ${process.env.GROQ_API_KEY ? 'YES ✓' : 'NO ✗ — check your .env file'}`);
});
