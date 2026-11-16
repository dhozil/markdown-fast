// Entry driver for markdown-render-speed-02.
//
// The grader runs `node /bot/main.ts` on Node 22. It reads every case from
// /input/cases.json (override the directory with MAKEFUN_INPUT_DIR), renders each
// case's Markdown with the local parse() and writes /output/html.json (override
// with MAKEFUN_OUTPUT_DIR): a JSON array of HTML strings in the cases' order.
//
// The driver is deliberately thin: all of the work is in parse.js, and the only
// state it keeps is the array of rendered strings.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Case {
  id: string;
  markdown: string;
}

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as Case[];
const html = new Array<string>(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));