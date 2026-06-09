// ===== State =====
let isLoading = false;
let editorContent = '';

// ===== Action Metadata =====
const actionMeta = {
  explain: { label: 'Explanation', tagClass: 'tag-explain' },
  refactor: { label: 'Refactored code', tagClass: 'tag-refactor' },
  bugs: { label: 'Bug report', tagClass: 'tag-bugs' },
  tests: { label: 'Unit tests', tagClass: 'tag-tests' },
  improve: { label: 'Suggestions', tagClass: 'tag-improve' },
  animate: { label: 'Code walkthrough', tagClass: 'tag-animate' },
  custom: { label: 'Answer', tagClass: 'tag-custom' }
};

// ===== Language to filename mapping =====
const langFilename = {
  javascript: 'main.js',
  python: 'main.py',
  php: 'index.php',
  typescript: 'main.ts',
  html: 'index.html',
  css: 'styles.css',
  sql: 'query.sql',
  java: 'Main.java',
  cpp: 'main.cpp'
};

// ===== Default starter code =====
const defaultCode = `// Welcome to CodeSage!
// Paste your code here or start writing.
// Then click Explain, Refactor, Find Bugs, Write Tests, or Improve.

function fetchUserData(userId) {
  fetch('/api/users/' + userId)
    .then(res => res.json())
    .then(data => {
      document.getElementById('name').innerHTML = data.name;
      document.getElementById('email').innerHTML = data.email;
    })
}

fetchUserData(getUserFromCookie());`;

// ===== Simple textarea-based editor (fallback if CodeMirror fails) =====
function initSimpleEditor() {
  const container = document.getElementById('editor-container');
  container.innerHTML = '';

  const textarea = document.createElement('textarea');
  textarea.id = 'simple-editor';
  textarea.value = defaultCode;
  textarea.spellcheck = false;
  textarea.style.cssText = `
    width: 100%;
    height: 100%;
    background: #0d1117;
    color: #e6edf3;
    border: none;
    outline: none;
    padding: 16px;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    resize: none;
    tab-size: 2;
  `;

  textarea.addEventListener('input', () => {
    editorContent = textarea.value;
    updateEditorMeta(textarea.value);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }
  });

  container.appendChild(textarea);
  editorContent = defaultCode;
  updateEditorMeta(defaultCode);

  return { getValue: () => textarea.value, setValue: (v) => { textarea.value = v; editorContent = v; updateEditorMeta(v); } };
}

// ===== Initialize Editor =====
let editor = initSimpleEditor();

// ===== Update file meta (line count, char count) =====
function updateEditorMeta(value) {
  const lines = value.split('\n').length;
  const chars = value.length;
  document.getElementById('line-count').textContent = lines + ' lines';
  document.getElementById('char-count').textContent = chars + ' chars';
}

// ===== Language selector =====
document.getElementById('lang-select').addEventListener('change', (e) => {
  const lang = e.target.value;
  document.getElementById('filename-label').textContent = langFilename[lang] || 'main.' + lang;
});

// ===== Clear button =====
document.getElementById('clear-btn').addEventListener('click', () => {
  editor.setValue('');
  document.getElementById('response-output').style.display = 'none';
  document.getElementById('placeholder').style.display = 'block';
});

// ===== Action buttons =====
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    runAnalysis(action);
  });
});

// ===== Custom input =====
document.getElementById('custom-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runCustomQuery();
  }
});

document.getElementById('send-btn').addEventListener('click', runCustomQuery);

function runCustomQuery() {
  const input = document.getElementById('custom-input');
  const question = input.value.trim();
  if (!question || isLoading) return;
  input.value = '';
  runAnalysis('custom', question);
}

// ===== Set loading state =====
function setLoading(loading) {
  isLoading = loading;
  const dot = document.getElementById('status-dot');
  const sendBtn = document.getElementById('send-btn');

  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.disabled = loading;
    if (loading) btn.classList.add('loading');
    else btn.classList.remove('loading');
  });

  dot.className = 'status-dot' + (loading ? ' thinking' : '');
  sendBtn.disabled = loading;
}

// ===== Show error =====
function showError(message) {
  const output = document.getElementById('response-output');
  const placeholder = document.getElementById('placeholder');

  placeholder.style.display = 'none';
  output.style.display = 'block';
  output.innerHTML = `<div class="error-msg">⚠️ ${message}</div>`;
}

