export type StyleMap = Record<string, string>;
export type ClassStyleMap = Record<string, StyleMap>;

// ---- CSS 解析 ----

export function parseCss(css: string): ClassStyleMap {
  const result: ClassStyleMap = {};
  if (!css) return result;

  // 去掉每条规则后的分号再匹配（某些 DSL css 用 `;` 分隔多条规则）
  const ruleRegex = /\.([a-zA-Z0-9_%-]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(css)) !== null) {
    const className = match[1];
    const declarations = match[2];
    const styleMap: StyleMap = {};

    declarations.split(";").forEach((decl) => {
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) return;
      const prop = decl.slice(0, colonIdx).trim();
      const val = decl.slice(colonIdx + 1).trim().replace(/\s*!important\s*$/, "");
      if (prop && val) styleMap[prop] = val;
    });

    result[className] = styleMap;
  }

  return result;
}

// ---- 长度单位转换 ----

/** 将 CSS 长度值转换为 ArkUI 数值（rem→vp, px→vp, %→字符串） */
function parseLength(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "0") return "0";
  if (trimmed.endsWith("rem")) {
    const n = parseFloat(trimmed) * 16;
    return String(Math.round(n * 10) / 10); // 保留1位小数
  }
  if (trimmed.endsWith("px")) {
    return String(parseFloat(trimmed));
  }
  if (trimmed.endsWith("%")) {
    return `"${trimmed}"`;
  }
  // 纯数字
  if (!isNaN(Number(trimmed))) return trimmed;
  return `"${trimmed}"`;
}

/** 解析多值 shorthand（padding / margin），返回 ArkUI Edges 对象字符串 */
function parseEdges(value: string): string {
  const parts = value.trim().split(/\s+/);
  let top: string, right: string, bottom: string, left: string;

  if (parts.length === 1) {
    const v = parseLength(parts[0]);
    return v; // 单值直接用数字
  } else if (parts.length === 2) {
    const v0 = parseLength(parts[0]);
    const v1 = parseLength(parts[1]);
    top = v0; bottom = v0; left = v1; right = v1;
  } else if (parts.length === 3) {
    top = parseLength(parts[0]);
    right = parseLength(parts[1]);
    left = parseLength(parts[1]);
    bottom = parseLength(parts[2]);
  } else {
    top = parseLength(parts[0]);
    right = parseLength(parts[1]);
    bottom = parseLength(parts[2]);
    left = parseLength(parts[3]);
  }

  // 如果四边相等则简化
  if (top === right && right === bottom && bottom === left) return top;

  return `{ top: ${top}, right: ${right}, bottom: ${bottom}, left: ${left} }`;
}

// ---- CSS 属性 → ArkUI 修饰符 ----

const SKIP_PROPS = new Set([
  "flex-direction",
  "justify-content",
  "align-items",
  "align-self",
  "background-size",
  "background-repeat",
  "background-position",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "row-gap",
  "column-gap",
  "gap",
  "display",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "z-index",
  "box-sizing",
  "overflow",
  "white-space",
  "text-overflow",
  "word-break",
  "pointer-events",
  "cursor",
  "list-style",
  "float",
  "clear",
  "content",
  "letter-spacing",
]);

export function convertCssPropToArkUI(prop: string, value: string): string | null {
  if (SKIP_PROPS.has(prop)) return null;

  switch (prop) {
    case "font-size":
      return `.fontSize(${parseLength(value)})`;

    case "color":
      return `.fontColor("${value}")`;

    case "background-color":
      return `.backgroundColor("${value}")`;

    case "background":
      // 跳过 url(...) 类型
      if (value.includes("url(")) return null;
      return `.backgroundColor("${value}")`;

    case "width":
      // calc(100% - X) → ArkUI 中对应 layoutWeight(1)，占满剩余空间
      if (value.trim().startsWith("calc(")) return `.layoutWeight(1)`;
      return `.width(${parseLength(value)})`;

    case "height":
      if (value.trim().startsWith("calc(")) return null; // 跳过不支持的 calc
      return `.height(${parseLength(value)})`;

    case "flex": {
      // flex: 1 / flex: 2 等 → layoutWeight(n)，表示占满剩余空间
      const n = parseFloat(value);
      if (!isNaN(n) && n > 0) return `.layoutWeight(${n})`;
      return null;
    }

    case "min-width":
      return `.minWidth(${parseLength(value)})`;

    case "max-width":
      return `.maxWidth(${parseLength(value)})`;

    case "min-height":
      return `.minHeight(${parseLength(value)})`;

    case "max-height":
      return `.maxHeight(${parseLength(value)})`;

    case "margin": {
      const v = parseEdges(value);
      return `.margin(${v})`;
    }
    case "margin-top":
      return `.margin({ top: ${parseLength(value)} })`;
    case "margin-right":
      return `.margin({ right: ${parseLength(value)} })`;
    case "margin-bottom":
      return `.margin({ bottom: ${parseLength(value)} })`;
    case "margin-left":
      return `.margin({ left: ${parseLength(value)} })`;

    case "padding": {
      const v = parseEdges(value);
      return `.padding(${v})`;
    }
    case "padding-top":
      return `.padding({ top: ${parseLength(value)} })`;
    case "padding-right":
      return `.padding({ right: ${parseLength(value)} })`;
    case "padding-bottom":
      return `.padding({ bottom: ${parseLength(value)} })`;
    case "padding-left":
      return `.padding({ left: ${parseLength(value)} })`;

    case "font-weight": {
      if (value === "bold") return `.fontWeight(FontWeight.Bold)`;
      if (value === "normal") return `.fontWeight(FontWeight.Normal)`;
      const n = parseInt(value);
      if (!isNaN(n)) return `.fontWeight(${n})`;
      return null;
    }

    case "line-height":
      return `.lineHeight(${parseLength(value)})`;

    case "text-align":
      return `.textAlign(${mapTextAlign(value)})`;

    case "border-radius":
      return `.borderRadius(${parseLength(value)})`;

    case "opacity":
      return `.opacity(${value})`;

    case "border": {
      // 简单处理: "1px solid #ccc"
      const parts = value.split(/\s+/);
      if (parts.length >= 3) {
        const width = parseLength(parts[0]);
        const color = parts.slice(2).join(" ");
        return `.border({ width: ${width}, color: "${color}" })`;
      }
      return null;
    }

    case "border-color":
      return `.borderColor("${value}")`;

    case "border-width":
      return `.borderWidth(${parseLength(value)})`;

    case "visibility":
      return value === "hidden" ? `.visibility(Visibility.Hidden)` : `.visibility(Visibility.Visible)`;

    default:
      return null;
  }
}

function mapTextAlign(value: string): string {
  switch (value) {
    case "center": return "TextAlign.Center";
    case "right":
    case "end": return "TextAlign.End";
    default: return "TextAlign.Start";
  }
}

// ---- StyleMap → ArkUI 修饰符字符串 ----

export function styleMapToArkUI(styleMap: StyleMap, indent: string): string {
  const lines: string[] = [];
  for (const [prop, value] of Object.entries(styleMap)) {
    const modifier = convertCssPropToArkUI(prop, value);
    if (modifier) lines.push(`${indent}${modifier}`);
  }
  return lines.join("\n");
}
