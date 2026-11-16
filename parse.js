// parse.js — a dependency-free CommonMark + GFM parser.
//
// parse(markdown) returns the HTML string for the given Markdown. The block
// parser is line oriented and builds a token tree; the inline parser scans
// characters and resolves emphasis with a delimiter stack. No dependencies,
// no state kept between calls.

// ===========================================================================
// escaping
// ===========================================================================

const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_NOENC_RE = /[<>"']|&(?!#\d{1,7};|#[Xx][a-fA-F0-9]{1,6};|\w+;)/g;
const ESCAPE_NOENC_TEST = /[<>"']|&(?!#\d{1,7};|#[Xx][a-fA-F0-9]{1,6};|\w+;)/;
const ESCAPE_ALL_RE = /[&<>"']/g;
const ESCAPE_ALL_TEST = /[&<>"']/;

function escapeText(s) {
  if (!ESCAPE_NOENC_TEST.test(s)) return s;
  return s.replace(ESCAPE_NOENC_RE, (c) => ESC_MAP[c]);
}

function escapeAll(s) {
  if (!ESCAPE_ALL_TEST.test(s)) return s;
  return s.replace(ESCAPE_ALL_RE, (c) => ESC_MAP[c]);
}

const NUM_REF_TEST = /&#(?:\d{1,7}|[Xx][A-Fa-f0-9]{1,6});/;
const NUM_REF_OR_AMP_RE = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7};|#[Xx][a-fA-F0-9]{1,6};|\w+;))/g;

function decodeEntities(s) {
  if (!NUM_REF_TEST.test(s)) return s;
  return s.replace(NUM_REF_OR_AMP_RE, (m, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (cp === 0 || cp > 1114111 || (cp >= 55296 && cp <= 57343)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

function renderText(s) {
  return escapeText(decodeEntities(s));
}

function cleanUrl(s) {
  try {
    return encodeURI(s).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// ===========================================================================
// character helpers
// ===========================================================================

const RE_PUNCT = /[\p{P}\p{S}]/u;

const RE_WS = /\s/;

function isWsChar(c) {
  return c !== '' && RE_WS.test(c);
}

function isPunctChar(c) {
  return c !== '' && RE_PUNCT.test(c);
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function expandLeading(line) {
  let i = 0;
  let col = 0;
  let out = '';
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) {
      out += ' ';
      col++;
      i++;
    } else if (c === 9) {
      const w = 4 - (col & 3);
      out += ' '.repeat(w);
      col += w;
      i++;
    } else break;
  }
  return out + line.slice(i);
}

function indentCols(line) {
  let i = 0;
  let col = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) {
      col++;
      i++;
    } else if (c === 9) {
      col += 4 - (col & 3);
      i++;
    } else break;
  }
  return col;
}

// ===========================================================================
// block parser
// ===========================================================================

const RE_ATX = /^ {0,3}(#{1,6})(?=\s|$)(.*)$/;
const RE_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RE_FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;
const RE_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[\t ]*){3,}|(?:\*[\t ]*){3,})[ \t]*$/;
const RE_BQ = /^ {0,3}>/;
const RE_LIST = /^( {0,3})((?:[*+-])|(?:\d{1,9}[.)]))([ \t][^\n]*?)?$/;
const RE_DEF = /^ {0,3}\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)((?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))))? *(?:\n+|$)/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

const RE_HTML6 = new RegExp('^ {0,3}</?(?:' + BLOCK_TAGS + ')(?:[ \\t]+|\\n|/?>|$)', 'i');
const RE_HTML7_OPEN = /^ {0,3}<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))[a-z][a-z0-9-]*(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)*? *\/?>(?=[ \t]*(?:\n|$))/i;
const RE_HTML7_CLOSE = /^ {0,3}<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))/i;
const RE_HTML1 = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;
const RE_HTML2 = /^ {0,3}<!--/;
const RE_HTML3 = /^ {0,3}<\?/;
const RE_HTML4 = /^ {0,3}<![A-Z]/;
const RE_HTML5 = /^ {0,3}<!\[CDATA\[/;
const RE_INDENTED = /^(?: {4}| {0,3}\t)/;

function isTableDelim(line) {
  const s = line.trim();
  if (s === '') return false;
  if (s.indexOf('|') < 0 && s.indexOf(':') < 0) return false;
  let i = 0;
  const n = s.length;
  if (s[i] === '|') i++;
  let cells = 0;
  while (i < n) {
    while (i < n && s[i] === ' ') i++;
    if (i < n && s[i] === ':') i++;
    let dashes = 0;
    while (i < n && s[i] === '-') {
      i++;
      dashes++;
    }
    if (dashes === 0) return false;
    if (i < n && s[i] === ':') i++;
    cells++;
    while (i < n && s[i] === ' ') i++;
    if (i < n && s[i] === '|') {
      i++;
      continue;
    }
    break;
  }
  return i === n && cells > 0;
}

function splitTableRow(row) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const c = row.charCodeAt(i);
    if (c === 92 && i + 1 < row.length && row.charCodeAt(i + 1) === 124) {
      cur += '\u0000';
      i++;
    } else if (c === 124) {
      parts.push(cur);
      cur = '';
    } else {
      cur += row[i];
    }
  }
  parts.push(cur);
  if (parts.length > 0 && parts[0].trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
  for (let i = 0; i < parts.length; i++) parts[i] = parts[i].trim().replace(/\u0000/g, '|');
  return parts;
}

function trimTrailingBlankLines(raw) {
  const parts = raw.split('\n');
  let t = parts.length - 1;
  while (t >= 0 && isBlankLine(parts[t])) t--;
  if (parts.length - t <= 2) return raw;
  return parts.slice(0, t + 1).join('\n');
}

function normalizeLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// --- main block loop ------------------------------------------------------

function parseBlocks(lines, start, end, top, links, firstMerge) {
  const tokens = [];
  let i = start;
  let merge = !!firstMerge;

  const lastContent = () => {
    for (let k = tokens.length - 1; k >= 0; k--) {
      const t = tokens[k];
      if (t.type !== 'space' && t.type !== 'def') return t;
    }
    return null;
  };

  const lastTok = () => (tokens.length > 0 ? tokens[tokens.length - 1] : null);

  const push = (tok) => {
    tokens.push(tok);
  };

  const pushParagraph = (text, raw) => {
    const prev = lastTok();
    if (merge && prev && (prev.type === 'p' || prev.type === 'text')) {
      prev.text += '\n' + text;
      if (prev.raw !== undefined || raw !== undefined) prev.raw = (prev.raw || '') + '\n' + (raw === undefined ? text : raw);
      prev.children = undefined;
    } else {
      push({ type: top ? 'p' : 'text', text, raw, children: undefined });
    }
    merge = false;
  };

  while (i < end) {
    const line = lines[i];

    if (isBlankLine(line)) {
      let j = i;
      while (j < end && isBlankLine(lines[j])) j++;
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'space') last.n = (last.n || 1) + (j - i);
      else {
        const sp = { type: 'space', n: j - i };
        tokens.push(sp);
      }
      i = j;
      continue;
    }

    // indented code
    if (RE_INDENTED.test(line)) {
      const rawLines = [];
      let j = i;
      while (j < end) {
        const l = lines[j];
        if (RE_INDENTED.test(l)) {
          rawLines.push(l);
          j++;
        } else if (isBlankLine(l)) {
          let k = j;
          while (k < end && isBlankLine(lines[k])) k++;
          if (k < end && RE_INDENTED.test(lines[k])) {
            while (j < k) {
              rawLines.push(lines[j]);
              j++;
            }
          } else break;
        } else break;
      }
      let raw = rawLines.join('\n');
      if (j < lines.length) raw += '\n';
      raw = trimTrailingBlankLines(raw);
      const text = raw.replace(/^(?: {0,3}\t| {1,4})/gm, '');
      const prev = lastTok();
      if (prev && (prev.type === 'p' || prev.type === 'text')) {
        prev.text += '\n' + text;
        prev.raw = (prev.raw || '') + '\n' + raw;
        prev.children = undefined;
      } else {
        push({ type: 'code', text, lang: '', fenced: false });
      }
      i = j;
      continue;
    }

    // fenced code
    {
      const m = RE_FENCE_OPEN.exec(line);
      if (m && !(m[1][0] === '`' && m[2].indexOf('`') >= 0)) {
        const fence = m[1];
        const ch = fence[0];
        const indent = line.length - line.replace(/^ {0,3}/, '').length;
        let j = i + 1;
        const body = [];
        let closed = false;
        while (j < end) {
          const cm = RE_FENCE_CLOSE.exec(lines[j]);
          if (cm && cm[1][0] === ch && cm[1].length >= fence.length) {
            closed = true;
            j++;
            break;
          }
          body.push(lines[j]);
          j++;
        }
        let text = body.join('\n');
        if (ch === '`' && indent > 0) {
          const arr = text === '' ? [] : text.split('\n');
          for (let k = 0; k < arr.length; k++) {
            const ws = /^\s+/.exec(arr[k]);
            if (ws) arr[k] = arr[k].slice(Math.min(ws[0].length, indent));
          }
          text = arr.join('\n');
        }
        const lang = m[2].trim().replace(/\\([\p{P}\p{S}])/gu, '$1');
        push({ type: 'code', text, lang, fenced: true });
        i = j;
        continue;
      }
    }

    // ATX heading
    {
      const m = RE_ATX.exec(line);
      if (m) {
        let text = m[2].trim();
        if (/#$/.test(text)) {
          const s = text.replace(/#+$/, '');
          if (s === '' || /[ \t]$/.test(s)) text = s.trim();
        }
        push({ type: 'heading', depth: m[1].length, text });
        i++;
        continue;
      }
    }

    // thematic break
    if (RE_HR.test(line)) {
      push({ type: 'hr' });
      i++;
      continue;
    }

    // block quote
    if (RE_BQ.test(line)) {
      const bq = parseBlockquote(lines, i, end, links);
      push(bq.token);
      i = bq.next;
      continue;
    }

    // list
    {
      const m = RE_LIST.exec(line);
      if (m) {
        const lst = parseList(lines, i, end, links);
        if (lst) {
          push(lst);
          i = lst.next;
          continue;
        }
      }
    }

    // html block
    {
      const h = matchHtmlBlock(lines, i, end);
      if (h) {
        push({ type: 'html', text: h.text });
        i = h.next;
        continue;
      }
    }

    // link reference definition
    {
      const d = matchDef(lines, i, end);
      if (d) {
        const prev = lastTok();
        if (prev && (prev.type === 'p' || prev.type === 'text')) {
          prev.text += '\n' + d.raw;
          prev.raw = (prev.raw || '') + '\n' + d.raw;
          prev.children = undefined;
        } else {
          if (!links[d.tag]) links[d.tag] = { href: d.href, title: d.title };
          push({ type: 'def', raw: d.raw });
        }
        i = d.next;
        continue;
      }
    }

    // table
    if (i + 1 < end && isTableDelim(lines[i + 1]) && !isBlankLine(line)) {
      const t = matchTable(lines, i, end);
      if (t) {
        push(t);
        i = t.next;
        continue;
      }
    }

    // paragraph or setext heading
    if (!top) {
      if (i + 1 < end && !isBlankLine(line) && RE_SETEXT.test(lines[i + 1])) {
        const sm = RE_SETEXT.exec(lines[i + 1]);
        push({ type: 'heading', depth: sm[1][0] === '=' ? 1 : 2, text: line.trim() });
        i += 2;
        continue;
      }
      const prev = lastTok();
      if (prev && prev.type === 'text') {
        prev.text += '\n' + line;
        prev.raw = (prev.raw || '') + '\n' + line;
        prev.children = undefined;
      } else {
        push({ type: 'text', text: line, raw: line, children: undefined });
      }
      i++;
      continue;
    }
    {
      const pl = [];
      let j = i;
      while (j < end) {
        const l = lines[j];
        if (isBlankLine(l)) {
          if (pl.length > 0 && j === lines.length - 1 && l !== '') {
            pl.push(l);
            j++;
          }
          break;
        }
        if (pl.length > 0 && RE_SETEXT.test(l)) break;
        if (pl.length > 0 && isBlockStartAt(l, lines[j + 1], true)) break;
        pl.push(l);
        j++;
      }
      if (pl.length === 0) {
        pl.push(line);
        j = i + 1;
      }
      if (j < end && RE_SETEXT.test(lines[j])) {
        const sm = RE_SETEXT.exec(lines[j]);
        const text = pl.join('\n').trim();
        push({ type: 'heading', depth: sm[1][0] === '=' ? 1 : 2, text });
        i = j + 1;
        continue;
      }
      const text = pl.join('\n');
      pushParagraph(text, text);
      i = j;
      continue;
    }
  }
  return tokens;
}

function isBlockStartAt(line, next, inParagraph) {
  if (line === undefined) return false;
  if (RE_ATX.test(line)) return true;
  {
    const m = RE_FENCE_OPEN.exec(line);
    if (m && !(m[1][0] === '`' && m[2].indexOf('`') >= 0)) return true;
  }
  if (RE_HR.test(line)) return true;
  if (RE_BQ.test(line)) return true;
  if (inParagraph) {
    if (/^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/.test(line)) return true;
  } else if (RE_LIST.test(line)) return true;
  if (RE_HTML1.test(line)) return true;
  if (RE_HTML2.test(line)) return true;
  if (RE_HTML3.test(line)) return true;
  if (RE_HTML4.test(line)) return true;
  if (RE_HTML5.test(line)) return true;
  if (RE_HTML6.test(line)) return true;
  if (next !== undefined && isTableDelim(next) && !isBlankLine(line)) return true;
  return false;
}

function matchDef(lines, i, end) {
  // Candidate: the lines up to the next blank line (bounded), so that a title
  // on a following line can be picked up.
  let stop = i;
  let count = 0;
  while (stop < end && count < 12) {
    if (stop > i && isBlankLine(lines[stop])) break;
    stop++;
    count++;
  }
  const cand = lines.slice(i, stop).join('\n') + '\n';
  const m = RE_DEF.exec(cand);
  if (!m) return null;
  const raw = m[0].replace(/\n+$/, '');
  const consumed = raw.split('\n').length;
  if (consumed > stop - i) return null;
  let dest = m[2];
  if (dest[0] !== '<') {
    let depth = 0;
    let bad = false;
    for (let k = 0; k < dest.length; k++) {
      const c = dest[k];
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth < 0) {
          bad = true;
          break;
        }
      }
    }
    if (bad || depth > 0) return null;
  }
  const tag = normalizeLabel(m[1]);
  let href = dest;
  if (href[0] === '<') href = href.slice(1, -1);
  href = href.replace(/\\([\p{P}\p{S}])/gu, '$1');
  const title = m[3] ? m[3].slice(1, -1).replace(/\\([\p{P}\p{S}])/gu, '$1') : null;
  return { tag, href, title, raw, next: i + consumed };
}

