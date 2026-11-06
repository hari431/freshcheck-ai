import test from "node:test";
import assert from "node:assert/strict";
import { isClearVisible, getInitialTheme, nextTheme, isStaleRequest } from "../src/uiHelpers.js";

test("Clear is visible when input has content", () => {
  assert.equal(isClearVisible("hello", null, "", false), true);
});

test("Clear is visible when result exists", () => {
  assert.equal(isClearVisible("", { claims: [] }, "", false), true);
});

test("Clear is visible when error exists", () => {
  assert.equal(isClearVisible("", null, "boom", false), true);
});

test("Clear is visible while loading", () => {
  assert.equal(isClearVisible("", null, "", true), true);
});

test("Clear is hidden when everything is empty", () => {
  assert.equal(isClearVisible("", null, "", false), false);
  assert.equal(isClearVisible("   ", null, "", false), false);
});

test("getInitialTheme reads stored theme", () => {
  const storage = { getItem: (k) => (k === "theme" ? "dark" : null) };
  assert.equal(getInitialTheme(storage), "dark");
});

test("getInitialTheme defaults to light", () => {
  assert.equal(getInitialTheme({ getItem: () => null }), "light");
  assert.equal(getInitialTheme(null), "light");
});

test("nextTheme toggles", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
});

test("stale request detection", () => {
  assert.equal(isStaleRequest(2, 1), true);
  assert.equal(isStaleRequest(1, 1), false);
});