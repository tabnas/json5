// Package json5 implements a parser for the JSON5 data format.
//
// JSON5 is a superset of JSON that allows ES5.1 syntax niceties: comments,
// unquoted object keys, single-quoted strings, trailing commas, hexadecimal
// numbers, leading and trailing decimal points, explicit plus signs,
// Infinity and NaN literals, and line continuations within strings.
//
// See https://spec.json5.org for the full specification.
//
// Parse reads a complete JSON5 document and returns it as Go values:
//
//	object  -> map[string]any
//	array   -> []any
//	string  -> string
//	number  -> float64 (or int64 when an integer literal fits)
//	boolean -> bool
//	null    -> nil
package json5

import (
	"fmt"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Version is the semantic version of this package.
const Version = "0.1.0"

// Parse parses the JSON5 text in src and returns the decoded value.
func Parse(src string) (any, error) {
	p := &parser{src: src, line: 1, col: 1}
	if err := p.skipWS(); err != nil {
		return nil, err
	}
	v, err := p.parseValue()
	if err != nil {
		return nil, err
	}
	if err := p.skipWS(); err != nil {
		return nil, err
	}
	if p.pos != len(p.src) {
		return nil, p.errorf("unexpected trailing input: %q", p.peekRune())
	}
	return v, nil
}

// SyntaxError describes a parse failure at a specific location in the source.
type SyntaxError struct {
	Msg  string
	Line int
	Col  int
	Pos  int
}

func (e *SyntaxError) Error() string {
	return fmt.Sprintf("json5: %s (line %d, col %d)", e.Msg, e.Line, e.Col)
}

type parser struct {
	src  string
	pos  int
	line int
	col  int
}

func (p *parser) errorf(format string, args ...any) error {
	return &SyntaxError{
		Msg:  fmt.Sprintf(format, args...),
		Line: p.line,
		Col:  p.col,
		Pos:  p.pos,
	}
}

func (p *parser) peekRune() rune {
	if p.pos >= len(p.src) {
		return -1
	}
	r, _ := utf8.DecodeRuneInString(p.src[p.pos:])
	return r
}

func (p *parser) readRune() (rune, int) {
	if p.pos >= len(p.src) {
		return -1, 0
	}
	r, size := utf8.DecodeRuneInString(p.src[p.pos:])
	p.pos += size
	if r == '\n' {
		p.line++
		p.col = 1
	} else if r == '\r' {
		// \r\n counts as one line terminator.
		if p.pos < len(p.src) && p.src[p.pos] == '\n' {
			p.pos++
		}
		p.line++
		p.col = 1
	} else if r == '\u2028' || r == '\u2029' {
		p.line++
		p.col = 1
	} else {
		p.col++
	}
	return r, size
}

// isLineTerminator reports whether r is a JSON5 LineTerminator.
func isLineTerminator(r rune) bool {
	return r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029'
}

// isWhiteSpace reports whether r is a JSON5 WhiteSpace character
// (not counting line terminators, which are handled separately).
func isWhiteSpace(r rune) bool {
	switch r {
	case '\t', '\v', '\f', ' ', '\u00A0', '\uFEFF':
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

// skipWS advances past whitespace, line terminators, and comments.
// An unterminated block comment is reported as an error.
func (p *parser) skipWS() error {
	for p.pos < len(p.src) {
		r := p.peekRune()
		switch {
		case isWhiteSpace(r), isLineTerminator(r):
			p.readRune()
		case r == '/' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '/':
			p.pos += 2
			p.col += 2
			for p.pos < len(p.src) && !isLineTerminator(p.peekRune()) {
				p.readRune()
			}
		case r == '/' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '*':
			startLine, startCol := p.line, p.col
			p.pos += 2
			p.col += 2
			closed := false
			for p.pos < len(p.src) {
				if p.src[p.pos] == '*' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '/' {
					p.pos += 2
					p.col += 2
					closed = true
					break
				}
				p.readRune()
			}
			if !closed {
				return &SyntaxError{
					Msg:  "unterminated block comment",
					Line: startLine,
					Col:  startCol,
					Pos:  p.pos,
				}
			}
		default:
			return nil
		}
	}
	return nil
}

// parseValue parses a single JSON5 value.
func (p *parser) parseValue() (any, error) {
	if err := p.skipWS(); err != nil {
		return nil, err
	}
	if p.pos >= len(p.src) {
		return nil, p.errorf("unexpected end of input")
	}
	r := p.peekRune()
	switch r {
	case '{':
		return p.parseObject()
	case '[':
		return p.parseArray()
	case '"', '\'':
		return p.parseString(r)
	}
	// Numbers and keyword literals (true, false, null, Infinity, NaN) plus
	// signs share the same leading characters and are distinguished below.
	if r == '+' || r == '-' || r == '.' || (r >= '0' && r <= '9') ||
		r == 'I' || r == 'N' || r == 't' || r == 'f' || r == 'n' {
		return p.parseLiteral()
	}
	return nil, p.errorf("unexpected character %q", r)
}

// parseObject parses a JSON5 object (assumes `{` at current position).
func (p *parser) parseObject() (map[string]any, error) {
	p.readRune() // consume {
	obj := map[string]any{}
	for {
		if err := p.skipWS(); err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) {
			return nil, p.errorf("unterminated object")
		}
		if p.peekRune() == '}' {
			p.readRune()
			return obj, nil
		}
		key, err := p.parseKey()
		if err != nil {
			return nil, err
		}
		if err := p.skipWS(); err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) || p.peekRune() != ':' {
			return nil, p.errorf("expected ':' after object key")
		}
		p.readRune()
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		obj[key] = val
		if err := p.skipWS(); err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) {
			return nil, p.errorf("unterminated object")
		}
		switch p.peekRune() {
		case ',':
			p.readRune()
		case '}':
			p.readRune()
			return obj, nil
		default:
			return nil, p.errorf("expected ',' or '}' in object, got %q", p.peekRune())
		}
	}
}