function htmlBlockNewline(lines, idx) {
  if (idx + 1 >= lines.length) return false;
  if (lines[idx + 1] !== '') return true;
  return idx + 2 === lines.length;
}

function matchHtmlBlock(lines, i, end) {
  const line = lines[i];
  let type = 0;
  if (RE_HTML1.test(line)) type = 1;
  else if (RE_HTML2.test(line)) type = 2;
  else if (RE_HTML3.test(line)) type = 3;
  else if (RE_HTML4.test(line)) type = 4;
  else if (RE_HTML5.test(line)) type = 5;
  else if (RE_HTML6.test(line)) type = 6;
  else if (RE_HTML7_OPEN.test(line) || RE_HTML7_CLOSE.test(line)) type = 7;
  if (type === 0) return null;

  if (type === 1) {
    const m = RE_HTML1.exec(line);
    const tag = m[1].toLowerCase();
    const re = new RegExp('</' + tag + '>', 'i');
    let k = i;
    let last = -1;
    for (; k < end; k++) {
      if (re.test(lines[k])) {
        last = k;
        break;
      }
    }
    if (last < 0) last = end - 1;
    let text = lines.slice(i, last + 1).join('\n');
    if (htmlBlockNewline(lines, last)) text += '\n';
    return { text, next: last + 1 };
  }

  if (type >= 2 && type <= 5) {
    const ends = type === 2 ? /-->/ : type === 3 ? /\?>/ : type === 4 ? />/ : /\]\]>/;
    let last = -1;
    for (let k = i; k < end; k++) {
      if (ends.test(lines[k])) {
        last = k;
        break;
      }
    }
    if (last < 0) last = end - 1;
    let text = lines.slice(i, last + 1).join('\n');
    if (htmlBlockNewline(lines, last)) text += '\n';
    return { text, next: last + 1 };
  }

  let k = i;
  while (k < end && !isBlankLine(lines[k])) k++;
  let text = lines.slice(i, k).join('\n');
  if (htmlBlockNewline(lines, k - 1)) text += '\n';
  return { text, next: k };
}

