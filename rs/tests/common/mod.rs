// Shared test helpers. Cargo compiles this module into EVERY integration
// test binary, so an item only one binary uses is dead code in the
// others; the allow keeps that from being a warning rather than hiding
// anything real.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use tabnas::Tabnas;
use tabnas_json5::{make_with, parse_with, Json5Options};
use tabnas_support::{find_spec_dir, Failure, Value};

/// The shared `test/spec` directory, found by walking up from the crate
/// rather than by counting `..` hops.
pub fn spec_dir() -> PathBuf {
    find_spec_dir(Some(Path::new(env!("CARGO_MANIFEST_DIR"))))
        .expect("a test/spec directory above rs/")
}

/// The repository root: the parent of `rs/`.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("rs/ has a parent")
        .to_path_buf()
}

/// An engine value as the fixture data model, converted BY HAND rather
/// than through JSON: JSON5 admits values JSON cannot spell, and the
/// expected column names them (`NaN`, `Infinity`, `-Infinity`,
/// `UNDEFINED`), so a non-finite number and an absent value have to
/// survive the conversion where `to_json()` would fold them to `null`.
/// The typed wrappers (`Text`, `MapRef`, `ListRef`) unwrap to the plain
/// value they carry, as the Go runner's JSON flatten does.
pub fn to_value(value: &tabnas::Value) -> Value {
    match value {
        tabnas::Value::Undefined => Value::Undefined,
        tabnas::Value::Null => Value::Null,
        tabnas::Value::Bool(flag) => Value::Bool(*flag),
        tabnas::Value::Number(number) => Value::Number(*number),
        tabnas::Value::String(text) => Value::String(text.clone()),
        tabnas::Value::Text(text) => Value::String(text.string.clone()),
        tabnas::Value::Array(items) => Value::Array(items.iter().map(to_value).collect()),
        tabnas::Value::ListRef(list) => Value::Array(list.value.iter().map(to_value).collect()),
        tabnas::Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), to_value(value)))
                .collect(),
        ),
        tabnas::Value::MapRef(map) => Value::Object(
            map.value
                .iter()
                .map(|(key, value)| (key.clone(), to_value(value)))
                .collect(),
        ),
    }
}

/// A parse error as the runner's failure: the code the fixture pins, the
/// position for an `@row:col` cell, and the rendered report for the
/// failure message.
pub fn to_failure(error: tabnas::TabnasError) -> Failure {
    Failure::new(error.code.clone())
        .at(error.row, error.col)
        .with_message(error.to_string())
}

/// The plugin options a fixture row asks for. The `opts` column is a JSON
/// object of plugin options, empty for the defaults, exactly the text the
/// TypeScript and Go runners hand their plugin. A key the plugin does not
/// know is an error rather than a silent default: a misspelt option would
/// otherwise run the stock parser and assert the wrong thing.
pub fn options_from_column(raw: &str, at: &str) -> Result<Json5Options, Failure> {
    if raw.trim().is_empty() {
        return Ok(Json5Options::default());
    }
    let json: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| Failure::message(format!("{at}: opts {raw:?} is not JSON: {error}")))?;
    let Some(object) = json.as_object() else {
        return Err(Failure::message(format!(
            "{at}: opts {raw:?} is not a JSON object"
        )));
    };
    if let Some(unknown) = object
        .keys()
        .find(|key| !Json5Options::KEYS.contains(&key.as_str()))
    {
        return Err(Failure::message(format!(
            "{at}: opts {raw:?} names an option this plugin does not have: {unknown:?}"
        )));
    }
    Ok(Json5Options::from_json(&json))
}

/// A fresh parser with `options`, parsing `input` through the
/// package-level entry point (the Go `Parse(j, src)`), which applies the
/// requireValue rule and the line-continuation rewrite.
pub fn parse_fresh(options: Json5Options, input: &str) -> Result<Value, Failure> {
    let parser = make_with(options);
    parse_with(&parser, input)
        .map(|value| to_value(&value))
        .map_err(to_failure)
}

/// What one parser did with one input, in the divergence register's
/// vocabulary: compact JSON, or `ERROR:<code>@<row>:<col>`.
pub fn outcome(parser: &Tabnas, src: &str) -> String {
    match parse_with(parser, src) {
        Ok(value) => serde_json::to_string(&value.to_json()).expect("engine values are JSON"),
        Err(error) => format!("ERROR:{}@{}:{}", error.code, error.row, error.col),
    }
}

/// The value as compact JSON with whole numbers spelt as integers, the
/// way `JSON.stringify` and `encoding/json` spell them, so an expectation
/// reads the same as the TypeScript and Go ones. Non-finite numbers are
/// spelt by name, since the JSON5 tests name them.
pub fn json(value: &tabnas::Value) -> String {
    match value {
        tabnas::Value::Undefined => "undefined".to_string(),
        tabnas::Value::Null => "null".to_string(),
        tabnas::Value::Bool(flag) => flag.to_string(),
        tabnas::Value::Number(number) => js_number(*number),
        tabnas::Value::String(text) => serde_json::to_string(text).expect("a string is JSON"),
        tabnas::Value::Text(text) => serde_json::to_string(&text.string).expect("a string is JSON"),
        tabnas::Value::Array(items) => {
            format!("[{}]", items.iter().map(json).collect::<Vec<_>>().join(","))
        }
        tabnas::Value::ListRef(list) => {
            format!(
                "[{}]",
                list.value.iter().map(json).collect::<Vec<_>>().join(",")
            )
        }
        tabnas::Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .map(|(key, value)| format!(
                    "{}:{}",
                    serde_json::to_string(key).expect("a string is JSON"),
                    json(value)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
        tabnas::Value::MapRef(map) => format!(
            "{{{}}}",
            map.value
                .iter()
                .map(|(key, value)| format!(
                    "{}:{}",
                    serde_json::to_string(key).expect("a string is JSON"),
                    json(value)
                ))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

/// A number as JavaScript prints it in the cases the tests use: integers
/// without a fraction, everything else in the shortest round-trip form.
pub fn js_number(number: f64) -> String {
    if number.is_nan() {
        "NaN".to_string()
    } else if number.is_infinite() {
        if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        }
        .to_string()
    } else if number.fract() == 0.0 && number.abs() < 1.0e21 {
        if number == 0.0 && number.is_sign_negative() {
            "-0".to_string()
        } else {
            format!("{number:.0}")
        }
    } else {
        format!("{number}")
    }
}
