// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createStore, h, render } from "../src/renderer/lib/dom.js";

describe("dom helpers", () => {
  it("creates elements with attributes, dataset, styles, listeners, and children", () => {
    let clicked = false;
    const button = h(
      "button",
      {
        class: "primary",
        dataset: { state: "working" },
        style: { color: "red" },
        onclick: () => {
          clicked = true;
        }
      },
      "Run"
    );

    button.click();
    expect(button.className).toBe("primary");
    expect(button.dataset.state).toBe("working");
    expect(button.style.color).toBe("red");
    expect(button.textContent).toBe("Run");
    expect(clicked).toBe(true);
  });

  it("renders by replacing existing children", () => {
    const container = document.createElement("div");
    container.appendChild(h("span", {}, "old"));
    render(h("span", {}, "new"), container);
    expect(container.textContent).toBe("new");
    expect(container.children).toHaveLength(1);
  });

  it("creates a small observable store", () => {
    const store = createStore({ count: 0 });
    const seen = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.count));

    expect(store.setState({ count: 1 })).toEqual({ count: 1 });
    unsubscribe();
    store.setState({ count: 2 });

    expect(seen).toEqual([1]);
    expect(store.getState()).toEqual({ count: 2 });
  });
});