function stripBlockquoteMarker(line) {
  let i = 0;
  let n = 0;
  while (i < line.length && n < 3 && line[i] === ' ') {
    i++;
    n++;
  }
  if (line[i] === '>') {
    const markerEnd = i + 1;
    const expanded = expandLeadingFrom(line.slice(markerEnd), markerEnd);
    if (expanded.startsWith(' ')) return expanded.slice(1);
    return expanded;
  }
  return line;
}

function parseBlockquote(lines, i, end, links) {
  const content = [];
  let j = i;
  while (j < end && RE_BQ.test(lines[j])) {
    content.push(stripBlockquoteMarker(lines[j]));
    j++;
  }
  if (content.length === 0) return { token: { type: 'blockquote', tokens: [] }, next: i };

  const tokens = [];
  const allContent = [];
  let lastEndedBlank = false;
  const parseChunk = (chunk, merge) => {
    if (chunk.length === 0) return;
    for (const l of chunk) allContent.push(l);
    const toks = parseBlocks(chunk, 0, chunk.length, true, links, false);
    let endedBlank = false;
    let prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    let prevWasSpace = lastEndedBlank;
    for (const t of toks) {
      if (t.type === 'space') {
        endedBlank = true;
        prevWasSpace = true;
        continue;
      }
      endedBlank = false;
      if (!prevWasSpace && merge && prev && (prev.type === 'p' || prev.type === 'text')) {
        if (t.type === 'p' || t.type === 'text') {
          prev.text += '\n' + t.text;
          if (prev.raw !== undefined || t.raw !== undefined) prev.raw = (prev.raw || '') + '\n' + (t.raw === undefined ? t.text : t.raw);
          prev.children = undefined;
          prev = prev;
          continue;
        }
        if (t.type === 'code') {
          prev.text += '\n' + t.text;
          prev.raw = (prev.raw || '') + '\n' + (t.raw === undefined ? t.text : t.raw);
          prev.children = undefined;
          continue;
        }
        if (t.type === 'def') {
          prev.text += '\n' + (t.raw || '');
          prev.raw = (prev.raw || '') + '\n' + (t.raw || '');
          prev.children = undefined;
          continue;
        }
      }
      tokens.push(t);
      prev = t;
    }
    lastEndedBlank = endedBlank;
  };

  parseChunk(content, false);

  while (j < end) {
    const l = lines[j];
    if (isBlankLine(l)) break;
    if (RE_BQ.test(l)) {
      const stripped = stripBlockquoteMarker(l);
      const lastT = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      const plain =
        !lastEndedBlank &&
        lastT !== null &&
        !isBlankLine(stripped) &&
        !RE_INDENTED.test(stripped) &&
        !RE_SETEXT.test(stripped) &&
        !isBlockStartAt(stripped, undefined, true);
      if (plain && (lastT.type === 'p' || lastT.type === 'text')) {
        lastT.text += '\n' + stripped;
        if (lastT.raw !== undefined) lastT.raw += '\n' + stripped;
        lastT.children = undefined;
        j++;
        continue;
      }
      if (plain && (lastT.type === 'blockquote' || lastT.type === 'list')) {
        const shadow = (lastT.rawSrcLines || lastT.srcLines).concat([stripped]);
        if (lastT.type === 'blockquote') {
          const bq2 = parseBlockquote(shadow, 0, shadow.length, links);
          tokens[tokens.length - 1] = bq2.token;
        } else {
          const l2 = parseList(shadow, 0, shadow.length, links);
          if (l2) tokens[tokens.length - 1] = l2;
        }
        lastEndedBlank = false;
        j++;
        continue;
      }
      const chunk = [];
      while (j < end && RE_BQ.test(lines[j])) {
        chunk.push(stripBlockquoteMarker(lines[j]));
        j++;
      }
      parseChunk(chunk, !lastEndedBlank);
      continue;
    }
    if (isBlockStartAt(l, lines[j + 1], true)) break;
    if (lastEndedBlank) break;
    const last = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    if (!last) break;
    if (last.type === 'p' || last.type === 'text' || last.type === 'list' || last.type === 'blockquote') {
      const chunk = [];
      while (j < end && !RE_BQ.test(lines[j])) {
        if (isBlankLine(lines[j])) break;
        chunk.push(lines[j]);
        j++;
      }
      if (chunk.length === 0) break;
      for (let k = 1; k < chunk.length; k++) {
        if (RE_SETEXT.test(chunk[k])) chunk[k] = '    ' + chunk[k].trim();
      }
      if (last.type === 'blockquote' || last.type === 'list') {
        const shadow = (last.rawSrcLines || last.srcLines).concat(chunk);
        if (last.type === 'blockquote') {
          const bq2 = parseBlockquote(shadow, 0, shadow.length, links);
          tokens[tokens.length - 1] = bq2.token;
        } else {
          const l2 = parseList(shadow, 0, shadow.length, links);
          if (l2) tokens[tokens.length - 1] = l2;
        }
        for (const cl of chunk) allContent.push(cl);
        lastEndedBlank = false;
        continue;
      }
      parseChunk(chunk, true);
      continue;
    }
    break;
  }

  return { token: { type: 'blockquote', tokens, srcLines: allContent, rawSrcLines: lines.slice(i, j) }, next: j };
}

