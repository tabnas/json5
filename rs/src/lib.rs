// Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License

// The engine's error carries a code, position, hint and a formatted
// report, so it is large by design and `Result<_, TabnasError>` trips
// clippy's `result_large_err`. The engine allows the lint at its own
// crate root for the same reason; boxing here would make `parse` return
// a different shape from `Tabnas::parse` and from the other two ports.
#![allow(clippy::result_large_err)]

//! The JSON5 grammar plugin for the `tabnas` parsing engine.
//!
//! JSON5 is JSON plus comments, unquoted keys, trailing commas, single
//! quotes, hex numbers, `Infinity` and `NaN`, leading and trailing
//! decimal points, explicit `+` signs, and string line continuations.
//! The plugin layers on the relaxed-JSON base grammar of
//! [`tabnas_jsonic`] and then TIGHTENS it toward the JSON5 specification:
//! no implicit top-level `a:1` or `1,2`, no auto-close at the end of the
//! source, no unquoted text at a value position, and only ECMAScript 5.1
//! `IdentifierName`s as unquoted keys.
//!
//! ```
//! let value = tabnas_json5::parse("{ a: 1, b: [2, 3,], }")?;
//! assert_eq!(value.to_string(), r#"{"a":1,"b":[2,3]}"#);
//! # Ok::<(), tabnas_json5::Json5Error>(())
//! ```
//!
//! TypeScript is canonical: `ts/src/json5.ts` and the shared
//! `json5-grammar.jsonic` define behaviour and option defaults. The
//! shared fixtures in `test/spec/*.tsv` and the vendored
//! `test/json5-tests` corpus are the parity contract across TypeScript,
//! Go and Rust.

use std::rc::Rc;
use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value as JsonValue};
use tabnas::{
    ActionError, AltSpec, Context, LexCheckResult, Plugin, PluginError, Rule, RuleSnapshot, Tabnas,
    Tin, Token, Value, ValueDef, TIN_NR, TIN_TX, TIN_ZZ,
};

/// This crate's version. It MUST equal `ts/package.json` "version": the
/// release orchestrator rewrites both, and `tests/version_test.rs` fails
/// the build if they drift. Mirrors `VERSION` in `ts/src/json5.ts` and
/// `const VERSION` in `go/json5.go`.
pub const VERSION: &str = "0.5.7";

/// The README's Rust examples run as doctests, so a stale one fails the
/// gate rather than misleading the reader. Its `toml` and `bash` fences
/// are skipped; rustdoc runs only the `rust` ones.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
mod readme_examples {}

/// The error a failed parse produces, re-exported so callers need not
/// depend on the engine crate directly. The Go port returns the same
/// `*jsonic.JsonicError`.
pub use tabnas::TabnasError as Json5Error;

/// The name the plugin registers under, and so the namespace of its
/// option bag on the engine.
const PLUGIN_NAME: &str = "json5";

/// The decoration under which the resolved options are recorded on the
/// instance, so [`parse_with`] can apply the `requireValue` rule and the
/// line-continuation rewrite. The Go port's `json5$requireValue`.
const OPTIONS_MARK: &str = "json5$options";

// ---------------------------------------------------------------------------
// The JSON5 character classes.
// ---------------------------------------------------------------------------

/// JSON5 WhiteSpace: HT, VT, FF, SP, NBSP, BOM, and the Unicode Zs
/// category characters the specification enumerates.
const JSON5_WHITESPACE: &str = "\t\u{000B}\u{000C} \u{00A0}\u{FEFF}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{202F}\u{205F}\u{3000}";

/// JSON5 LineTerminator: LF, CR, LS, PS.
const JSON5_LINE_TERMINATOR: &str = "\r\n\u{2028}\u{2029}";

/// The line terminators that bump the row counter: LF, LS, PS. CR is
/// folded into the following LF for CRLF.
const JSON5_ROW_CHARS: &str = "\n\u{2028}\u{2029}";

fn is_line_terminator(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// The plugin options: a strict JSON5 configuration by default, with the
/// relaxations jsonic offers beyond the specification opt-in. The
/// TypeScript `Json5Options` and the Go `Defaults()` map.
///
/// On the engine the options travel as a [`Value`] bag under the plugin
/// name, spelt with the TypeScript keys (`hashComment`, `requireValue`,
/// ...); [`Json5Options::to_value`] and [`Json5Options::from_value`]
/// convert, and a key the bag does not carry keeps its default, as the
/// Go `optBool` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Json5Options {
    /// Accept `Infinity`, `NaN` and their signed forms as numbers.
    pub infinity: bool,
    /// Accept `0x` hexadecimal integers.
    pub hex: bool,
    /// Accept `#` line comments (not JSON5).
    pub hash_comment: bool,
    /// Accept backtick-quoted strings (not JSON5).
    pub backtick_string: bool,
    /// Accept `_` digit separators in numbers (not JSON5).
    pub number_separator: bool,
    /// Accept `0o` octal integers (not JSON5).
    pub octal: bool,
    /// Accept `0b` binary integers (not JSON5).
    pub binary: bool,
    /// Require a top-level value: an empty, whitespace-only or
    /// comments-only source is an error (`json5_empty`,
    /// `json5_no_value`) rather than a `null` result.
    pub require_value: bool,
    /// Reject unquoted text at a value position, so `foo` is an error
    /// rather than the string `"foo"`.
    pub strict_value: bool,
}

impl Default for Json5Options {
    fn default() -> Self {
        Self {
            infinity: true,
            hex: true,
            hash_comment: false,
            backtick_string: false,
            number_separator: false,
            octal: false,
            binary: false,
            require_value: true,
            strict_value: true,
        }
    }
}

impl Json5Options {
    /// The option keys as the TypeScript plugin and the Go `Defaults()`
    /// map spell them: the keys [`Json5Options::to_value`] writes and
    /// [`Json5Options::from_value`] reads.
    pub const KEYS: [&str; 9] = [
        "infinity",
        "hex",
        "hashComment",
        "backtickString",
        "numberSeparator",
        "octal",
        "binary",
        "requireValue",
        "strictValue",
    ];

