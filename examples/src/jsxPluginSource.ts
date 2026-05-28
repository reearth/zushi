// Trusted custom components (à la Figma's View/Text), registered in the VM
// before the plugin runs. Only markup these emit may use intrinsic HTML tags
// when the host sets `intrinsics: false` — so plugin code is confined to this
// curated component vocabulary.
export const jsxComponents = `
  registerComponent("View", (p) =>
    h("div", { style: {
      display: "flex",
      flexDirection: p.direction || "column",
      gap: p.gap,
      padding: p.padding,
      alignItems: p.align,
      ...p.style
    } }, p.children));

  registerComponent("Text", (p) =>
    h("span", { style: { font: "14px sans-serif", ...p.style } }, p.children));

  registerComponent("Button", (p) =>
    h("button", {
      onClick: p.onClick,
      style: { font: "inherit", padding: "4px 10px", cursor: "pointer", ...p.style }
    }, p.children));

  registerComponent("Input", (p) =>
    h("input", {
      value: p.value,
      placeholder: p.placeholder,
      onInput: p.onInput,
      style: { font: "inherit", padding: "3px 6px", ...p.style }
    }));
`;

// Plugin code: a counter, a controlled input, and a keyed list — built only
// from the registered components above (no raw HTML).
export const jsxPluginSource = `
  function App() {
    const [count, setCount] = useState(0);
    const [text, setText] = useState("");
    const [items, setItems] = useState([]);

    function add() {
      if (!text) return;
      setItems([...items, { id: Date.now(), label: text }]);
      setText("");
    }

    return h(View, { gap: 12, padding: 14, style: { font: "14px sans-serif" } },
      h(View, { direction: "row", gap: 8, align: "center" },
        h(Button, { onClick: () => { setCount(count + 1); host.event("inc", count + 1); } }, "+1"),
        h(Text, { style: { fontWeight: 600 } }, "count: " + count)
      ),
      h(View, { direction: "row", gap: 8, align: "center" },
        h(Input, { value: text, placeholder: "add item...", onInput: (e) => setText(e.value) }),
        h(Button, { onClick: add }, "add")
      ),
      h(View, { gap: 6 },
        ...items.map((it) =>
          h(View, { key: it.id, direction: "row", gap: 8, align: "center" },
            h(Text, null, it.label),
            h(Button, { onClick: () => setItems(items.filter((x) => x.id !== it.id)) }, "x")
          )
        )
      )
    );
  }

  render(h(App), { width: 300 });
`;