// parseKey parses an object key: IdentifierName, single- or double-quoted string.
func (p *parser) parseKey() (string, error) {
	r := p.peekRune()
	if r == '"' || r == '\'' {
		s, err := p.parseString(r)
		if err != nil {
			return "", err
		}
		return s.(string), nil
	}
	return p.parseIdentifierName()
}

// parseIdentifierName parses an ES5.1 IdentifierName.
// IdentifierStart: UnicodeLetter | '$' | '_' | '\' UnicodeEscapeSequence
// IdentifierPart:  IdentifierStart | UnicodeCombiningMark | UnicodeDigit |
//                  UnicodeConnectorPunctuation | ZWNJ | ZWJ
func (p *parser) parseIdentifierName() (string, error) {
	var b strings.Builder
	first := true
	for p.pos < len(p.src) {
		r := p.peekRune()
		var actual rune
		if r == '\\' {
			// Must be \u unicode escape inside identifier.
			if p.pos+1 >= len(p.src) || p.src[p.pos+1] != 'u' {
				return "", p.errorf("invalid identifier escape")
			}
			p.readRune() // backslash
			p.readRune() // u
			esc, err := p.readHex4()
			if err != nil {
				return "", err
			}
			actual = esc
		} else {
			actual = r
		}
		if first {
			if !isIdentifierStart(actual) {
				if b.Len() == 0 {
					return "", p.errorf("expected identifier, got %q", r)
				}
				break
			}
		} else if !isIdentifierPart(actual) {
			break
		}
		if r != '\\' {
			p.readRune()
		}
		b.WriteRune(actual)
		first = false
	}
	if b.Len() == 0 {
		return "", p.errorf("expected identifier")
	}
	return b.String(), nil
}

func isIdentifierStart(r rune) bool {
	if r == '$' || r == '_' {
		return true
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r)
}

func isIdentifierPart(r rune) bool {
	if isIdentifierStart(r) {
		return true
	}
	if r == '\u200C' || r == '\u200D' {
		return true
	}
	return unicode.Is(unicode.Mn, r) ||
		unicode.Is(unicode.Mc, r) ||
		unicode.Is(unicode.Nd, r) ||
		unicode.Is(unicode.Pc, r)
}

// parseArray parses a JSON5 array (assumes `[` at current position).
func (p *parser) parseArray() ([]any, error) {
	p.readRune() // consume [
	arr := []any{}
	for {
		if err := p.skipWS(); err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) {
			return nil, p.errorf("unterminated array")
		}
		if p.peekRune() == ']' {
			p.readRune()
			return arr, nil
		}
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		arr = append(arr, val)
		if err := p.skipWS(); err != nil {
			return nil, err
		}
		if p.pos >= len(p.src) {
			return nil, p.errorf("unterminated array")
		}
		switch p.peekRune() {
		case ',':
			p.readRune()
		case ']':
			p.readRune()
			return arr, nil
		default:
			return nil, p.errorf("expected ',' or ']' in array, got %q", p.peekRune())
		}
	}
}