    fn get(&self, key: &str) -> bool {
        match key {
            "infinity" => self.infinity,
            "hex" => self.hex,
            "hashComment" => self.hash_comment,
            "backtickString" => self.backtick_string,
            "numberSeparator" => self.number_separator,
            "octal" => self.octal,
            "binary" => self.binary,
            "requireValue" => self.require_value,
            "strictValue" => self.strict_value,
            _ => unreachable!("every option key is listed"),
        }
    }

    fn set(&mut self, key: &str, value: bool) {
        match key {
            "infinity" => self.infinity = value,
            "hex" => self.hex = value,
            "hashComment" => self.hash_comment = value,
            "backtickString" => self.backtick_string = value,
            "numberSeparator" => self.number_separator = value,
            "octal" => self.octal = value,
            "binary" => self.binary = value,
            "requireValue" => self.require_value = value,
            "strictValue" => self.strict_value = value,
            _ => unreachable!("every option key is listed"),
        }
    }

    /// The options as the engine's plugin-option bag, keyed as the
    /// TypeScript plugin spells them.
    pub fn to_value(&self) -> Value {
        let mut map = IndexMap::new();
        for key in Self::KEYS {
            map.insert(key.to_string(), Value::Bool(self.get(key)));
        }
        Value::object(map)
    }

    /// Read a plugin-option bag. A key that is absent, or not a boolean,
    /// keeps its default, as the Go port's `optBool` does.
    pub fn from_value(bag: &Value) -> Self {
        let mut options = Self::default();
        if let Value::Object(map) = bag {
            for key in Self::KEYS {
                if let Some(Value::Bool(value)) = map.get(key) {
                    options.set(key, *value);
                }
            }
        }
        options
    }

    /// Read a JSON option object, the form the shared fixtures' `opts`
    /// column and the TypeScript tests use.
    pub fn from_json(bag: &JsonValue) -> Self {
        Self::from_value(&Value::from_json(bag))
    }
}

// ---------------------------------------------------------------------------
// The embedded grammar.
//
// Authored ONCE in `../json5-grammar.jsonic` and embedded into every
// runtime by `ts/embed-grammar.js`. Never hand-edit the text between the
// markers: edit the `.jsonic` file and re-run the embed. The text is
// jsonic, not JSON, and is parsed at plugin-install time by a standard
// jsonic instance, exactly as the TypeScript and Go ports parse it.
// ---------------------------------------------------------------------------

// --- BEGIN EMBEDDED json5-grammar.jsonic ---
const GRAMMAR_TEXT: &str = r#"# JSON5 Grammar Definition
# Parsed by a standard Jsonic instance and passed to jsonic.grammar()
# Function references (@ prefixed) are resolved against the refs map
# Regex references (@/pattern/flags) are resolved to RegExp instances
# Bare identifiers (UPPER_SNAKE_CASE) are placeholders overridden by the
# plugin code before the spec is applied.
#
# This file captures the strict-JSON5 baseline. The plugin layers
# option-dependent overrides (hash comments, backtick strings, octal /
# binary / separator numbers, Infinity / NaN keywords, etc.) on top.

{
  # Drop Jsonic's implicit top-level list / map alternates so `a:1` and
  # `1,2` are not accepted at the document root. JSON5 requires a single
  # value expression at top level.
  #
  # `finish: false` turns off Jsonic's auto-close of open rules at the end
  # of the source: JSON5 requires every `{` / `[` to be closed, so `{a:1`
  # is an error, not `{"a":1}`.
  options: rule: { exclude: 'imp' finish: false }

  # Restrict the token sets used by Jsonic's grammar rules:
  #   VAL drops #TX — reject bare unquoted text at value positions.
  #   KEY drops #NR — reject numeric keys like `{10: 1}`.
  options: tokenSet: {
    VAL: [ '#ST' '#NR' '#VL' ]
    KEY: [ '#TX' '#ST' '#VL' ]
  }

  # Whitespace and line-terminator sets are broadened to match the JSON5
  # spec (Unicode Zs, BOM, LS / PS). The actual character strings are
  # supplied by the plugin because they contain code points the grammar
  # parser cannot round-trip losslessly.
  options: space: { chars: JSON5_WHITESPACE }
  options: line: {
    chars: JSON5_LINE_TERMINATOR
    rowChars: JSON5_ROW_CHARS
  }

  # LexCheck hooks close the last gaps the built-in lexer has against
  # the JSON5 spec:
  #   fixed.check  preprocesses backslash+CRLF inside strings.
  #   text.check   rejects unquoted text that cannot start a valid
  #                JSON5 IdentifierName AND is not a registered value
  #                keyword or regex-matched number.
  #   string.check rejects the escape sequences ECMAScript 5.1 forbids
  #                inside a string literal but the permissive lexer
  #                would otherwise accept (`\1`..`\9`, `\0` followed by
  #                a digit, and the ES2015-only `\u{...}` form).
  options: fixed: { check: '@fixed-check' }
  options: text:  { check: '@text-check' }

  # JSON5 numeric literals: allow hex, disallow octal / binary / digit
  # separators. Reject JS-style leading-zero integers (`010`, `-098`).
  options: number: {
    lex: true
    hex: true
    oct: false
    bin: false
    sep: ''
    exclude: '@/^[+-]?0[0-9]/'
  }

  # JSON5 comments are `//` and `/* */`. Hash comments are disabled here
  # and only enabled by the plugin when the `hashComment` option is set.
  options: comment: {
    def: {
      slash: { line: true start: '//' lex: true eatline: false }
      multi: { line: false start: '/*' end: '*/' lex: true eatline: false }
      hash:  { line: true start: '#' lex: false eatline: false }
    }
  }

  # JSON5 strings: single or double quote, with ES5.1 escapes plus line
  # continuations (backslash + line terminator produces an empty string).
  options: string: {
    lex: true
    check: '@string-check'
    chars: JSON5_QUOTE_CHARS
    multiChars: JSON5_MULTI_QUOTE_CHARS
    escapeChar: '\\'
    escape: {
      b:  '\b'
      f:  '\f'
      n:  '\n'
      r:  '\r'
      t:  '\t'
      v:  '\v'
      '0': '\u0000'
      '"': '"'
      "'": "'"
      '`': '`'
      '\\': '\\'
      '/': '/'
      # JSON5 line continuation: backslash + LineTerminatorSequence.
      '\n': ''
      '\r': ''
      '\u2028': ''
      '\u2029': ''
    }
    allowUnknown: true
  }

  # Value keywords. The Infinity / NaN family is layered on by the
  # plugin (because the numeric literals cannot be round-tripped through
  # this grammar parser as actual JS numbers). The regex-matched
  # defs pick up number shapes the built-in number lexer does not
  # recognise — trailing-decimal-with-exponent (`5.e4`) and uppercase
  # `0X` hex — so both TS and Go exhibit the same behaviour on those.
  options: value: {
    lex: true
    def: {
      true:  { val: true }
      false: { val: false }
      null:  { val: null }

      trailingDecExp: {
        match:   '@/^[+-]?(?:0|[1-9][0-9]*)\\.[eE][+-]?[0-9]+/'
        val:     '@parse-trailing-dec-exp'
        consume: true
      }

      uppercaseHex: {
        match:   '@/^[+-]?0X[0-9a-fA-F]+/'
        val:     '@parse-uppercase-hex'
        consume: true
      }
    }
  }

  # JSON5 objects extend on duplicate keys (last wins); no bare-colon
  # child syntax. Lists are strict — no named properties, pairs, or
  # bare-colon children.
  options: map:  { extend: true  child: false }
  options: list: { property: false pair: false child: false }

  # Reject an entirely empty source. A comments-only source is handled
  # in code by dropping the `#ZZ jsonic` alternate from the val rule.
  options: lex: { empty: false emptyResult: null }

  options: error: {
    json5_empty:    'JSON5 input must contain a value'
    json5_no_value: 'JSON5 input must contain a value'
  }
  options: hint: {
    json5_empty: 'JSON5 requires a top-level value. An empty source is not a valid JSON5 document.'
    json5_no_value: 'JSON5 requires a top-level value. A source that consists only of whitespace and comments is not valid.'
  }
}
"#;
// --- END EMBEDDED json5-grammar.jsonic ---

