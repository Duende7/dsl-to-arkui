import { useState } from "react";
import { generateArkUI, DslPage } from "./core/arkuiGenerator";
import demo1 from "./example/demo1.json";
import demo2 from "./example/demo2.json";
import demo3 from "./example/demo3.json";
import demo4 from "./example/demo4.json";
import demo5 from "./example/demo5.json";
import demo6 from "./example/demo6.json";
import "./app.css";

const EXAMPLES: Record<string, DslPage[]> = {
  demo1: demo1 as unknown as DslPage[],
  demo2: demo2 as unknown as DslPage[],
  demo3: demo3 as unknown as DslPage[],
  demo4: demo4 as unknown as DslPage[],
  demo5: demo5 as unknown as DslPage[],
  demo6: demo6 as unknown as DslPage[],
};

const DEFAULT_DSL = JSON.stringify(
  [
    {
      fileName: "Page",
      css: ".container { flex-direction: column; align-items: flex-start; padding: 1rem; background-color: #fff; } .row { justify-content: space-between; align-items: center; } .title { font-size: 1.125rem; color: rgba(0,0,0,0.9); font-weight: bold; } .desc { font-size: 0.875rem; color: rgba(0,0,0,0.6); line-height: 1.4rem; }",
      children: [
        {
          componentName: "div",
          props: { className: "container flex-column" },
          children: [
            {
              componentName: "div",
              props: { className: "row flex flex-between-center" },
              children: [
                {
                  componentName: "span",
                  props: { className: "title" },
                  children: "Hello ArkUI",
                },
              ],
            },
            {
              componentName: "span",
              props: { className: "desc" },
              children: "由 DSL 生成的 ArkUI 代码",
            },
          ],
        },
      ],
    },
  ],
  null,
  2
);

export default function App() {
  const [dslInput, setDslInput] = useState(DEFAULT_DSL);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    try {
      const parsed: DslPage[] = JSON.parse(dslInput);
      const code = generateArkUI(parsed);
      setOutput(code);
      setError("");
    } catch (e) {
      setError(`JSON 解析失败：${(e as Error).message}`);
      setOutput("");
    }
  }

  function handleCopy() {
    if (!output) return;
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function loadExample(key: string) {
    setDslInput(JSON.stringify(EXAMPLES[key], null, 2));
    setOutput("");
    setError("");
  }

  return (
    <div className="app">
      <header className="header">
        <h1>DSL → ArkUI 代码生成器</h1>
        <div className="examples">
          <span className="examples-label">加载示例：</span>
          <button className="btn btn-example" onClick={() => loadExample("demo1")}>demo1</button>
          <button className="btn btn-example" onClick={() => loadExample("demo2")}>demo2</button>
          <button className="btn btn-example" onClick={() => loadExample("demo3")}>demo3</button>
          <button className="btn btn-example" onClick={() => loadExample("demo4")}>demo4</button>
          <button className="btn btn-example" onClick={() => loadExample("demo5")}>demo5</button>
          <button className="btn btn-example" onClick={() => loadExample("demo6")}>demo6</button>
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <div className="panel-title">DSL JSON 输入</div>
          <textarea
            className="editor"
            value={dslInput}
            onChange={(e) => setDslInput(e.target.value)}
            spellCheck={false}
          />
        </section>

        <section className="panel">
          <div className="panel-title">ArkUI 代码输出</div>
          <textarea
            className="editor output"
            value={output}
            readOnly
            placeholder="点击「生成代码」查看结果…"
            spellCheck={false}
          />
        </section>
      </main>

      {error && <div className="error">{error}</div>}

      <footer className="footer">
        <button className="btn btn-primary" onClick={handleGenerate}>
          生成代码
        </button>
        <button className="btn" onClick={handleCopy} disabled={!output}>
          {copied ? "已复制 ✓" : "复制代码"}
        </button>
      </footer>
    </div>
  );
}