// parseString parses a single- or double-quoted JSON5 string.
func (p *parser) parseString(quote rune) (any, error) {
	p.readRune() // opening quote
	var b strings.Builder
	for {
		if p.pos >= len(p.src) {
			return nil, p.errorf("unterminated string")
		}
		r := p.peekRune()
		if r == quote {
			p.readRune()
			return b.String(), nil
		}
		if isLineTerminator(r) {
			return nil, p.errorf("unescaped line terminator in string")
		}
		if r == '\\' {
			p.readRune() // consume backslash
			if p.pos >= len(p.src) {
				return nil, p.errorf("unterminated escape sequence")
			}
			esc := p.peekRune()
			// Line continuation: backslash + LineTerminatorSequence.
			if isLineTerminator(esc) {
				p.readRune()
				continue
			}
			p.readRune()
			switch esc {
			case 'b':
				b.WriteByte('\b')
			case 'f':
				b.WriteByte('\f')
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			case 'v':
				b.WriteByte('\v')
			case '0':
				// JSON5 requires that \0 is not followed by a decimal digit.
				if p.pos < len(p.src) {
					next := p.peekRune()
					if next >= '0' && next <= '9' {
						return nil, p.errorf("invalid escape: \\0 followed by digit")
					}
				}
				b.WriteByte(0)
			case 'x':
				if p.pos+2 > len(p.src) {
					return nil, p.errorf("invalid \\x escape")
				}
				v, err := parseHex(p.src[p.pos : p.pos+2])
				if err != nil {
					return nil, p.errorf("invalid \\x escape: %v", err)
				}
				for i := 0; i < 2; i++ {
					p.readRune()
				}
				b.WriteRune(rune(v))
			case 'u':
				v, err := p.readHex4()
				if err != nil {
					return nil, err
				}
				b.WriteRune(v)
			case '"', '\'', '\\', '/':
				b.WriteRune(esc)
			default:
				if esc >= '1' && esc <= '9' {
					return nil, p.errorf("invalid escape: \\%c", esc)
				}
				// Any other char: identity escape.
				b.WriteRune(esc)
			}
			continue
		}
		// Ordinary char.
		p.readRune()
		b.WriteRune(r)
	}
}

// readHex4 reads exactly four hex digits and returns the rune they encode.
func (p *parser) readHex4() (rune, error) {
	if p.pos+4 > len(p.src) {
		return 0, p.errorf("invalid unicode escape")
	}
	v, err := parseHex(p.src[p.pos : p.pos+4])
	if err != nil {
		return 0, p.errorf("invalid unicode escape: %v", err)
	}
	for i := 0; i < 4; i++ {
		p.readRune()
	}
	return rune(v), nil
}

func parseHex(s string) (int, error) {
	n := 0
	for _, c := range s {
		n <<= 4
		switch {
		case c >= '0' && c <= '9':
			n |= int(c - '0')
		case c >= 'a' && c <= 'f':
			n |= int(c-'a') + 10
		case c >= 'A' && c <= 'F':
			n |= int(c-'A') + 10
		default:
			return 0, fmt.Errorf("not a hex digit: %q", c)
		}
	}
	return n, nil
}