// ---------------------------------------------------------------------------
// Identifier names.
// ---------------------------------------------------------------------------

/// ECMAScript 5.1 `IdentifierStart` CHARACTER: `$`, `_`, or a Unicode
/// letter (`L`) or letter number (`Nl`). The `\` that introduces a
/// `UnicodeEscapeSequence` is not included; see [`is_identifier_start`].
fn id_start(ch: char) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    ch == '$'
        || ch == '_'
        || RE
            .get_or_init(|| Regex::new(r"^[\p{L}\p{Nl}]$").expect("a literal pattern"))
            .is_match(ch.encode_utf8(&mut [0; 4]))
}

/// ECMAScript 5.1 `IdentifierPart`: an `IdentifierStart`, a combining
/// mark (`Mn`, `Mc`), a digit (`Nd`), a connector punctuation (`Pc`),
/// ZWNJ or ZWJ.
fn id_part(ch: char) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    id_start(ch)
        || ch == '\u{200C}'
        || ch == '\u{200D}'
        || RE
            .get_or_init(|| Regex::new(r"^[\p{Mn}\p{Mc}\p{Nd}\p{Pc}]$").expect("a literal pattern"))
            .is_match(ch.encode_utf8(&mut [0; 4]))
}

/// Whether `ch` may begin a JSON5 `IdentifierName` in the SOURCE text: an
/// `IdentifierStart` character, or the `\` of a `UnicodeEscapeSequence`.
fn is_identifier_start(ch: char) -> bool {
    ch == '\\' || id_start(ch)
}

/// Validate AND decode a JSON5 `IdentifierName` (used for unquoted keys).
/// `None` when the source is not a legal ECMAScript 5.1 `IdentifierName`.
///
/// An `IdentifierStart` / `IdentifierPart` may be written as a
/// `UnicodeEscapeSequence` (`\uXXXX`), and the identifier's VALUE is the
/// decoded text: `{ sigΣma: 1 }` has the key `sigΣma`. Each escape
/// contributes exactly one UTF-16 code unit, which must itself be a legal
/// identifier character: per ES5.1 7.6 an escape cannot smuggle an
/// otherwise-illegal character into an identifier, so ` `, `-`, a leading
/// `0` and escaped surrogate halves are all rejected. Mirrors the
/// TypeScript and Go `decodeIdentifierName`.
fn decode_identifier_name(source: &str) -> Option<String> {
    if source.is_empty() {
        return None;
    }
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len());
    let mut first = true;
    let mut i = 0;
    while i < bytes.len() {
        let ch = if bytes[i] == b'\\' {
            if i + 6 > bytes.len()
                || bytes[i + 1] != b'u'
                || !bytes[i + 2..i + 6].iter().all(u8::is_ascii_hexdigit)
            {
                return None;
            }
            let unit = u32::from_str_radix(&source[i + 2..i + 6], 16).ok()?;
            // A lone UTF-16 surrogate half is not an identifier character.
            if (0xD800..=0xDFFF).contains(&unit) {
                return None;
            }
            i += 6;
            char::from_u32(unit)?
        } else {
            let ch = source[i..].chars().next()?;
            i += ch.len_utf8();
            ch
        };
        if first {
            if !id_start(ch) {
                return None;
            }
            first = false;
        } else if !id_part(ch) {
            return None;
        }
        out.push(ch);
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// String line continuations.
// ---------------------------------------------------------------------------

/// Remove JSON5 string line continuations: a backslash immediately
/// followed by a `LineTerminatorSequence` (CRLF, CR, LF, LS, PS) produces
/// nothing, letting a string span lines. CRLF is handled first so the
/// two-character sequence is consumed before a lone CR / LF.
///
/// A `LineContinuation` is only part of the STRING grammar, so the scan
/// tracks lexical context and rewrites inside string literals only. A
/// blanket replace would also splice out a backslash-newline sitting in a
/// comment (extending the comment over the following line, swallowing
/// real tokens) or between tokens (silently accepting `[1,\<LF>2]`).
/// Mirrors the TypeScript and Go `stripLineContinuations`.
fn strip_line_continuations(src: &str, quotes: &str, esc: char, hash_comment: bool) -> String {
    if !src.contains(esc) {
        return src.to_string();
    }
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = src[i..].chars().next().expect("inside the source");
        let size = c.len_utf8();

        // Comments are copied through verbatim.
        if c == '/' && src[i + size..].starts_with('/') {
            let mut j = i + size + 1;
            while j < bytes.len() {
                let r = src[j..].chars().next().expect("inside the source");
                if is_line_terminator(r) {
                    break;
                }
                j += r.len_utf8();
            }
            out.push_str(&src[i..j]);
            i = j;
            continue;
        }
        if hash_comment && c == '#' {
            let mut j = i + size;
            while j < bytes.len() {
                let r = src[j..].chars().next().expect("inside the source");
                if is_line_terminator(r) {
                    break;
                }
                j += r.len_utf8();
            }
            out.push_str(&src[i..j]);
            i = j;
            continue;
        }
        if c == '/' && src[i + size..].starts_with('*') {
            let j = src[i + size + 1..]
                .find("*/")
                .map_or(bytes.len(), |end| i + size + 1 + end + 2);
            out.push_str(&src[i..j]);
            i = j;
            continue;
        }

        // Inside a string literal: drop escape+LineTerminatorSequence, copy
        // any other escape pair whole so an escaped quote does not end the
        // scan.
        if quotes.contains(c) {
            let quote = c;
            out.push(c);
            i += size;
            while i < bytes.len() {
                let d = src[i..].chars().next().expect("inside the source");
                let dsize = d.len_utf8();
                if d == esc {
                    if i + dsize >= bytes.len() {
                        out.push(d);
                        i += dsize;
                        break;
                    }
                    let n = src[i + dsize..].chars().next().expect("inside the source");
                    let nsize = n.len_utf8();
                    if n == '\r' && src[i + dsize + nsize..].starts_with('\n') {
                        i += dsize + nsize + 1;
                        continue;
                    }
                    if is_line_terminator(n) {
                        i += dsize + nsize;
                        continue;
                    }
                    out.push_str(&src[i..i + dsize + nsize]);
                    i += dsize + nsize;
                    continue;
                }
                out.push(d);
                i += dsize;
                if d == quote {
                    break;
                }
            }
            continue;
        }

        out.push(c);
        i += size;
    }
    out
}