function lastTokenOf(tokens) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.type !== 'space' && t.type !== 'def') return t;
  }
  return null;
}

// --- lists ----------------------------------------------------------------

function expandLeadingFrom(s, startCol) {
  let i = 0;
  let col = startCol;
  let out = '';
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) {
      out += ' ';
      col++;
      i++;
    } else if (c === 9) {
      const w = 4 - (col & 3);
      out += ' '.repeat(w);
      col += w;
      i++;
    } else break;
  }
  return out + s.slice(i);
}

function startsItemBlock(f) {
  if (RE_HR.test(f)) return true;
  {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(f);
    if (m && !(m[1][0] === '`' && m[2].indexOf('`') >= 0)) return true;
  }
  if (/^ {0,3}#{1,6}(?=\s|$)/.test(f)) return true;
  if (RE_HTML6.test(f)) return true;
  if (RE_HTML1.test(f)) return true;
  if (RE_HTML2.test(f)) return true;
  if (RE_HTML3.test(f)) return true;
  if (RE_HTML4.test(f)) return true;
  if (RE_HTML5.test(f)) return true;
  if (RE_BQ.test(f)) return true;
  if (RE_LIST.test(f)) return true;
  return false;
}

function parseList(lines, i, end, links) {
  const first = RE_LIST.exec(lines[i]);
  if (!first) return null;
  const marker = first[2];
  const ordered = marker.length > 1;
  const startNum = ordered ? parseInt(marker.slice(0, -1), 10) : null;
  const delim = ordered ? marker[marker.length - 1] : marker;
  const list = { type: 'list', ordered, start: ordered ? startNum : null, loose: false, items: [] };

  let j = i;
  let prevItemHadBlank = false;
  let lastContentJ = i;

  while (j < end) {
    const m = RE_LIST.exec(lines[j]);
    if (!m) break;
    const mk = m[2];
    const ord = mk.length > 1;
    if (ord !== ordered) break;
    if (ordered ? mk[mk.length - 1] !== delim : mk !== delim) break;
    if (RE_HR.test(lines[j])) break;
    if (indentCols(lines[j]) >= 4) break;

    const indent = m[1].length;
    const markerLen = mk.length;
    const restRaw = m[3] === undefined ? '' : m[3];
    const rest = expandLeadingFrom(restRaw, indent + markerLen);
    let contentIndent;
    let firstText;
    let emptyFirst;
    if (rest.trim() === '') {
      emptyFirst = true;
      contentIndent = indent + markerLen + 1;
      firstText = '';
    } else {
      const idx = rest.search(/\S/);
      const spaces = idx > 4 ? 1 : idx;
      contentIndent = indent + markerLen + spaces;
      firstText = rest.slice(spaces);
      emptyFirst = false;
    }

    const itemLines = [firstText];
    j++;
    lastContentJ = j;
    let lastWasBlank = false;
    let prevBlock = !emptyFirst && (startsItemBlock(firstText) || /^ {4}/.test(firstText));
    let prevLine = firstText;
    let sawBlank = false;
    let skipBody = false;

    if (emptyFirst && j < end && isBlankLine(lines[j])) {
      j++;
      sawBlank = true;
      lastWasBlank = true;
      skipBody = true;
    }

    while (!skipBody && j < end) {
      const l = lines[j];
      if (isBlankLine(l)) {
        itemLines.push('');
        sawBlank = true;
        lastWasBlank = true;
        prevBlock = false;
        j++;
        continue;
      }
      const Z = expandLeading(l);
      const f = l;
      const ind = Z.search(/\S/);
      if (ind < contentIndent && startsItemBlock(f)) break;
      if (ind >= contentIndent || !f.trim()) {
        const content = Z.slice(contentIndent);
        itemLines.push(content);
        prevBlock = startsItemBlock(content) || /^ {4}/.test(content);
        prevLine = content;
        lastWasBlank = false;
        j++;
        lastContentJ = j;
        continue;
      }
      // lazy continuation
      if (lastWasBlank) break;
      if (prevBlock && !RE_BQ.test(prevLine)) break;
      let add = f;
      if (/^ {0,3}(?:=+|-+) *$/.test(f) && isLheadingWith(itemLines, f)) {
        add = '    ' + f.replace(/^ {0,3}/, '');
      }
      itemLines.push(add);
      prevBlock = startsItemBlock(add) || /^ {4}/.test(add);
      prevLine = add;
      lastWasBlank = false;
      j++;
      lastContentJ = j;
      continue;
    }

    const text = itemLines.join('\n');
    if (!list.loose && prevItemHadBlank) list.loose = true;
    prevItemHadBlank = skipBody || (itemLines.length > 1 && itemLines[itemLines.length - 1] === '');
    list.items.push({ text, raw: text, task: false, checked: false, tokens: null });
    if (skipBody) lastContentJ = j;
  }

  if (list.items.length === 0) return null;
  const lastItem = list.items[list.items.length - 1];
  lastItem.text = lastItem.text.replace(/\s+$/, '');
  lastItem.raw = lastItem.raw.replace(/\s+$/, '');

  for (const item of list.items) {
    const src = item.text.split('\n');
    item.tokens = parseBlocks(src, 0, src.length, false, links, false);
    if (!list.loose) {
      for (let k = 0; k < item.tokens.length; k++) {
        if (item.tokens[k].type === 'space' && k > 0 && k < item.tokens.length - 1) {
          list.loose = true;
          break;
        }
      }
    }
  }

  // task list items
  for (const item of list.items) {
    const firstTok = item.tokens[0];
    if (firstTok && (firstTok.type === 'text' || firstTok.type === 'p')) {
      const mm = /^\[([ xX])\][ \t]+/.exec(firstTok.text);
      if (mm) {
        item.task = true;
        item.checked = mm[1] !== ' ';
        firstTok.text = firstTok.text.slice(mm[0].length);
        if (firstTok.raw !== undefined) firstTok.raw = firstTok.raw.slice(mm[0].length);
        if (list.loose) firstTok.checkbox = item.checked;
        else item.checkbox = { type: 'checkbox', checked: item.checked };
      }
    }
  }

  if (list.loose) {
    for (const item of list.items) {
      for (const t of item.tokens) {
        if (t.type === 'text') {
          t.type = 'p';
          t.raw = t.text;
        }
      }
    }
  }

  list.next = lastContentJ;
  list.srcLines = lines.slice(i, lastContentJ);
  list.rawSrcLines = lines.slice(i, lastContentJ);
  return list;
}

function isLheadingWith(itemLines, line) {
  if (itemLines.length === 0) return false;
  const prev = itemLines[itemLines.length - 1];
  if (prev === undefined || isBlankLine(prev)) return false;
  return true;
}

// --- tables ---------------------------------------------------------------

function matchTable(lines, i, end) {
  const header = lines[i];
  const delim = lines[i + 1];
  const hcells = splitTableRow(header);
  const dcells = splitTableRow(delim);
  if (hcells.length !== dcells.length) return null;
  const aligns = [];
  for (const c of dcells) {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) aligns.push('center');
    else if (left) aligns.push('left');
    else if (right) aligns.push('right');
    else aligns.push(null);
  }
  let j = i + 2;
  const rows = [];
  while (j < end && !/^[ ]*$/.test(lines[j])) {
    if (/^(?: {4}| {0,3}\t)/.test(lines[j]) && /[^ \t]/.test(lines[j])) break;
    if (isBlockStartAt(lines[j], lines[j + 1], false)) break;
    const cells = splitTableRow(lines[j]);
    if (cells.length > hcells.length) cells.length = hcells.length;
    while (cells.length < hcells.length) cells.push('');
    rows.push(cells);
    j++;
  }
  return { type: 'table', header: hcells, aligns, rows, next: j };
}