// ===== Markdown to HTML (simple parser) =====
function markdownToHtml(text) {
  let html = '';
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBuffer = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += '<pre>' + escapeHtml(codeBuffer) + '</pre>';
        codeBuffer = '';
        inCodeBlock = false;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer += line + '\n';
      continue;
    }

    // Close list if needed
    if (!line.startsWith('- ') && !line.startsWith('* ') && !line.match(/^\d+\. /) && inList) {
      html += '</ul>';
      inList = false;
    }

    // Headings
    if (line.startsWith('### ')) {
      html += '<h3>' + inlineFormat(line.slice(4)) + '</h3>';
    } else if (line.startsWith('## ')) {
      html += '<h2>' + inlineFormat(line.slice(3)) + '</h2>';
    } else if (line.startsWith('# ')) {
      html += '<h1>' + inlineFormat(line.slice(2)) + '</h1>';
    }
    // Lists
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineFormat(line.slice(2)) + '</li>';
    }
    else if (line.match(/^\d+\. /)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineFormat(line.replace(/^\d+\. /, '')) + '</li>';
    }
    // Empty line
    else if (line.trim() === '') {
      html += '<br>';
    }
    // Normal paragraph
    else {
      html += '<p>' + inlineFormat(line) + '</p>';
    }
  }

  if (inCodeBlock && codeBuffer) {
    html += '<pre>' + escapeHtml(codeBuffer) + '</pre>';
  }
  if (inList) html += '</ul>';

  return html;
}