// ---------------------------------------------------------------------------
// The requireValue rule.
// ---------------------------------------------------------------------------

/// Does `src` contain anything that could begin a value, as opposed to
/// only whitespace and comments? JSON5 requires a top-level value, and a
/// comments-only document is exactly what `json5_no_value` names.
///
/// This deliberately does NOT lex or parse. It only has to find the FIRST
/// character that is neither whitespace nor part of a comment, and stop
/// there, which is what makes it safe. The trap in a naive "strip the
/// comments and see what is left" is a source like `"/* x */"`: a valid
/// JSON5 STRING whose contents look like a comment, which stripping would
/// wrongly report as empty. Here the leading quote is simply a non-trivia
/// character, so the scan stops on it and answers true without ever
/// looking inside.
///
/// An unterminated block comment answers TRUE on purpose. `/* x` contains
/// no value, but the engine's own `unterminated_comment` is the more
/// useful diagnostic and this declines to shadow it.
///
/// Mirrors `hasValue` in `ts/src/json5.ts` and `go/json5.go`.
fn has_value(src: &str) -> bool {
    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut i = 0;
    while i < n {
        let c = chars[i];
        if is_json5_space(c) {
            i += 1;
            continue;
        }
        if c == '/' && i + 1 < n {
            let d = chars[i + 1];
            if d == '/' {
                // Line comment: runs to the next line terminator, or the end.
                i += 2;
                while i < n && !is_line_terminator(chars[i]) {
                    i += 1;
                }
                continue;
            }
            if d == '*' {
                let end =
                    (i + 2..n.saturating_sub(1)).find(|&k| chars[k] == '*' && chars[k + 1] == '/');
                let Some(end) = end else {
                    return true; // unterminated: leave it to unterminated_comment
                };
                i = end + 2;
                continue;
            }
        }
        // Anything else begins something. Whether it is a VALID value is
        // the parser's question, not this one.
        return true;
    }
    false
}

/// The ECMAScript `\s` class, which is the JSON5 whitespace and line
/// terminator set: `White_Space` minus NEL, plus the BOM. Named here
/// rather than borrowed from `char::is_whitespace`, which includes U+0085
/// and excludes U+FEFF, so the intent survives the difference.
fn is_json5_space(c: char) -> bool {
    c == '\u{FEFF}' || (c.is_whitespace() && c != '\u{0085}')
}

// ---------------------------------------------------------------------------
// Grammar alternate helpers.
// ---------------------------------------------------------------------------

fn tag_contains(tags: &str, want: &str) -> bool {
    tags.split(',').any(|tag| tag.trim() == want)
}

/// Remove `tin` from every slot of every alternate tagged `required_tag`.
fn filter_tin_from_alts(alts: &mut [AltSpec], tin: Tin, required_tag: &str) {
    for alt in alts.iter_mut() {
        if !tag_contains(&alt.g, required_tag) {
            continue;
        }
        for slot in alt.s.iter_mut() {
            slot.retain(|t| *t != tin);
        }
    }
}

/// jsonic's `#ZZ` end-of-source alternate: the one that lets a source
/// holding no value succeed.
fn is_zz_jsonic_alt(alt: &AltSpec) -> bool {
    tag_contains(&alt.g, "jsonic")
        && alt.s.len() == 1
        && alt.s[0].len() == 1
        && alt.s[0][0] == TIN_ZZ
}

/// The pattern inside a serialized `@/pattern/flags` regular expression
/// (the flags are not used by this grammar), or `None` for any other
/// string.
fn bare_regex_source(source: &str) -> Option<&str> {
    let body = source.strip_prefix("@/")?;
    let slash = body.rfind('/')?;
    Some(&body[..slash])
}

/// A serialized regular expression, compiled for the `regex` crate.
fn compile_serialized_regex(source: &str) -> Option<Regex> {
    Regex::new(bare_regex_source(source)?).ok()
}