// ===========================================================================
// inline parser
// ===========================================================================

const T_TEXT = 0;
const T_CODE = 1;
const T_HTML = 2;
const T_BR = 3;
const T_SOFT = 4;
const T_EM = 5;
const T_STRONG = 6;
const T_DEL = 7;
const T_LINK = 8;
const T_IMAGE = 9;
const T_DELIM = 10;
const T_BRACKET = 11;
const T_ESCAPE = 12;

function makeNode(t) {
  return { t, prev: null, next: null, s: '', c: null, alive: true };
}

const RE_TAG =
  /^<!--(?:-?>|[\s\S]*?-->)|^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?)*?\s*\/?>|^<\?[\s\S]*?\?>|^<![a-zA-Z]+\s[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>/;
const RE_AUTOLINK =
  /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/;
const RE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RE_CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_EMAIL = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const RE_URL = /^(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*/;
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const RE_LOCALCHAR = /[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]/;
const RE_REF_LABEL = /^\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]/;

function parseInline(src, links) {
  const list = { head: null, tail: null };
  const delims = [];
  const brackets = [];
  const len = src.length;
  let i = 0;

  const append = (n) => {
    if (list.tail) {
      list.tail.next = n;
      n.prev = list.tail;
      list.tail = n;
    } else {
      list.head = n;
      list.tail = n;
    }
  };

  const addText = (s, pc) => {
    if (s === '') return;
    if (list.tail && list.tail.t === T_TEXT) {
      list.tail.s += s;
      return;
    }
    const n = makeNode(T_TEXT);
    n.s = s;
    n.prevChar = pc;
    append(n);
  };

  const appendAutolink = (text, href) => {
    const ln = makeNode(T_LINK);
    ln.href = href;
    ln.title = null;
    ln.autolink = true;
    ln.gfm = true;
    ln.text = text;
    const tx = makeNode(T_TEXT);
    tx.s = text;
    ln.c = tx;
    append(ln);
  };

  const detachRange = (first, last) => {
    if (!first) return;
    first.prev = null;
    if (last) last.next = null;
  };

  while (i < len) {
    const c = src[i];

    if (c === '\\') {
      if (i + 1 < len) {
        const d = src[i + 1];
        if (RE_ESCAPE.test(src.slice(i, i + 2))) {
          const en = makeNode(T_ESCAPE);
          en.s = d;
          append(en);
          i += 2;
          continue;
        }
        if (d === '\n') {
          const prevText = list.tail && list.tail.t === T_TEXT ? list.tail.s : '';
          if (/(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|www\.)\S*$/.test(prevText)) {
            addText('\\');
            i++;
            continue;
          }
          if (/[^\s]/.test(src.slice(i + 2))) {
            const m = RE_BR.exec(src.slice(i));
            if (m) {
              append(makeNode(T_BR));
              i += m[0].length;
              continue;
            }
          }
        }
      }
      addText('\\');
      i++;
      continue;
    }

    if (c === '`') {
      let n = 0;
      while (i + n < len && src[i + n] === '`') n++;
      const m = RE_CODE.exec(src.slice(i));
      if (m && m[1].length === n) {
        let code = m[2].replace(/\n/g, ' ');
        if (code.length > 0 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim() !== '') {
          code = code.slice(1, -1);
        }
        const tn = makeNode(T_CODE);
        tn.s = code;
        append(tn);
        i += m[0].length;
        continue;
      }
      addText(src.slice(i, i + n));
      i += n;
      continue;
    }

    if (c === '<') {
      const rest = src.slice(i);
      const am = RE_AUTOLINK.exec(rest);
      if (am) {
        const inner = am[1];
        const isEmail = inner.indexOf('@') >= 0 && !/^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:/.test(inner);
        const ln = makeNode(T_LINK);
        ln.href = isEmail ? 'mailto:' + inner : inner;
        ln.title = null;
        ln.autolink = true;
        ln.text = inner;
        const tx = makeNode(T_TEXT);
        tx.s = inner;
        ln.c = tx;
        append(ln);
        i += am[0].length;
        continue;
      }
      const tm = RE_TAG.exec(rest);
      if (tm) {
        const hn = makeNode(T_HTML);
        hn.s = tm[0];
        append(hn);
        i += tm[0].length;
        continue;
      }
      addText('<');
      i++;
      continue;
    }

    if (c === '!' && src[i + 1] === '[') {
      addText('![');
      const bn = makeNode(T_BRACKET);
      bn.image = true;
      bn.active = true;
      bn.srcPos = i + 1;
      bn.delimCount = delims.length;
      append(bn);
      brackets.push(bn);
      i += 2;
      continue;
    }

    if (c === '[') {
      addText('[');
      const bn = makeNode(T_BRACKET);
      bn.image = false;
      bn.active = true;
      bn.srcPos = i;
      bn.delimCount = delims.length;
      append(bn);
      brackets.push(bn);
      i++;
      continue;
    }

    if (c === ']') {
      const closePos = i;
      i++;
      let b = null;
      for (let k = brackets.length - 1; k >= 0; k--) {
        if (brackets[k].active) {
          b = brackets[k];
          break;
        }
      }
      if (!b) {
        addText(']');
        continue;
      }

      let res = null;
      if (src[i] === '(') {
        res = parseInlineLinkAt(src, i);
        if (res) res.end = res.end;
      }
      if (!res && src[i] === '[') {
        const m = RE_REF_LABEL.exec(src.slice(i));
        if (m) {
          const def = links[normalizeLabel(m[1])];
          if (def) res = { href: def.href, title: def.title, end: i + m[0].length };
        } else if (src[i + 1] === ']') {
          const def = links[normalizeLabel(src.slice(b.srcPos + 1, closePos))];
          if (def) res = { href: def.href, title: def.title, end: i + 2 };
        }
      }
      if (!res) {
        const def = links[normalizeLabel(src.slice(b.srcPos + 1, closePos))];
        if (def) res = { href: def.href, title: def.title, end: i };
      }

      if (!res) {
        // no link: the bracket becomes literal text, the label is rescanned
        removeBracketFrom(list, brackets, b);
        addText(']');
        continue;
      }

      // process emphasis inside the link text
      processEmphasis(list, delims, b.delimCount);
      for (let k = b.delimCount; k < delims.length; k++) delims[k].alive = false;

      // detach the link text
      const first = b.next;
      const last = list.tail;
      if (first) {
        first.prev = null;
        if (last) last.next = null;
        b.next = null;
        list.tail = b;
      }
      disableGfmAutolinks(first);
      const prevNode = b.prev;
      removeBracketFrom(list, brackets, b);
      if (prevNode && prevNode.t === T_TEXT) {
        const suffix = b.image ? '![' : '[';
        if (prevNode.s.endsWith(suffix)) {
          prevNode.s = prevNode.s.slice(0, prevNode.s.length - suffix.length);
          if (prevNode.s === '') unlink(list, prevNode);
        }
      }
      // create the link / image node
      const ln = makeNode(b.image ? T_IMAGE : T_LINK);
      ln.href = res.href;
      ln.title = res.title;
      ln.autolink = false;
      ln.c = first;
      append(ln);
      if (!b.image) {
        for (const bb of brackets) {
          if (!bb.image) bb.active = false;
        }
      }
      i = res.end;
      continue;
    }

    if (c === '*' || c === '_') {
      let n = 0;
      while (i + n < len && src[i + n] === c) n++;
      const before = i > 0 ? src[i - 1] : '\n';
      const after = i + n < len ? src[i + n] : '\n';
      const canOpen = canOpenEmphasis(before, after, c);
      const canClose = canCloseEmphasis(before, after, c);
      if (c === '_' && !canOpen && !canClose) {
        addText(src.slice(i, i + n));
        i += n;
        continue;
      }
      const dn = makeNode(T_DELIM);
      dn.ch = c;
      dn.count = n;
      dn.orig = n;
      dn.canOpen = canOpen;
      dn.canClose = canClose;
      dn.s = src.slice(i, i + n);
      append(dn);
      delims.push(dn);
      i += n;
      continue;
    }

    if (c === '~') {
      if (src.indexOf('\\~', i) >= 0 && src.indexOf('\\~', i) < i + 80) {
        const m = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/.exec(src.slice(i));
        if (m) {
          const dn = makeNode(T_DEL);
          dn.c = parseInline(m[2], links).head;
          append(dn);
          i += m[0].length;
          continue;
        }
      }
      let n = 0;
      while (i + n < len && src[i + n] === '~') n++;
      if (n <= 2) {
        const before = i > 0 ? src[i - 1] : '\n';
        const after = i + n < len ? src[i + n] : '\n';
        let canOpen = false;
        let canClose = false;
        if (!isWsChar(after) && after !== '~') canOpen = true;
        if (!isWsChar(before) && before !== '~') canClose = true;
        const dn = makeNode(T_DELIM);
        dn.ch = '~';
        dn.count = n;
        dn.orig = n;
        dn.canOpen = canOpen;
        dn.canClose = canClose;
        dn.s = src.slice(i, i + n);
        append(dn);
        delims.push(dn);
        i += n;
        continue;
      }
      addText(src.slice(i, i + n));
      i += n;
      continue;
    }

    if (c === ' ' || c === '\t') {
      let n = 0;
      while (i + n < len && (src[i + n] === ' ' || src[i + n] === '\t')) n++;
      let allSpaces = true;
      for (let k = 0; k < n; k++) if (src[i + k] !== ' ') allSpaces = false;
      if (allSpaces && n >= 2 && src[i + n] === '\n' && /[^\s]/.test(src.slice(i + n + 1))) {
        append(makeNode(T_BR));
        i += n + 1;
        while (i < len && (src[i] === ' ' || src[i] === '\t')) i++;
        continue;
      }
      addText(src.slice(i, i + n));
      i += n;
      continue;
    }

    if (c === '\n') {
      append(makeNode(T_SOFT));
      i++;
      continue;
    }

    // text run
    {
      let j = i;
      let s = '';
      while (j < len) {
        const d = src[j];
        if (d === '_') {
          let k = j;
          while (k < len && src[k] === '_') k++;
          const before = j > 0 ? src[j - 1] : '\n';
          const after = k < len ? src[k] : '\n';
          if (!canOpenEmphasis(before, after, '_') && !canCloseEmphasis(before, after, '_')) {
            s += src.slice(j, k);
            j = k;
            continue;
          }
          break;
        }
        if (
          d === '\\' ||
          d === '`' ||
          d === '<' ||
          d === '*' ||
          d === '~' ||
          d === '[' ||
          d === ']' ||
          d === '\n' ||
          (d === '!' && src[j + 1] === '[')
        ) {
          break;
        }
        if (d === ' ' || d === '\t') {
          let k = j;
          while (k < len && (src[k] === ' ' || src[k] === '\t')) k++;
          let allSpaces = true;
          for (let q = j; q < k; q++) if (src[q] !== ' ') allSpaces = false;
          if (allSpaces && k - j >= 2 && src[k] === '\n' && /[^\s]/.test(src.slice(k + 1))) break;
          s += src.slice(j, k);
          j = k;
          continue;
        }
        s += d;
        j++;
      }
      if (s === '') {
        s = src[i];
        j = i + 1;
      }
      addText(s, i > 0 ? src[i - 1] : '\n');
      i = j;
      continue;
    }
  }

  processEmphasis(list, delims, 0);
  scanAllAutolinks(list, list.head);
  return list;
}

function insertAfter(list, ref, n) {
  n.prev = ref;
  n.next = ref.next;
  if (ref.next) ref.next.prev = n;
  else list.tail = n;
  ref.next = n;
}

function matchAutolinkAt(s, j) {
  let m = /^(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?)/.exec(s.slice(j));
  if (m) return { text: m[0], href: m[0], len: m[0].length };
  m = RE_EMAIL.exec(s.slice(j));
  if (m) return { text: m[0], href: 'mailto:' + m[0], len: m[0].length };
  m = RE_URL.exec(s.slice(j));
  if (m) {
    let text = m[0];
    let prev;
    do {
      prev = text;
      const bm = RE_BACKPEDAL.exec(text);
      text = bm ? bm[0] : '';
    } while (prev !== text);
    if (text !== '') {
      return { text, href: text.startsWith('www.') ? 'http://' + text : text, len: text.length };
    }
  }
  return null;
}

function autolinkStartAt(s, j, prevChar) {
  const c = s[j];
  if (c === 'h' || c === 'H') {
    if (/^[hH][tT][tT][pP][sS]?:\/\//.test(s.slice(j, j + 8))) return true;
  } else if (c === 'f' || c === 'F') {
    if (/^[fF][tT][pP]:\/\//.test(s.slice(j, j + 7))) return true;
  } else if (c === 'm' && s.startsWith('mailto:', j)) {
    return true;
  } else if (c === 'x' && s.startsWith('xmpp:', j)) {
    return true;
  } else if (c === 'w' && s.startsWith('www.', j)) {
    const p = j === 0 ? prevChar : s[j - 1];
    if (p === ' ' || p === '\t' || p === '\n' || p === '*' || p === '_' || p === '~' || p === '(' || p === undefined) return true;
  }
  if (RE_LOCALCHAR.test(c)) {
    const p = j === 0 ? prevChar : s[j - 1];
    if (p !== undefined && RE_LOCALCHAR.test(p)) return false;
    return RE_EMAIL.test(s.slice(j));
  }
  return false;
}

function lastNodeOf(head) {
  let n = head;
  while (n && n.next) n = n.next;
  return n;
}

function replaceRange(list, first, last, newNodes) {
  if (newNodes.length === 0) {
    if (first.prev) first.prev.next = last.next;
    else list.head = last.next;
    if (last.next) last.next.prev = first.prev;
    else list.tail = first.prev;
    return;
  }
  const before = first.prev;
  const after = last.next;
  for (let i = 0; i < newNodes.length; i++) {
    newNodes[i].prev = i > 0 ? newNodes[i - 1] : before;
    newNodes[i].next = i < newNodes.length - 1 ? newNodes[i + 1] : after;
  }
  if (before) before.next = newNodes[0];
  else list.head = newNodes[0];
  const lastNew = newNodes[newNodes.length - 1];
  if (after) after.prev = lastNew;
  else list.tail = lastNew;
}

function scanAllAutolinks(list, head) {
  let n = head;
  while (n) {
    if (n.t === T_TEXT || n.t === T_DELIM) {
      const nodes = [];
      let cur = n;
      while (cur && (cur.t === T_TEXT || cur.t === T_DELIM)) {
        nodes.push(cur);
        cur = cur.next;
      }
      const last = scanRun(list, nodes);
      n = last ? last.next : null;
    } else if (n.t === T_EM || n.t === T_STRONG || n.t === T_DEL) {
      const childList = { head: n.c, tail: lastNodeOf(n.c) };
      scanAllAutolinks(childList, childList.head);
      n.c = childList.head;
      n = n.next;
    } else {
      n = n.next;
    }
  }
}

function scanRun(list, nodes) {
  if (nodes.length === 0) return null;
  let s = '';
  for (const nd of nodes) s += nd.s;
  if (s.length === 0) return nodes[nodes.length - 1];
  let pc;
  if (nodes[0].prevChar !== undefined) pc = nodes[0].prevChar;
  else if (nodes[0].prev && nodes[0].prev.s) {
    const ps = nodes[0].prev.s;
    pc = ps[ps.length - 1];
  } else pc = '\n';
  for (let j = 0; j < s.length; j++) {
    const p = j === 0 ? pc : s[j - 1];
    if (!autolinkStartAt(s, j, p)) continue;
    const m = matchAutolinkAt(s, j);
    if (!m) continue;
    const before = s.slice(0, j);
    const after = s.slice(j + m.len);
    const newNodes = [];
    if (before) {
      const t = makeNode(T_TEXT);
      t.s = before;
      t.prevChar = pc;
      newNodes.push(t);
    }
    const ln = makeNode(T_LINK);
    ln.href = m.href;
    ln.title = null;
    ln.autolink = true;
    ln.gfm = true;
    ln.text = m.text;
    const tx = makeNode(T_TEXT);
    tx.s = m.text;
    ln.c = tx;
    newNodes.push(ln);
    let lastNew = ln;
    if (after) {
      const t = makeNode(T_TEXT);
      t.s = after;
      t.prevChar = m.text[m.text.length - 1];
      newNodes.push(t);
      lastNew = t;
    }
    replaceRange(list, nodes[0], nodes[nodes.length - 1], newNodes);
    if (after) {
      scanRun(list, [lastNew]);
      return lastNew;
    }
    return lastNew;
  }
  return nodes[nodes.length - 1];
}

function canOpenEmphasis(before, after, ch) {
  const beforeWs = isWsChar(before);
  const afterWs = isWsChar(after);
  const beforePunct = isPunctChar(before);
  const afterPunct = isPunctChar(after);
  const left = !afterWs && (!afterPunct || beforeWs || beforePunct);
  if (ch === '*') return left;
  const right = !beforeWs && (!beforePunct || afterWs || afterPunct);
  return left && (!right || beforePunct);
}

function canCloseEmphasis(before, after, ch) {
  const beforeWs = isWsChar(before);
  const afterWs = isWsChar(after);
  const beforePunct = isPunctChar(before);
  const afterPunct = isPunctChar(after);
  const right = !beforeWs && (!beforePunct || afterWs || afterPunct);
  if (ch === '*') return right;
  const left = !afterWs && (!afterPunct || beforeWs || beforePunct);
  return right && (!left || afterPunct);
}

function isAutolinkStart(src, j) {
  const c = src[j];
  if (c === 'h' || c === 'H') {
    if (/^[hH][tT][tT][pP][sS]?:\/\//.test(src.slice(j, j + 8))) return true;
  } else if (c === 'f' || c === 'F') {
    if (/^[fF][tT][pP]:\/\//.test(src.slice(j, j + 7))) return true;
  } else if (c === 'm' && src.startsWith('mailto:', j)) {
    return true;
  } else if (c === 'x' && src.startsWith('xmpp:', j)) {
    return true;
  } else if (c === 'w' && src.startsWith('www.', j)) {
    if (j === 0) return true;
    const p = src[j - 1];
    if (p === ' ' || p === '\t' || p === '\n' || p === '*' || p === '_' || p === '~' || p === '(') return true;
  }
  if (RE_LOCALCHAR.test(c)) {
    if (j > 0 && RE_LOCALCHAR.test(src[j - 1])) return false;
    return RE_EMAIL.test(src.slice(j));
  }
  return false;
}

function removeBracketFrom(list, brackets, b) {
  if (b.prev) b.prev.next = b.next;
  else list.head = b.next;
  if (b.next) b.next.prev = b.prev;
  else list.tail = b.prev;
  b.prev = b.next = null;
  const k = brackets.lastIndexOf(b);
  if (k >= 0) brackets.splice(k, 1);
}

function parseInlineLinkAt(src, pos) {
  let i = pos + 1;
  const len = src.length;
  while (i < len && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++;
  let href = '';
  if (src[i] === '<') {
    let j = i + 1;
    let s = '';
    let closed = false;
    while (j < len) {
      const c = src[j];
      if (c === '\\' && j + 1 < len) {
        s += c + src[j + 1];
        j += 2;
        continue;
      }
      if (c === '\n' || c === '<') return null;
      if (c === '>') {
        closed = true;
        j++;
        break;
      }
      s += c;
      j++;
    }
    if (!closed) return null;
    href = s;
    i = j;
  } else {
    let j = i;
    let depth = 0;
    let s = '';
    while (j < len) {
      const c = src[j];
      if (c === '\\' && j + 1 < len) {
        s += c + src[j + 1];
        j += 2;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\x00') break;
      if (c === '(') {
        depth++;
        s += c;
        j++;
        continue;
      }
      if (c === ')') {
        if (depth === 0) break;
        depth--;
        s += c;
        j++;
        continue;
      }
      s += c;
      j++;
    }
    if (depth !== 0) return null;
    href = s;
    i = j;
  }
  while (i < len && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++;
  let title = null;
  if (src[i] === '"' || src[i] === "'" || src[i] === '(') {
    const open = src[i];
    const close = open === '(' ? ')' : open;
    let j = i + 1;
    let s = '';
    let closed = false;
    while (j < len) {
      const c = src[j];
      if (c === '\\' && j + 1 < len) {
        s += c + src[j + 1];
        j += 2;
        continue;
      }
      if (c === close) {
        closed = true;
        j++;
        break;
      }
      s += c;
      j++;
    }
    if (!closed) return null;
    title = s;
    i = j;
    while (i < len && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++;
  }
  if (src[i] !== ')') return null;
  i++;
  const unescape = (s) => s.replace(/\\([\p{P}\p{S}])/gu, '$1');
  return { href: unescape(href), title: title === null ? null : unescape(title), end: i };
}

function disableGfmAutolinks(head) {
  let n = head;
  while (n) {
    if (n.t === T_LINK && n.gfm) {
      n.t = T_TEXT;
      n.s = n.text;
      n.c = null;
    } else if (n.c && n.t !== T_TEXT) {
      disableGfmAutolinks(n.c);
    }
    n = n.next;
  }
}

function processEmphasis(list, delims, from) {
  let ci = from;
  while (ci < delims.length) {
    const closer = delims[ci];
    if (!closer.alive || !closer.canClose || closer.count === 0) {
      ci++;
      continue;
    }
    let oi = ci - 1;
    let opener = null;
    while (oi >= from) {
      const d = delims[oi];
      if (d.alive && d.count > 0 && d.ch === closer.ch && d.canOpen) {
        if (closer.ch === '~') {
          if (d.count === closer.count) {
            opener = d;
            break;
          }
        } else {
          const both = closer.canOpen || d.canClose;
          const sum = d.orig + closer.orig;
          if (!(both && sum % 3 === 0 && (d.orig % 3 !== 0 || closer.orig % 3 !== 0))) {
            opener = d;
            break;
          }
        }
      }
      oi--;
    }
    if (!opener) {
      ci++;
      continue;
    }
    const use = closer.ch === '~' ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;

    const first = opener.next;
    const last = closer.prev;
    // unlink the children range
    opener.next = closer;
    closer.prev = opener;
    if (first) first.prev = null;
    if (last) last.next = null;

    for (let k = oi + 1; k < ci; k++) delims[k].alive = false;

    const t = closer.ch === '~' ? T_DEL : use === 2 ? T_STRONG : T_EM;
    const en = makeNode(t);
    en.c = first;
    en.prev = opener;
    en.next = closer;
    opener.next = en;
    closer.prev = en;

    opener.count -= use;
    if (opener.count === 0) {
      opener.alive = false;
      unlink(list, opener);
    } else {
      opener.s = opener.ch.repeat(opener.count);
    }
    closer.count -= use;
    if (closer.count === 0) {
      closer.alive = false;
      unlink(list, closer);
      ci++;
    } else {
      closer.s = closer.ch.repeat(closer.count);
    }
  }
}

function unlink(list, n) {
  if (n.prev) n.prev.next = n.next;
  else list.head = n.next;
  if (n.next) n.next.prev = n.prev;
  else list.tail = n.prev;
  n.prev = n.next = null;
}

// ===========================================================================
// rendering
// ===========================================================================

function renderBlocks(tokens, links) {
  let out = '';
  for (const t of tokens) out += renderBlock(t, links);
  return out;
}

function renderBlock(t, links) {
  switch (t.type) {
    case 'space':
    case 'def':
      return '';
    case 'code': {
      let r = t.text ? t.text.replace(/\n$/, '') + '\n' : '';
      const lang = t.lang ? (/^\S*/.exec(t.lang) || [''])[0] : '';
      return (
        '<pre><code' +
        (lang ? ' class="language-' + escapeText(lang) + '"' : '') +
        '>' +
        escapeAll(r) +
        '</code></pre>\n'
      );
    }
    case 'blockquote':
      return '<blockquote>\n' + renderBlocks(t.tokens, links) + '</blockquote>\n';
    case 'heading':
      return '<h' + t.depth + '>' + renderInline(t.text, links) + '</h' + t.depth + '>\n';
    case 'hr':
      return '<hr>\n';
    case 'html':
      return t.text;
    case 'p': {
      const box = t.checkbox !== undefined ? renderCheckbox(t.checkbox) : '';
      return '<p>' + box + renderInline(t.text, links) + '</p>\n';
    }
    case 'text':
      return renderInline(t.text, links);
    case 'list': {
      const tag = t.ordered ? 'ol' : 'ul';
      const start = t.ordered && t.start !== 1 ? ' start="' + t.start + '"' : '';
      let out = '<' + tag + start + '>\n';
      for (const item of t.items) {
        out += '<li>';
        if (item.checkbox) out += renderCheckbox(item.checkbox.checked);
        out += renderBlocks(item.tokens, links);
        out += '</li>\n';
      }
      return out + '</' + tag + '>\n';
    }
    case 'table': {
      let head = '';
      for (let i = 0; i < t.header.length; i++) {
        head += renderTableCell(t.header[i], true, t.aligns[i], links);
      }
      let body = '';
      for (const row of t.rows) {
        let cells = '';
        for (let i = 0; i < row.length; i++) {
          cells += renderTableCell(row[i], false, t.aligns[i], links);
        }
        body += '<tr>\n' + cells + '</tr>\n';
      }
      if (body) body = '<tbody>' + body + '</tbody>';
      return '<table>\n<thead>\n<tr>\n' + head + '</tr>\n</thead>\n' + body + '</table>\n';
    }
    default:
      return '';
  }
}

function renderTableCell(text, header, align, links) {
  const tag = header ? 'th' : 'td';
  const attr = align ? ' align="' + align + '"' : '';
  return '<' + tag + attr + '>' + renderInline(text, links) + '</' + tag + '>\n';
}

function renderCheckbox(checked) {
  return checked
    ? '<input checked="" disabled="" type="checkbox"> '
    : '<input disabled="" type="checkbox"> ';
}

function renderInline(src, links) {
  return renderNodes(parseInline(src, links).head);
}

function renderNodes(head) {
  let out = '';
  let n = head;
  while (n) {
    switch (n.t) {
      case T_TEXT:
        out += renderText(n.s);
        break;
      case T_ESCAPE:
        out += escapeAll(n.s);
        break;
      case T_CODE:
        out += '<code>' + escapeAll(n.s) + '</code>';
        break;
      case T_HTML:
        out += n.s;
        break;
      case T_BR:
        out += '<br>';
        break;
      case T_SOFT:
        out += '\n';
        break;
      case T_EM:
        out += '<em>' + renderNodes(n.c) + '</em>';
        break;
      case T_STRONG:
        out += '<strong>' + renderNodes(n.c) + '</strong>';
        break;
      case T_DEL:
        out += '<del>' + renderNodes(n.c) + '</del>';
        break;
      case T_LINK: {
        const href = cleanUrl(n.href);
        if (n.autolink) {
          if (href === null) {
            out += escapeAll(n.text);
          } else {
            out += '<a href="' + escapeAll(href) + '">' + escapeAll(n.text) + '</a>';
          }
        } else {
          const text = renderNodes(n.c);
          if (href === null) {
            out += text;
          } else {
            out += '<a href="' + escapeText(href) + '"' + (n.title ? ' title="' + escapeText(n.title) + '"' : '') + '>' + text + '</a>';
          }
        }
        break;
      }
      case T_IMAGE: {
        const alt = escapeText(renderPlain(n.c));
        const src = cleanUrl(n.href);
        if (src === null) {
          out += alt;
        } else {
          out += '<img src="' + escapeText(src) + '" alt="' + alt + '"' + (n.title ? ' title="' + escapeText(n.title) + '"' : '') + '>';
        }
        break;
      }
      case T_DELIM:
        out += n.s;
        break;
      case T_BRACKET:
        break;
      default:
        break;
    }
    n = n.next;
  }
  return out;
}

function renderPlain(head) {
  let out = '';
  let n = head;
  while (n) {
    switch (n.t) {
      case T_TEXT:
        out += n.s;
        break;
      case T_ESCAPE:
        out += n.s;
        break;
      case T_CODE:
        out += n.s;
        break;
      case T_HTML:
        out += n.s;
        break;
      case T_BR:
      case T_SOFT:
        break;
      case T_EM:
      case T_STRONG:
      case T_DEL:
      case T_LINK:
        out += renderPlain(n.c);
        break;
      case T_IMAGE:
        out += renderPlain(n.c);
        break;
      default:
        break;
    }
    n = n.next;
  }
  return out;
}

// ===========================================================================
// entry point
// ===========================================================================

export function parse(markdown) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const links = Object.create(null);
  const tokens = parseBlocks(lines, 0, lines.length, true, links, false);
  return renderBlocks(tokens, links);
}