// parseLiteral parses a number, keyword, or signed Infinity/NaN.
func (p *parser) parseLiteral() (any, error) {
	start := p.pos
	r := p.peekRune()

	sign := 1
	if r == '+' || r == '-' {
		if r == '-' {
			sign = -1
		}
		p.readRune()
		r = p.peekRune()
	}

	// Keyword literals (only valid without sign).
	if sign == 1 && p.pos == start {
		// impossible, kept for symmetry
	}
	if p.pos == start+0 || p.pos == start+1 {
		// Check for keyword-only identifiers when no sign has been consumed.
	}

	// Check for Infinity / NaN / true / false / null.
	if r == 'I' || r == 'N' {
		if kw, ok := p.tryKeyword("Infinity"); ok && kw {
			return math.Inf(sign), nil
		}
		if kw, ok := p.tryKeyword("NaN"); ok && kw {
			return math.NaN(), nil
		}
		p.pos = start
		return nil, p.errorf("invalid literal")
	}
	if sign == 1 {
		if kw, ok := p.tryKeyword("true"); ok && kw {
			return true, nil
		}
		if kw, ok := p.tryKeyword("false"); ok && kw {
			return false, nil
		}
		if kw, ok := p.tryKeyword("null"); ok && kw {
			return nil, nil
		}
	}

	// Otherwise we are parsing a numeric literal.
	if !(r == '.' || (r >= '0' && r <= '9')) {
		p.pos = start
		return nil, p.errorf("invalid literal")
	}

	// Hex.
	if r == '0' && p.pos+1 < len(p.src) && (p.src[p.pos+1] == 'x' || p.src[p.pos+1] == 'X') {
		p.readRune() // 0
		p.readRune() // x
		hexStart := p.pos
		for p.pos < len(p.src) && isHexDigit(p.src[p.pos]) {
			p.readRune()
		}
		if p.pos == hexStart {
			return nil, p.errorf("empty hex literal")
		}
		v, err := parseHex(p.src[hexStart:p.pos])
		if err != nil {
			return nil, p.errorf("invalid hex literal: %v", err)
		}
		if sign < 0 {
			return -int64(v), nil
		}
		return int64(v), nil
	}

	numStart := p.pos
	hasDigits := false
	hasDot := false
	hasExp := false
	// Integer part. JSON5 forbids leading zeros (so "010" is invalid), but
	// bare "0" and "0." are fine.
	intStart := p.pos
	for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
		hasDigits = true
		p.readRune()
	}
	intLen := p.pos - intStart
	if intLen >= 2 && p.src[intStart] == '0' {
		return nil, p.errorf("numbers cannot have leading zeros")
	}
	// Fractional part.
	if p.pos < len(p.src) && p.src[p.pos] == '.' {
		hasDot = true
		p.readRune()
		for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
			hasDigits = true
			p.readRune()
		}
	}
	if !hasDigits {
		return nil, p.errorf("invalid number literal")
	}
	// Exponent.
	if p.pos < len(p.src) && (p.src[p.pos] == 'e' || p.src[p.pos] == 'E') {
		hasExp = true
		p.readRune()
		if p.pos < len(p.src) && (p.src[p.pos] == '+' || p.src[p.pos] == '-') {
			p.readRune()
		}
		expStart := p.pos
		for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
			p.readRune()
		}
		if p.pos == expStart {
			return nil, p.errorf("invalid number exponent")
		}
	}

	lit := p.src[numStart:p.pos]
	// Use int64 for integer literals that fit, otherwise float64.
	if !hasDot && !hasExp {
		var n int64
		overflow := false
		for _, c := range lit {
			d := int64(c - '0')
			if n > (math.MaxInt64-d)/10 {
				overflow = true
				break
			}
			n = n*10 + d
		}
		if !overflow {
			if sign < 0 {
				return -n, nil
			}
			return n, nil
		}
	}
	f, err := parseFloat(lit)
	if err != nil {
		return nil, p.errorf("invalid number: %v", err)
	}
	if sign < 0 {
		f = -f
	}
	return f, nil
}

// tryKeyword returns (matched, consumed). It only matches if kw is followed
// by an identifier terminator (to avoid partial matches like `trueish`).
func (p *parser) tryKeyword(kw string) (bool, bool) {
	if p.pos+len(kw) > len(p.src) {
		return false, false
	}
	if p.src[p.pos:p.pos+len(kw)] != kw {
		return false, false
	}
	// Ensure next char isn't an identifier continuation.
	if p.pos+len(kw) < len(p.src) {
		next, _ := utf8.DecodeRuneInString(p.src[p.pos+len(kw):])
		if isIdentifierPart(next) {
			return false, false
		}
	}
	for i := 0; i < len(kw); i++ {
		p.readRune()
	}
	return true, true
}

func isHexDigit(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')
}

// parseFloat converts a JSON5 decimal literal to a float64. The literal may
// have a leading or trailing decimal point, which strconv.ParseFloat already
// accepts.
func parseFloat(s string) (float64, error) {
	// strconv.ParseFloat handles ".5" and "5." correctly.
	var f float64
	_, err := fmt.Sscanf(s, "%g", &f)
	return f, err
}