// ---------------------------------------------------------------------------
// Base-prefixed integer literals.
//
// `0x`, `0o` and `0b` literals are read as an EXACT integer and rounded
// to a double ONCE. The obvious fold -- `value = value * base + digit`
// in `f64` -- rounds at every digit, and past the 53-bit exact integer
// range those roundings accumulate: `0Xa6f2f78f4f9bf44` came out as
// `43a4de5ef1e9f37e` where canonical TypeScript's `parseInt` answers
// `43a4de5ef1e9f37f`, one unit in the last place low. That is silently
// altered data, not a formatting difference.
//
// `parseInt` on a base-prefixed digit string is correctly rounded from
// the exact integer, half to even, so that is what these reproduce. The
// zon port solves the same problem over general bases in
// `zon/rs/src/number.rs`; the bases here are all powers of two, so a
// `u128` head plus a sticky bit replaces its limb arithmetic.
// ---------------------------------------------------------------------------

/// `2^k` for a non-negative `k`, exactly, saturating to infinity above
/// the double range. A repeated multiply would round on the way up.
/// Mirrors `pow2` in the zon port.
fn pow2(k: i64) -> f64 {
    debug_assert!(k >= 0, "only non-negative exponents arise here");
    if k > 1023 {
        f64::INFINITY
    } else {
        f64::from_bits(((k + 1023) as u64) << 52)
    }
}

/// The exact integer the digit values denote, as the NEAREST double,
/// rounding half to even. `bits` is the width of one digit, so the base
/// is a power of two: 1 for binary, 3 for octal, 4 for hexadecimal.
fn digits_to_f64(digits: &[u32], bits: u32) -> f64 {
    // Leading zeros carry no value, and dropping them is what makes the
    // head below wider than the 54 significant bits the rounding needs.
    let start = digits.iter().position(|digit| *digit != 0);
    let Some(start) = start else {
        return 0.0;
    };
    let digits = &digits[start..];

    // A u128 holds exactly this many digits of the base.
    let head_len = (128 / bits) as usize;
    let pack = |run: &[u32]| {
        run.iter()
            .fold(0u128, |value, digit| (value << bits) | u128::from(*digit))
    };
    if digits.len() <= head_len {
        // A `u128` to `f64` cast rounds to nearest, ties to even, which
        // is the rule `parseInt` follows.
        return pack(digits) as f64;
    }

    // Longer than a u128: keep the top `head_len` digits, and remember
    // whether anything below them was set. Those two are all the
    // rounding can depend on. The leading digit is non-zero, so the head
    // is at least 121 bits wide in every base here and `shift` is
    // comfortably positive.
    let head = pack(&digits[..head_len]);
    let tail = &digits[head_len..];
    let dropped = i64::from(bits) * tail.len() as i64;
    let shift = 128 - head.leading_zeros() - 53;

    let mut mantissa = (head >> shift) as u64;
    let half = (head >> (shift - 1)) & 1 == 1;
    let sticky = head & ((1u128 << (shift - 1)) - 1) != 0 || tail.iter().any(|digit| *digit != 0);
    if half && (sticky || mantissa & 1 == 1) {
        // At most 2^53, which is still an exact double.
        mantissa += 1;
    }
    mantissa as f64 * pow2(dropped + i64::from(shift))
}

/// The value of a base-prefixed integer literal -- `0x1F`, `-0o17`,
/// `+0b1010`, with an optional `separator` between digits -- or `None`
/// when `src` is not one.
///
/// This is deliberately tolerant about which prefixes it reads: whether
/// a literal is ACCEPTED is settled by the lexer and by the `hex` /
/// `octal` / `binary` options long before this runs, and re-deciding it
/// here would be a second copy of that rule.
fn radix_literal_value(src: &str, separator: Option<char>) -> Option<f64> {
    let (negative, rest) = match src.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, src.strip_prefix('+').unwrap_or(src)),
    };
    let rest = rest.strip_prefix('0')?;
    let mut characters = rest.chars();
    let bits = match characters.next()? {
        'x' | 'X' => 4,
        'o' | 'O' => 3,
        'b' | 'B' => 1,
        _ => return None,
    };
    let base = 1u32 << bits;

    let mut digits = Vec::new();
    for character in characters {
        if Some(character) == separator {
            continue;
        }
        digits.push(character.to_digit(base)?);
    }
    if digits.is_empty() {
        return None;
    }

    let magnitude = digits_to_f64(&digits, bits);
    Some(if negative { -magnitude } else { magnitude })
}

// ---------------------------------------------------------------------------
// The plugin.
// ---------------------------------------------------------------------------

/// The names the grammar document binds.
const FIXED_CHECK: &str = "@fixed-check";
const TEXT_CHECK: &str = "@text-check";
const STRING_CHECK: &str = "@string-check";
const PARSE_TRAILING_DEC_EXP: &str = "@parse-trailing-dec-exp";
const PARSE_UPPERCASE_HEX: &str = "@parse-uppercase-hex";
/// The `pair` after-open validator this plugin adds in code.
const PAIR_KEY_CHECK: &str = "@json5-pair-key";

/// The `pair` after-open action: reject a `#TX` key whose source is not a
/// JSON5 `IdentifierName`, and rewrite one written with `\uXXXX` escapes
/// to its decoded text. jsonic's `@pairkey` alternate action has already
/// copied the raw token value into `u.key`, so both are updated.
fn pair_key_check(
    rule: &mut Rule,
    _context: &mut Context,
    _next: Option<&RuleSnapshot>,
    out: Option<Token>,
) -> Result<Option<Token>, ActionError> {
    let Some(token) = rule.o0().filter(|token| token.tin == TIN_TX) else {
        return Ok(out);
    };
    let Some(name) = decode_identifier_name(token.src.as_str()) else {
        let mut bad = token.clone();
        bad.bad("unexpected");
        return Ok(Some(bad));
    };
    if token.val != Value::String(name.clone()) {
        Rc::make_mut(&mut rule.o)[0].val = Value::String(name.clone());
        rule.u_mut().insert("key".to_string(), Value::String(name));
    }
    Ok(out)
}

