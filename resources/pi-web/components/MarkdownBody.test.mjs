import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("previews local markdown images through the guarded files API", () => {
  const html = renderMarkdown("![screenshot](images/example.png)");

  assert.match(html, /<img (?=[^>]*src="\/api\/files\/home\/me\/project\/images\/example\.png\?type=read")(?=[^>]*alt="screenshot")[^>]*\/>/);
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps external markdown images external without React metadata", () => {
  const html = renderMarkdown("![remote](https://example.com/image.png)");

  assert.match(html, /<img (?=[^>]*src="https:\/\/example\.com\/image\.png")(?=[^>]*alt="remote")[^>]*\/>/);
  assert.doesNotMatch(html, /\snode=/);
});

test("does not misroute UNC markdown images through the files API", () => {
  const html = renderMarkdown("![network](%5C%5Cserver%5Cshare%5Cimage.png)");

  assert.match(html, /UNC 图片暂不支持内联预览/);
  assert.doesNotMatch(html, /\/api\/files\/server\/share/);
  assert.doesNotMatch(html, /\snode=/);
});
