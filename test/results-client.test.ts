import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM fixture for the card image updater, including detached old images.
class Element {
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  src = "";
  children: Element[] = [];
  parent: Element | null = null;
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (selector.startsWith(".") ? child.className.split(" ").includes(selector.slice(1)) : selector === `[data-action='${child.dataset.action}']`) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  insertBefore(child: Element, reference: Element | null) {
    child.parent = this;
    this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, child);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceWith(next: Element) { this.parent!.insertBefore(next, this); this.remove(); }
}

function fixture() {
  const card = new Element();
  const info = new Element(); info.className = "result-info"; card.insertBefore(info, null);
  const actions = new Element(); actions.className = "result-actions"; info.insertBefore(actions, null);
  const context = vm.createContext({ document: { createElement: () => new Element() }, t: (text: string) => text, card });
  const source = readFileSync("src/results/client.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("function updateResultCardPostImage("), source.indexOf("async function deleteTopicFromDb(")), context);
  return { card, update(url: string | null) { context.url = url; vm.runInContext("updateResultCardPostImage(card, url)", context); } };
}

test("a saved URL replaces a previously hidden preview and keeps card data current", () => {
  const { card, update } = fixture();
  const old = new Element(); old.className = "result-thumb"; old.src = "old.jpg"; old.style.display = "none";
  card.insertBefore(old, card.children[0]);
  update("new.jpg");
  const thumb = card.querySelector(".result-thumb")!;
  assert.notEqual(thumb, old);
  assert.equal(thumb.src, "new.jpg");
  assert.notEqual(thumb.style.display, "none");
  assert.equal(card.dataset.postImage, "new.jpg");
  // A late error from the detached image cannot hide its replacement.
  old.style.display = "none";
  assert.notEqual(thumb.style.display, "none");
});

test("adding and clearing a post image updates the thumbnail and Screens action together", () => {
  const { card, update } = fixture();
  update("first.jpg");
  assert.ok(card.querySelector(".result-thumb"));
  assert.ok(card.querySelector("[data-action='screens']"));
  update("second.jpg");
  assert.equal(card.querySelector(".result-actions")!.children.length, 1);
  update(null);
  assert.equal(card.querySelector(".result-thumb"), null);
  assert.equal(card.querySelector("[data-action='screens']"), null);
  assert.equal(card.dataset.postImage, "");
});