/// Parse the embedded grammar with a standard jsonic instance and patch
/// the placeholders and the option-dependent overrides, exactly as the
/// TypeScript and Go plugins do before `grammar()`.
fn grammar_document(options: &Json5Options) -> Result<JsonValue, PluginError> {
    let parsed = tabnas_jsonic::make().parse(GRAMMAR_TEXT).map_err(|error| {
        PluginError(format!(
            "json5: the embedded grammar does not parse: {error}"
        ))
    })?;
    let mut document = parsed.to_json();
    if !document.get("options").is_some_and(JsonValue::is_object) {
        return Err(PluginError(
            "json5: the embedded grammar has no `options` table".into(),
        ));
    }
    let opts = &mut document["options"];

    // Substitute the placeholder bare-identifier strings with the real
    // character sets. (The grammar parser cannot round-trip some of these
    // code points safely as string literals.)
    opts["space"]["chars"] = json!(JSON5_WHITESPACE);
    opts["line"]["chars"] = json!(JSON5_LINE_TERMINATOR);
    opts["line"]["rowChars"] = json!(JSON5_ROW_CHARS);
    if options.backtick_string {
        opts["string"]["chars"] = json!("'\"`");
        opts["string"]["multiChars"] = json!("`");
    } else {
        opts["string"]["chars"] = json!("'\"");
        opts["string"]["multiChars"] = json!("");
    }

    // Option-dependent overrides applied on top of the strict baseline.
    opts["number"]["hex"] = json!(options.hex);
    opts["number"]["oct"] = json!(options.octal);
    opts["number"]["bin"] = json!(options.binary);
    opts["number"]["sep"] = if options.number_separator {
        json!("_")
    } else {
        JsonValue::Null
    };
    opts["comment"]["def"]["hash"]["lex"] = json!(options.hash_comment);
    opts["lex"]["empty"] = json!(!options.require_value);

    // `options.number.exclude` is a bare pattern on this engine, where a
    // `value.def.match` is the serialized `@/pattern/` form; the loader
    // stores the string as it is, so the wrapper is taken off here.
    if let Some(exclude) = opts["number"]["exclude"].as_str() {
        if let Some(bare) = bare_regex_source(exclude) {
            opts["number"]["exclude"] = json!(bare);
        }
    }

    if !options.strict_value {
        if let Some(sets) = opts["tokenSet"].as_object_mut() {
            sets.shift_remove("VAL");
        }
    }
    Ok(document)
}

/// The `Infinity` / `NaN` family the plugin layers on in code: the
/// values cannot be round-tripped through the grammar parser as numbers.
const INFINITY_DEFINITIONS: [(&str, f64); 6] = [
    ("Infinity", f64::INFINITY),
    ("+Infinity", f64::INFINITY),
    ("-Infinity", f64::NEG_INFINITY),
    ("NaN", f64::NAN),
    ("+NaN", f64::NAN),
    ("-NaN", f64::NAN),
];

/// The value keywords and value regexes in force, so the text check can
/// let them through: the ones the document declares, plus the
/// `Infinity` family when the option is on.
fn value_definitions(document: &JsonValue, options: &Json5Options) -> (Vec<String>, Vec<Regex>) {
    let mut names = Vec::new();
    let mut regexes = Vec::new();
    if let Some(defs) = document["options"]["value"]["def"].as_object() {
        for (name, def) in defs {
            match def.get("match").and_then(JsonValue::as_str) {
                Some(source) => regexes.extend(compile_serialized_regex(source)),
                None => names.push(name.clone()),
            }
        }
    }
    if options.infinity {
        names.extend(
            INFINITY_DEFINITIONS
                .iter()
                .map(|(name, _)| name.to_string()),
        );
    }
    (names, regexes)
}

