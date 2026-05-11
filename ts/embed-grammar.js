#!/usr/bin/env node

// Embeds json5-grammar.jsonic into src/json5.ts and go/json5.go.
// Run via: npm run embed

const fs = require('fs')
const path = require('path')

const grammar = fs.readFileSync(
  path.join(__dirname, 'json5-grammar.jsonic'),
  'utf8',
)

const BEGIN = '// --- BEGIN EMBEDDED json5-grammar.jsonic ---'
const END = '// --- END EMBEDDED json5-grammar.jsonic ---'

function embed(file, wrapContent) {
  let src = fs.readFileSync(file, 'utf8')
  const beginIdx = src.indexOf(BEGIN)
  const endIdx = src.indexOf(END)
  if (beginIdx === -1 || endIdx === -1) {
    console.error('Error: embedding markers not found in ' + file)
    process.exit(1)
  }
  const replacement = BEGIN + '\n' + wrapContent + '\n' + END
  src = src.substring(0, beginIdx) + replacement + src.substring(endIdx + END.length)
  fs.writeFileSync(file, src)
}

// TypeScript: template literal (escape backslashes, backticks, ${).
const tsContent = grammar
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')
embed(
  path.join(__dirname, 'src', 'json5.ts'),
  'const grammarText = `\n' + tsContent + '`',
)

// Go: raw string literal cannot contain backticks. Split the grammar
// on `, emit each chunk as its own raw string, and join with `+ "`" +`
// interpolations so the concatenated constant contains the literal
// backticks.
function goEscape(src) {
  const parts = src.split('`')
  if (parts.length === 1) return '`' + src + '`'
  return parts.map((p) => '`' + p + '`').join(' + "`" + ')
}
embed(
  path.join(__dirname, '..', 'go', 'json5.go'),
  'const grammarText = ' + goEscape(grammar),
)

console.log('Embedded grammar into src/json5.ts and go/json5.go')