function inlineFormat(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inferLineStatus(line) {
  const trimmed = line.trim();
  if (!trimmed) return 'normal';
  if (/\breturn\b/.test(trimmed)) return 'return';
  if (/\b(raise|throw|except|catch)\b/.test(trimmed)) return 'error';
  if (/^(if|elif|else|while|for|switch|case)\b/.test(trimmed)) return 'highlight';
  return 'normal';
}

function fallbackExplanation(line, lineNum) {
  const trimmed = line.trim();
  if (!trimmed) return `Line ${lineNum}: blank line — execution continues.`;
  if (/^(\/\/|#)/.test(trimmed)) return `Line ${lineNum}: comment — not executed.`;
  if (/^(def |function |class |const |let |var |import |from )/.test(trimmed)) {
    return `Line ${lineNum}: declares or imports — ${trimmed}`;
  }
  if (/\(/.test(trimmed) && /def |function /.test(trimmed)) {
    return `Line ${lineNum}: defines a callable block.`;
  }
  if (/\(.*\)/.test(trimmed) && !/^(if|while|for|elif)/.test(trimmed)) {
    return `Line ${lineNum}: calls or evaluates — ${trimmed}`;
  }
  return `Line ${lineNum}: ${trimmed}`;
}

function normalizeAnimationSteps(aiSteps, codeLines) {
  const totalLines = codeLines.length;
  const byLine = new Map();

  (aiSteps || []).forEach((step, idx) => {
    const lineNums = step.lineNumbers?.length ? step.lineNumbers : [idx + 1];
    lineNums.forEach((n) => {
      if (n >= 1 && n <= totalLines && !byLine.has(n)) {
        byLine.set(n, { ...step, lineNumbers: [n] });
      }
    });
  });

  if (byLine.size < totalLines && aiSteps?.length === totalLines) {
    aiSteps.forEach((step, idx) => {
      byLine.set(idx + 1, { ...step, lineNumbers: [idx + 1] });
    });
  }

  let lastVariables = [];
  let lastCallStack = [{ name: 'main', isActive: true }];

  return codeLines.map((line, i) => {
    const lineNum = i + 1;
    const aiStep = byLine.get(lineNum);

    if (aiStep) {
      if (aiStep.variables) lastVariables = aiStep.variables;
      if (aiStep.callStack) lastCallStack = aiStep.callStack;
      return {
        lineNumbers: [lineNum],
        explanation: aiStep.explanation || fallbackExplanation(line, lineNum),
        variables: aiStep.variables ? [...aiStep.variables] : [...lastVariables],
        callStack: aiStep.callStack ? [...aiStep.callStack] : [...lastCallStack],
        status: aiStep.status || inferLineStatus(line)
      };
    }

    return {
      lineNumbers: [lineNum],
      explanation: fallbackExplanation(line, lineNum),
      variables: [...lastVariables],
      callStack: [...lastCallStack],
      status: inferLineStatus(line)
    };
  });
}

function renderAnimation(rawText, codeLines) {
  let parsed;
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch(e) {
    showError('Could not parse animation. Try again.');
    return;
  }

  const steps = normalizeAnimationSteps(parsed.steps, codeLines);
  if (!steps || steps.length === 0) {
    showError('No animation steps returned.');
    return;
  }

  let current = 0;
  let autoTimer = null;

  const statusColors = {
    normal: '#58a6ff',
    highlight: '#f0883e',
    error: '#f85149',
    return: '#3fb950'
  };

  function renderCodeLines(activeLines, doneLines) {
    return codeLines.map((line, i) => {
      const lineNum = i + 1;
      let cls = 'anim-line';
      if (activeLines.includes(lineNum)) cls += ' active';
      else if (doneLines.includes(lineNum)) cls += ' done';
      return `<span class="${cls}">${String(lineNum).padStart(2, ' ')}  ${escapeHtml(line)}</span>`;
    }).join('');
  }

  function renderVariables(variables) {
    if (!variables || variables.length === 0) {
      return '<div style="color:#6e7681;font-size:12px;">No variables in scope</div>';
    }
    return variables.map(v => `
      <div class="variable-row ${v.isNew ? 'var-row-new' : ''}">
        <span class="var-name">${escapeHtml(v.name)}</span>
        <span class="var-value">${escapeHtml(String(v.value))}</span>
        <span class="var-type">${escapeHtml(v.type)}</span>
      </div>
    `).join('');
  }

  function renderCallStack(callStack) {
    if (!callStack || callStack.length === 0) {
      return '<div style="color:#6e7681;font-size:12px;">Empty</div>';
    }
    return callStack.map(frame => `
      <div class="stack-frame ${frame.isActive ? 'active' : 'inactive'}">
        <span class="frame-name">${escapeHtml(frame.name)}</span>
        ${frame.isActive ? '<span style="font-size:10px;color:#58a6ff;">● executing</span>' : ''}
      </div>
    `).join('');
  }

  function showStep(index) {
    const step = steps[index];
    const activeLines = step.lineNumbers || [];
    const doneLines = steps
      .slice(0, index)
      .flatMap(s => s.lineNumbers || []);
    const color = statusColors[step.status] || statusColors.normal;

    const output = document.getElementById('response-output');
    output.innerHTML = `
      <span class="response-tag tag-animate">Code walkthrough</span>

      <div class="animation-container">

        <div class="anim-code-block">
          ${renderCodeLines(activeLines, doneLines)}
        </div>

        <div class="explanation-box" style="border-left-color: ${color};">
          ${escapeHtml(step.explanation)}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="variables-panel">
            <div class="variables-panel-title">Variables</div>
            ${renderVariables(step.variables)}
          </div>
          <div class="callstack-panel">
            <div class="callstack-title">Call Stack</div>
            ${renderCallStack(step.callStack)}
          </div>
        </div>

        <div class="anim-controls">
          <button class="anim-btn anim-btn-prev" id="anim-prev" onclick="animPrev()" ${index === 0 ? 'disabled' : ''}>← Prev</button>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
            <span class="step-counter">Step ${index + 1} of ${steps.length}</span>
            <button class="anim-btn anim-btn-auto ${autoTimer ? 'playing' : ''}" id="anim-auto" onclick="animAuto()">
              ${autoTimer ? '⏸ Pause' : '▶ Auto'}
            </button>
          </div>
          <button class="anim-btn anim-btn-next" id="anim-next" onclick="animNext()" ${index === steps.length - 1 ? 'disabled' : ''}>Next →</button>
        </div>

        <div class="anim-progress">
          ${steps.map((s, i) => `<div class="progress-dot ${i < index ? 'done' : i === index ? 'active' : ''}"></div>`).join('')}
        </div>

      </div>
    `;
    output.scrollTop = 0;
  }

  window.animNext = function() {
    if (current < steps.length - 1) { current++; showStep(current); }
    else { clearInterval(autoTimer); autoTimer = null; }
  };

  window.animPrev = function() {
    if (current > 0) { current--; showStep(current); }
  };

  window.animAuto = function() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
      showStep(current);
    } else {
      autoTimer = setInterval(() => {
        if (current < steps.length - 1) {
          current++;
          showStep(current);
        } else {
          clearInterval(autoTimer);
          autoTimer = null;
          showStep(current);
        }
      }, 1800);
      showStep(current);
    }
  };

  showStep(0);
}

// ===== Main: Run Analysis =====
async function runAnalysis(action, customQuestion = '') {
  if (isLoading) return;

  const code = editor.getValue().trim();

  if (!code && action !== 'custom') {
    showError('Please write or paste some code in the editor first.');
    return;
  }

  if (action === 'custom' && !customQuestion) {
    showError('Please type a question first.');
    return;
  }

  setLoading(true);

  const meta = actionMeta[action] || actionMeta.custom;
  const placeholder = document.getElementById('placeholder');
  const output = document.getElementById('response-output');

  // Show response area with tag and cursor
  placeholder.style.display = 'none';
  output.style.display = 'block';
  output.innerHTML = `
    <span class="response-tag ${meta.tagClass}">${meta.label}</span><br>
    <span class="cursor-blink" id="stream-cursor"></span>
  `;

  // Build prompt for custom questions
  let prompt = customQuestion;
  if (action === 'custom' && code) {
    prompt = customQuestion + '\n\nCode context:\n```\n' + code + '\n```';
  }

  let fullText = '';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, code: code || ' ', prompt })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error ' + response.status }));
      throw new Error(err.error || 'Server error');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            fullText += parsed.text;
            if (action !== 'animate') {
              renderStream(fullText, meta);
            }
          }
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') {
            throw e;
          }
        }
      }
    }

    if (action === 'animate') {
      const codeLines = editor.getValue().split('\n');
      let cleanText = fullText.replace(/```json|```/g, '').trim();
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.slice(firstBrace, lastBrace + 1);
      }
      renderAnimation(cleanText, codeLines);
      setLoading(false);
      return;
    }

    // Final render without cursor
    renderFinal(fullText, meta);

  } catch (err) {
    console.error('Analysis error:', err);
    showError(err.message || 'Something went wrong. Check the console for details.');
    document.getElementById('status-dot').className = 'status-dot error';
  }

  setLoading(false);
}

