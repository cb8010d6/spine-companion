export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") {
      for (const [name, dataValue] of Object.entries(value)) element.dataset[name] = String(dataValue);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in element) {
      element[key] = value === true ? true : value;
    } else {
      element.setAttribute(key, value === true ? "" : String(value));
    }
  }
  appendChildren(element, children);
  return element;
}

function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function render(node, container) {
  container.replaceChildren(node);
  return node;
}

export function createStore(initial, reducer = (state, patch) => ({ ...state, ...patch })) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState(action) {
      state = reducer(state, action);
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