/// The keywords the document declares with `val: null`. The JSON loader
/// reads a null `val` as "no value" and the keyword would come back as
/// its own text, so these are put back as [`Value::Null`] after install.
fn null_keywords(document: &JsonValue) -> Vec<String> {
    document["options"]["value"]["def"]
        .as_object()
        .map(|defs| {
            defs.iter()
                .filter(|(_, def)| def.get("val").is_some_and(JsonValue::is_null))
                .map(|(name, _)| name.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Install JSON5 on `parser`, which must already carry the jsonic grammar
/// (from [`tabnas_jsonic::make`], or [`tabnas_jsonic::jsonic`] on a bare
/// engine). The counterpart of the TypeScript `Json5` plugin function and
/// the Go `Json5(j, opts)`.
///
/// Most callers want [`make`] / [`make_with`], or [`plugin`] with
/// [`Tabnas::use_plugin`], which record the options on the instance the
/// same way this does.
///
/// ```
/// let mut parser = tabnas_jsonic::make();
/// tabnas_json5::json5(&mut parser, &tabnas_json5::Json5Options::default())?;
/// let value = tabnas_json5::parse_with(&parser, "{ a: 0x1F, b: [+Infinity, NaN] }")?;
/// assert_eq!(value.to_json()["a"], 31.0);
/// assert_eq!(value.to_json()["b"], serde_json::json!([null, null]));
/// let tabnas::Value::Object(map) = &value else { panic!("not an object") };
/// let tabnas::Value::Array(numbers) = &map["b"] else { panic!("not an array") };
/// assert_eq!(numbers[0], tabnas::Value::Number(f64::INFINITY));
/// assert!(matches!(numbers[1], tabnas::Value::Number(n) if n.is_nan()));
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
pub fn json5(parser: &mut Tabnas, options: &Json5Options) -> Result<(), PluginError> {
    let options = *options;

    let document = grammar_document(&options)?;
    let (value_names, value_regexes) = value_definitions(&document, &options);
    let null_keywords = null_keywords(&document);

    // The refs the document names, registered before it is installed.
    //
    // `@fixed-check` is where the TypeScript and Go plugins rewrite the
    // lexer's source to strip string line continuations. A Rust lexer
    // check cannot replace the source it is lexing (the lexer borrows
    // it), so the rewrite lives in `parse_with` and the hook is a no-op
    // that only satisfies the reference.
    parser.lex_check_ref(FIXED_CHECK, |_| LexCheckResult::Continue);

    // Reject unquoted text that cannot start a valid JSON5 IdentifierName
    // AND is not a value keyword or a value regex match. Skipping the text
    // matcher leaves the character unclaimed, so the lexer raises
    // `unexpected` there, the same outcome as the TypeScript
    // `{ done: true, token: undefined }`.
    parser.lex_check_ref(TEXT_CHECK, move |remaining: &str| {
        let Some(first) = remaining.chars().next() else {
            return LexCheckResult::Continue;
        };
        if is_identifier_start(first)
            || value_names
                .iter()
                .any(|name| remaining.starts_with(name.as_str()))
            || value_regexes.iter().any(|regex| regex.is_match(remaining))
        {
            LexCheckResult::Continue
        } else {
            LexCheckResult::Skip
        }
    });

    // Reject the escape sequences ECMAScript 5.1, and hence JSON5, forbids
    // inside a string literal but the engine's permissive escape handling
    // (allowUnknown, non-strict `\u{...}`) would otherwise accept:
    //   \1 .. \9    a DecimalDigit is an EscapeCharacter, so it is not a
    //               NonEscapeCharacter: legacy octal escapes are not JSON5.
    //   \0<digit>   `0` is an escape only when NOT followed by a DecimalDigit.
    //   \u{XXXX}    the ES2015 code-point form; JSON5 has only `\uXXXX`.
    let quotes = document["options"]["string"]["chars"]
        .as_str()
        .unwrap_or("'\"")
        .to_string();
    parser.lex_check_ref(STRING_CHECK, move |remaining: &str| {
        let bytes = remaining.as_bytes();
        let Some(quote) = remaining
            .chars()
            .next()
            .filter(|quote| quotes.contains(*quote))
        else {
            return LexCheckResult::Continue;
        };
        let mut i = quote.len_utf8();
        while i < bytes.len() {
            let c = remaining[i..].chars().next().expect("inside the source");
            let size = c.len_utf8();
            if c == quote {
                break;
            }
            if c != '\\' {
                i += size;
                continue;
            }
            if i + size >= bytes.len() {
                break;
            }
            let next = bytes[i + size];
            let after = bytes.get(i + size + 1).copied().unwrap_or(0);
            if next.is_ascii_digit() && (next != b'0' || after.is_ascii_digit())
                || (next == b'u' && after == b'{')
            {
                return LexCheckResult::Skip;
            }
            // Skip the escape lead and the character it escapes.
            let escaped = remaining[i + size..].chars().next().expect("checked above");
            i += size + escaped.len_utf8();
        }
        LexCheckResult::Continue
    });

    // Trailing-decimal-with-exponent (`5.e4`) and uppercase `0X` hex: the
    // number shapes the built-in lexer misses, matched by regex value
    // definitions so every runtime agrees on them.
    parser.value_transform_ref(PARSE_TRAILING_DEC_EXP, |groups: &[String]| {
        let literal = groups.first().map(String::as_str).unwrap_or_default();
        let (mantissa, exponent) = literal.split_once(['e', 'E']).unwrap_or((literal, "0"));
        Value::Number(
            format!("{}e{exponent}", mantissa.trim_end_matches('.'))
                .parse()
                .unwrap_or(f64::NAN),
        )
    });
    parser.value_transform_ref(PARSE_UPPERCASE_HEX, |groups: &[String]| {
        // The regex admits no digit separator, so none is passed.
        let literal = groups.first().map(String::as_str).unwrap_or_default();
        Value::Number(radix_literal_value(literal, None).unwrap_or(f64::NAN))
    });

    parser.state_action_with_next_ref(PAIR_KEY_CHECK, pair_key_check);

    let spec = tabnas::GrammarSpec::from_value(document).map_err(|error| PluginError(error.0))?;
    parser
        .grammar(&spec)
        .map_err(|error| PluginError(error.0))?;

    // Infinity / NaN cannot be round-tripped through the grammar parser as
    // actual numbers, so layer them on here; and the `null` keyword's
    // value cannot travel as JSON null, so it is put back the same way.
    parser
        .set_options(|o| {
            for name in &null_keywords {
                if let Some(def) = o.value.definitions.get_mut(name) {
                    def.val = Some(Value::Null);
                }
            }
            if options.infinity {
                for (name, value) in INFINITY_DEFINITIONS {
                    o.value.definitions.insert(
                        name.to_string(),
                        ValueDef {
                            val: Some(Value::Number(value)),
                            matcher: None,
                            transform: None,
                            consume: false,
                        },
                    );
                }
            }
        })
        .map_err(|error| PluginError(error.0))?;

    // Grammar alternates resolve token sets when they are installed, so
    // the `tokenSet` the document declares does not reach jsonic's
    // pre-built `val` and `pair` alternates. Filter `#TX` from the
    // val-tagged alternates and `#NR` from the pair-tagged ones directly,
    // as the Go port does, to make the restriction effective at parse
    // time.
    for name in parser.rule_names() {
        parser.define_rule(name, |spec| {
            if options.strict_value {
                filter_tin_from_alts(&mut spec.open, TIN_TX, "val");
                filter_tin_from_alts(&mut spec.close, TIN_TX, "val");
            }
            filter_tin_from_alts(&mut spec.open, TIN_NR, "pair");
            filter_tin_from_alts(&mut spec.close, TIN_NR, "pair");
        });
    }

    // Rule-level trims the grammar file cannot express declaratively:
    //   - pair.open loses its leading-comma `jsonic` alt so `{,}` fails.
    //   - pair gains an after-open validator that rejects #TX keys whose
    //     source text is not a valid JSON5 IdentifierName.
    //   - val.open loses its `#ZZ jsonic` alt (when requireValue is set)
    //     so a source containing only whitespace / comments errors out.
    parser.define_rule("pair", |spec| {
        spec.open
            .retain(|alt| !(tag_contains(&alt.g, "comma") && tag_contains(&alt.g, "jsonic")));
        if !spec.ao.iter().any(|action| action == PAIR_KEY_CHECK) {
            spec.ao.push(PAIR_KEY_CHECK.to_string());
        }
    });
    if options.require_value {
        parser.define_rule("val", |spec| {
            spec.open.retain(|alt| !is_zz_jsonic_alt(alt));
        });
    }

    // Record the resolved options on the instance so `parse_with` can
    // apply the requireValue rule and the line-continuation rewrite. The
    // TypeScript plugin wraps the parser's `start` for this; the engine
    // here runs a `parser.start` hook INSTEAD of the parse rather than
    // before it, so the guard lives in the package-level entry point, as
    // in Go.
    parser.decorate(OPTIONS_MARK, options);
    Ok(())
}

/// The plugin form of [`json5`], for [`Tabnas::use_plugin`]. Its defaults
/// are [`Json5Options::default`], and the bag it receives is read with
/// [`Json5Options::from_value`], so a caller passes only the keys to
/// change:
///
/// ```
/// let mut parser = tabnas_jsonic::make();
/// let overrides = tabnas_json5::Json5Options { hash_comment: true, ..Default::default() };
/// parser.use_plugin(tabnas_json5::plugin(), Some(overrides.to_value()))?;
/// assert_eq!(tabnas_json5::parse_with(&parser, "# c\n42")?.to_string(), "42");
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
pub fn plugin() -> Plugin {
    Plugin::new(PLUGIN_NAME, |parser, options| {
        json5(parser, &Json5Options::from_value(options))
    })
    .with_defaults(Json5Options::default().to_value())
}

/// Build a JSON5 parser with caller options: `jsonic.Make()` followed by
/// `UseDefaults(Json5, Defaults(), opts)` in Go, or
/// `new Tabnas().use(jsonic).use(Json5, opts)` in TypeScript.
///
/// Infallible by design: the grammar is a fixed literal, so a failure
/// here is a bug in this crate rather than anything a caller did.
///
/// ```
/// let options = tabnas_json5::Json5Options { strict_value: false, ..Default::default() };
/// let parser = tabnas_json5::make_with(options);
/// assert_eq!(tabnas_json5::parse_with(&parser, "foo")?.to_string(), r#""foo""#);
/// # Ok::<(), tabnas_json5::Json5Error>(())
/// ```
pub fn make_with(options: Json5Options) -> Tabnas {
    let mut parser = tabnas_jsonic::make();
    parser
        .use_plugin(plugin(), Some(options.to_value()))
        .expect("the json5 grammar is fixed and valid");
    parser
}

/// Build a JSON5 parser with the default (strict JSON5) options.
///
/// ```
/// let parser = tabnas_json5::make();
/// let value = tabnas_json5::parse_with(&parser, "[1, 2, 3,]")?;
/// assert_eq!(value.to_string(), "[1,2,3]");
/// assert!(tabnas_json5::parse_with(&parser, "[1, 2").is_err());
/// # Ok::<(), tabnas_json5::Json5Error>(())
/// ```
pub fn make() -> Tabnas {
    make_with(Json5Options::default())
}

/// A `json5_empty` or `json5_no_value` error, worded from the message and
/// hint templates the grammar registers on the instance, so the wording
/// has one source.
fn value_error(parser: &Tabnas, code: &str, src: &str) -> Json5Error {
    let mut error = Json5Error::new(code, "", src, 0, 1, 1);
    let config = parser.config();
    error.detail = config
        .error
        .get(code)
        .cloned()
        .unwrap_or_else(|| "JSON5 input must contain a value".to_string());
    error.hint = config.hint.get(code).cloned().unwrap_or_default();
    error
}

/// Parse a JSON5 source with a parser that carries the plugin: the
/// counterpart of the Go `Parse(j, src)` and of the `parse` the
/// TypeScript plugin wraps.
///
/// This is the entry point the plugin's behaviour is specified against.
/// Two things happen here that the engine's own [`Tabnas::parse`] cannot
/// do from inside a plugin:
///
/// - the `requireValue` rule: with the option on (the default) an empty
///   source is `json5_empty` and a whitespace-only or comments-only one
///   is `json5_no_value`; with it off, every such source is the grammar's
///   declared empty result, `null`;
/// - string line continuations: a backslash before a line terminator
///   sequence is removed inside string literals before lexing, because
///   the lexer's escape map cannot express the two-character CRLF form.
///
/// A parser that does not carry the plugin is parsed as it is.
///
/// ```
/// let parser = tabnas_json5::make();
/// let error = tabnas_json5::parse_with(&parser, "// only a comment").unwrap_err();
/// assert_eq!(error.code, "json5_no_value");
/// # Ok::<(), tabnas_json5::Json5Error>(())
/// ```
pub fn parse_with(parser: &Tabnas, src: &str) -> Result<Value, Json5Error> {
    let Some(options) = parser.decoration::<Json5Options>(OPTIONS_MARK).copied() else {
        return parser.parse(src);
    };
    if options.require_value {
        if src.is_empty() {
            return Err(value_error(parser, "json5_empty", src));
        }
        if !has_value(src) {
            return Err(value_error(parser, "json5_no_value", src));
        }
    } else if !src.is_empty() && !has_value(src) {
        // Without requireValue, a source holding no value resolves to the
        // SAME declared empty result that `""` already resolves to.
        // Delegating to the engine's own empty-source path keeps the
        // grammar's `emptyResult` the one place that value is written.
        return parser.parse("");
    }
    let quotes = if options.backtick_string {
        "'\"`"
    } else {
        "'\""
    };
    let rewritten = strip_line_continuations(src, quotes, '\\', options.hash_comment);
    parser.parse(&rewritten)
}

/// Parse a JSON5 source string with the shared default parser.
///
/// The parser is built once, on first use, and reused after that. Reuse
/// is safe: [`Tabnas::parse`] takes `&self` and builds a fresh parse
/// context per call, and `Tabnas` is `Send + Sync`, so concurrent callers
/// share one installed grammar instead of each rebuilding it, which is
/// what dominates a small parse.
///
/// Use [`make_with`] and [`parse_with`] instead when the parser needs
/// configuring: that returns a fresh instance and leaves this one alone.
///
/// ```
/// let value = tabnas_json5::parse("{ a: 1, b: [2, 3,], }")?;
/// assert_eq!(value.to_string(), r#"{"a":1,"b":[2,3]}"#);
/// assert_eq!(tabnas_json5::parse("").unwrap_err().code, "json5_empty");
/// # Ok::<(), tabnas_json5::Json5Error>(())
/// ```
pub fn parse(src: &str) -> Result<Value, Json5Error> {
    static DEFAULT: OnceLock<Tabnas> = OnceLock::new();
    parse_with(DEFAULT.get_or_init(make), src)
}