// ===== Render during streaming =====
function renderStream(text, meta) {
  const output = document.getElementById('response-output');
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  cursor.id = 'stream-cursor';

  output.innerHTML = `<span class="response-tag ${meta.tagClass}">${meta.label}</span><br>`;
  output.innerHTML += markdownToHtml(text);
  output.appendChild(cursor);
  output.scrollTop = output.scrollHeight;
}

// ===== Final render after streaming complete =====
function renderFinal(text, meta) {
  const output = document.getElementById('response-output');
  output.innerHTML = `<span class="response-tag ${meta.tagClass}">${meta.label}</span><br>`;
  output.innerHTML += markdownToHtml(text);
  output.scrollTop = output.scrollHeight;
}

// ===== Resizable editor / sidebar split =====
function initPanelResize() {
  const layout = document.querySelector('.layout');
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('resize-handle');

  const MIN_EDITOR = 280;
  const MIN_SIDEBAR = 280;
  const DEFAULT_SIDEBAR = 380;
  const STORAGE_KEY = 'codesage-sidebar-width';

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const width = parseInt(saved, 10);
    if (!isNaN(width)) sidebar.style.width = width + 'px';
  }

  let isDragging = false;

  function applyWidth(clientX) {
    const layoutRect = layout.getBoundingClientRect();
    const handleWidth = handle.offsetWidth;
    const sidebarWidth = layoutRect.right - clientX;
    const maxSidebar = layoutRect.width - MIN_EDITOR - handleWidth;

    if (sidebarWidth >= MIN_SIDEBAR && sidebarWidth <= maxSidebar) {
      sidebar.style.width = sidebarWidth + 'px';
    }
  }

  function stopDragging() {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('active');
    document.body.classList.remove('resizing');
    localStorage.setItem(STORAGE_KEY, parseInt(sidebar.offsetWidth, 10));
  }

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    handle.classList.add('active');
    document.body.classList.add('resizing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    applyWidth(e.clientX);
  });

  document.addEventListener('mouseup', stopDragging);

  handle.addEventListener('touchstart', (e) => {
    isDragging = true;
    handle.classList.add('active');
    document.body.classList.add('resizing');
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    applyWidth(e.touches[0].clientX);
  }, { passive: true });

  document.addEventListener('touchend', stopDragging);

  handle.addEventListener('dblclick', () => {
    sidebar.style.width = DEFAULT_SIDEBAR + 'px';
    localStorage.setItem(STORAGE_KEY, DEFAULT_SIDEBAR);
  });
}

initPanelResize();
